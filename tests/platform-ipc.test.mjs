import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const entryUrl = "file:///fixture/main-window.html";
const bundled = await build({
  stdin: {
    contents: `export * from "./main/platform/ipc.ts"; export * from "./main/services/runtime-activity.ts";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "native-boundaries-only",
      setup(api) {
        api.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
        api.onResolve({ filter: /\/(system-preferences|native-theme)\.js$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        api.onLoad({ filter: /^electron$/, namespace: "fixture" }, () => ({
          contents: `
            const fixture = globalThis.__dayboardIpcFixture;
            export const ipcMain = fixture.ipcMain;
            export const BrowserWindow = fixture.BrowserWindow;
            export const nativeTheme = { shouldUseDarkColors: false, themeSource: "system" };
          `,
          loader: "js",
        }));
        api.onLoad({ filter: /system-preferences\.js$/, namespace: "fixture" }, () => ({
          contents: `export const systemPreferences = {
            getAccentColor: () => "#123456",
            getMediaAccessStatus: () => "not-determined",
            askForMediaAccess: async () => false,
          };`,
          loader: "js",
        }));
        api.onLoad({ filter: /native-theme\.js$/, namespace: "fixture" }, () => ({
          contents: `export const saveNativeTheme = () => {
            throw new Error("native theme storage must not run in IPC gate tests");
          };`,
          loader: "js",
        }));
      },
    },
  ],
});

let fixtureSequence = 0;

async function createHarness() {
  const handlers = new Map();
  const listeners = new Map();
  const windows = new Map();
  globalThis.__dayboardIpcFixture = {
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler: ${channel}`);
        handlers.set(channel, handler);
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
    },
    BrowserWindow: {
      fromWebContents: (contents) => windows.get(contents) ?? null,
      getAllWindows: () => [...windows.values()],
    },
  };
  const source = `${bundled.outputFiles[0].text}\n// ipc-fixture-${fixtureSequence++}`;
  const adapter = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );

  function makeSender(id, url = entryUrl) {
    const contents = new EventEmitter();
    contents.id = id;
    contents.url = url;
    contents.mainFrame = { url };
    contents.sent = [];
    contents.getURL = () => contents.url;
    contents.isDestroyed = () => false;
    contents.send = (...args) => contents.sent.push(args);
    windows.set(contents, { webContents: contents, isDestroyed: () => false });
    return contents;
  }

  function event(sender, senderFrame = sender.mainFrame) {
    return { sender, senderFrame };
  }

  function invoke(channel, sender, ...args) {
    const handler = handlers.get(channel);
    assert.ok(handler, `missing IPC handler: ${channel}`);
    return handler(event(sender), ...args);
  }

  return { adapter, handlers, listeners, windows, makeSender, event, invoke };
}

test("only a registered window's current main frame reaches a read handler", async () => {
  const { adapter, handlers, windows, makeSender, event } = await createHarness();
  const trusted = makeSender(1);
  const unregistered = makeSender(2);
  let reads = 0;
  adapter.ipcMain.handle("tasks:list", () => ++reads);
  adapter.registerTrustedWindow(trusted, entryUrl);
  const read = handlers.get("tasks:list");

  await assert.rejects(read(event(unregistered)), /Untrusted DayBoard IPC sender/);
  await assert.rejects(read(event(trusted, { url: entryUrl })), /Untrusted DayBoard IPC sender/);
  trusted.mainFrame.url = "file:///fixture/settings-window.html";
  await assert.rejects(read(event(trusted)), /Untrusted DayBoard IPC sender/);
  trusted.mainFrame.url = entryUrl;
  trusted.url = "file:///fixture/settings-window.html";
  await assert.rejects(read(event(trusted)), /Untrusted DayBoard IPC sender/);
  trusted.url = entryUrl;
  windows.delete(trusted);
  await assert.rejects(read(event(trusted)), /Untrusted DayBoard IPC sender/);
  assert.equal(reads, 0);

  windows.set(trusted, { webContents: trusted, isDestroyed: () => false });
  trusted.mainFrame.url = `${entryUrl}#/agenda`;
  trusted.url = `${entryUrl}#/agenda`;
  assert.equal(await read(event(trusted)), 1);
});

test("paid source writes and AI streams fail closed until a license guard is set", async () => {
  const { adapter, makeSender, invoke } = await createHarness();
  const sender = makeSender(3);
  adapter.registerTrustedWindow(sender, entryUrl);
  adapter.registerBridgeIpc();
  let writes = 0;
  let aiRuns = 0;
  adapter.ipcMain.handle("tasks:create", () => ++writes);
  adapter.ipcMain.handleStream("ai:run", async () => ++aiRuns);

  await assert.rejects(
    invoke("tasks:create", sender, { title: "fixture" }),
    /License status is not ready/,
  );
  await assert.rejects(
    invoke("dayboard:stream:start", sender, { id: "ai-default", channel: "ai:run", args: {} }),
    /License status is not ready/,
  );
  assert.equal(writes, 0);
  assert.equal(aiRuns, 0);
  assert.deepEqual(sender.sent, []);
});

test("license denial stops paid handlers while settings and source reads remain usable", async () => {
  const { adapter, makeSender, invoke } = await createHarness();
  const sender = makeSender(4);
  adapter.registerTrustedWindow(sender, entryUrl);
  adapter.registerBridgeIpc();
  let guardCalls = 0;
  let writes = 0;
  let aiRuns = 0;
  adapter.setLicenseAccessGuard(async () => {
    guardCalls++;
    throw new Error("License required");
  });
  adapter.ipcMain.handle("tasks:create", () => ++writes);
  adapter.ipcMain.handle("tasks:list", () => ["existing task"]);
  adapter.ipcMain.handle("settings:get", () => ({ theme: "dark" }));
  adapter.ipcMain.handleStream("ai:run", async () => ++aiRuns);

  await assert.rejects(invoke("tasks:create", sender, { title: "fixture" }), /License required/);
  await assert.rejects(
    invoke("dayboard:stream:start", sender, { id: "ai-denied", channel: "ai:run", args: {} }),
    /License required/,
  );
  assert.equal(writes, 0);
  assert.equal(aiRuns, 0);
  assert.equal(guardCalls, 2);
  assert.deepEqual(await invoke("tasks:list", sender), ["existing task"]);
  assert.deepEqual(await invoke("settings:get", sender), { theme: "dark" });
  assert.equal(guardCalls, 2);
});

test("stream cancellation through IPC affects only the sender's matching stream", async () => {
  const { adapter, listeners, makeSender, event, invoke } = await createHarness();
  const first = makeSender(5);
  const second = makeSender(6);
  const outsider = makeSender(7);
  adapter.registerTrustedWindow(first, entryUrl);
  adapter.registerTrustedWindow(second, entryUrl);
  adapter.registerBridgeIpc();
  const signals = new Map();
  const releases = new Map();
  adapter.ipcMain.handleStream("fixture:wait", async (owner, _sendChunk, { signal }) => {
    signals.set(owner, signal);
    await new Promise((resolve) => releases.set(owner, resolve));
    return owner;
  });

  const request = { id: "shared-id", channel: "fixture:wait" };
  const firstRun = invoke("dayboard:stream:start", first, { ...request, args: "first" });
  const secondRun = invoke("dayboard:stream:start", second, { ...request, args: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = listeners.get("dayboard:stream:cancel");
  assert.ok(cancel);
  cancel(event(outsider), "shared-id");
  assert.equal(signals.get("first").aborted, false);
  assert.equal(signals.get("second").aborted, false);
  cancel(event(first), "shared-id");
  assert.equal(signals.get("first").aborted, true);
  assert.equal(signals.get("second").aborted, false);
  releases.get("first")();
  releases.get("second")();
  assert.equal(await firstRun, "first");
  assert.equal(await secondRun, "second");
});

test("update preparation drains existing IPC work and blocks new writes and streams", async () => {
  const { adapter, makeSender, invoke } = await createHarness();
  const sender = makeSender(8);
  adapter.registerTrustedWindow(sender, entryUrl);
  adapter.registerBridgeIpc();
  adapter.setLicenseAccessGuard(async () => {});
  let finish;
  let writes = 0;
  let streams = 0;
  adapter.ipcMain.handle("settings:update", () => {
    writes++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  adapter.ipcMain.handle("updates:status", () => ({ phase: "preparing" }));
  adapter.ipcMain.handleStream("ai:run", async () => ++streams);
  const pending = invoke("settings:update", sender);
  let drained = false;
  const drain = adapter.pauseAndDrainAppOperations().then(() => {
    drained = true;
  });
  await assert.rejects(invoke("settings:update", sender), /preparing to install/);
  await assert.rejects(
    invoke("dayboard:stream:start", sender, { id: "blocked", channel: "ai:run", args: {} }),
    /preparing to install/,
  );
  assert.equal(writes, 1);
  assert.equal(streams, 0);
  assert.equal(drained, false);
  assert.deepEqual(await invoke("updates:status", sender), { phase: "preparing" });
  finish("saved");
  assert.equal(await pending, "saved");
  await drain;
  await assert.rejects(invoke("settings:update", sender), /preparing to install/);
  adapter.resumeAppOperations();
  const resumed = invoke("settings:update", sender);
  finish("saved again");
  assert.equal(await resumed, "saved again");
  assert.equal(writes, 2);
});
