import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { loadTs } from "./helpers/load-ts.mjs";

// One registry instance for the test and the bundled guard: Node loads the .ts file directly.
const registryUrl = new URL("../main/system-panels/panel-registry.ts", import.meta.url).href;
const registry = await import(registryUrl);
const sharedRegistry = {
  name: "shared-registry",
  setup(api) {
    api.onResolve({ filter: /panel-registry\.js$/ }, () => ({ path: registryUrl, external: true }));
  },
};

const backendStub = {
  name: "glaze-backend",
  setup(api) {
    api.onResolve({ filter: /^@glaze\/core\/backend$/ }, (args) => ({
      path: args.path,
      namespace: "glaze-backend",
    }));
    api.onLoad({ filter: /.*/, namespace: "glaze-backend" }, () => ({
      contents: `
        export const ipcMain = {
          handle(channel, handler, options) { globalThis.__ipc.handles.set(channel, options); },
          handleStream(channel, handler, options) { globalThis.__ipc.streams.set(channel, options); },
          broadcast() {},
        };
      `,
      loader: "js",
    }));
  },
};

globalThis.__ipc = { handles: new Map(), streams: new Map() };
const { ipcMain } = await loadTs("main/ipc.ts", [backendStub, sharedRegistry]);

const windows = new Map();
registry.setPanelWindowLookup({
  fromSender: (sender) => sender.window ?? null,
  fromId: (id) => windows.get(id) ?? null,
});

const allowed = (decision) => (typeof decision === "boolean" ? decision : decision.allowed);
const PANEL_URL = "file:///app/build/panel-window.html#capture";
const MAIN_URL = "file:///app/build/main-window.html";
const invokeEvent = (frameURL) => ({ sender: { id: 1, windowId: "9" }, senderFrameURL: frameURL });
const streamContext = (sender) => ({ channel: "x", kind: "stream", sender });

ipcMain.handle("settings:update", () => undefined);
ipcMain.handle("capture:submit", () => undefined);
ipcMain.handleStream("ai:assistant", async () => undefined);
ipcMain.handleStream("ai:run", async () => undefined);

test("registry tracks panel window ids", () => {
  registry.registerPanelWindow(7);
  assert.equal(registry.isPanelWindowId("7"), true);
  registry.unregisterPanelWindow(7);
  assert.equal(registry.isPanelWindowId(7), false);
  assert.equal(registry.isPanelWindowId(undefined), false);
});

test("panels can't invoke channels outside the allow-list", async () => {
  const options = globalThis.__ipc.handles.get("settings:update");
  assert.equal(allowed(await options.authorize(invokeEvent(PANEL_URL))), false);
  assert.equal(allowed(await options.authorize(invokeEvent(MAIN_URL))), true);
});

test("panels can invoke allow-listed channels", async () => {
  const options = globalThis.__ipc.handles.get("capture:submit");
  assert.equal(allowed(await options.authorize(invokeEvent(PANEL_URL))), true);
});

test("an existing authorize still runs for allowed senders", async () => {
  let calls = 0;
  ipcMain.handle("tasks:list", () => undefined, {
    authorize: () => {
      calls += 1;
      return false;
    },
  });
  const options = globalThis.__ipc.handles.get("tasks:list");
  assert.equal(allowed(await options.authorize(invokeEvent(MAIN_URL))), false);
  assert.equal(calls, 1);
});

test("panels can't open streams outside the allow-list", async () => {
  const assistant = globalThis.__ipc.streams.get("ai:assistant");
  const run = globalThis.__ipc.streams.get("ai:run");
  assert.equal(allowed(await assistant.authorize({}, streamContext({ frameURL: PANEL_URL }))), false);
  assert.equal(allowed(await assistant.authorize({}, streamContext({ frameURL: MAIN_URL }))), true);
  assert.equal(allowed(await run.authorize({}, streamContext({ frameURL: PANEL_URL }))), true);
});

test("a registered panel window is blocked even without a page URL", async () => {
  registry.registerPanelWindow(42);
  windows.set("native-42", { id: 42 });
  const assistant = globalThis.__ipc.streams.get("ai:assistant");
  const decision = await assistant.authorize({}, streamContext({ windowId: "native-42" }));
  assert.equal(allowed(decision), false);
  const settings = globalThis.__ipc.handles.get("settings:update");
  const event = { sender: { id: 2, window: { id: 42 } } };
  assert.equal(allowed(await settings.authorize(event)), false);
  registry.unregisterPanelWindow(42);
  assert.equal(allowed(await settings.authorize(event)), true);
});
