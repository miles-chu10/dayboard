import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

// Quick Capture must parse through the same runner as `ai:run`, so provider options added there
// (effort, the explicit Codex default) also reach Quick Capture. Everything but the wiring is
// stubbed; prompt-cache.test.mjs covers what runCompletion sends.
const fixture = { completions: [], deps: null, accountListeners: [], cleared: 0, closed: 0 };
globalThis.__quickCaptureWiring = fixture;

const STUBS = {
  electron: `export class Notification { static isSupported() { return true; } on() { return this; } show() {} close() { globalThis.__quickCaptureWiring.closed += 1; } }`,
  "productivity.js": `export const getAccountsStatus = async () => ({}); export const requireAgendaScope = async () => "scope"; export const onAccountsChanged = (listener) => globalThis.__quickCaptureWiring.accountListeners.push(listener);`,
  "platform/index.js": `export const ipcMain = { handle() {}, broadcast() {} }; export const logger = { error() {}, warn() {} };`,
  "ipc.js": `export const runGuardedCommand = (_channel, run) => run();`,
  "completion.js": `export const runCompletion = async (input) => {
    globalThis.__quickCaptureWiring.completions.push(input);
    return { text: "parsed", usage: undefined };
  };`,
  "apple-reminders.js": `export const createReminder = async () => ({}); export const deleteReminder = async () => {};`,
  "capture-service.js": `export const createCaptureService = (deps) => {
    globalThis.__quickCaptureWiring.deps = deps;
    return { submit: async () => {}, undo: async () => {}, recent: () => [], clear: () => { globalThis.__quickCaptureWiring.cleared += 1; } };
  };`,
  "demo-data.js": `export const isDemoMode = () => false;`,
  "google-api.js": `export const createEvent = async () => ({}); export const createTask = async () => ({}); export const deleteEvent = async () => {}; export const deleteTask = async () => {};`,
  "pending-writes.js": `export const trackPendingWrite = (run) => run();`,
  "settings-store.js": `export const getSettings = async () => ({});`,
  "notification-status.js": `export const recordNotificationResult = () => {};`,
  "panel-window.js": `export const isPanelVisible = () => false; export const showPanel = async () => {};`,
};

const stubPlugin = {
  name: "quick-capture-wiring",
  setup(api) {
    api.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(STUBS).find(
        (name) => args.path === name || args.path.endsWith(`/${name}`),
      );
      return key ? { path: key, namespace: "stub" } : undefined;
    });
    api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};

const handlers = await loadTs("main/system-panels/capture-handlers.ts", [stubPlugin]);

test("Quick Capture's AI parse runs through runCompletion, like ai:run", async () => {
  assert.ok(fixture.deps, "the capture service was created");
  assert.equal(
    await fixture.deps.complete("capture system", "Call dentist Thursday 3pm"),
    "parsed",
  );
  assert.equal(fixture.completions.length, 1);
  const [call] = fixture.completions;
  assert.equal(call.system, "capture system");
  assert.equal(call.prompt, "Call dentist Thursday 3pm");
  assert.ok(call.signal instanceof AbortSignal);
});

test("an account change clears recent captures, so the previous account's items never show", () => {
  handlers.registerCaptureHandlers();
  assert.equal(fixture.accountListeners.length, 1);
  fixture.deps.onCreated({
    id: "old-account",
    draft: { kind: "task", title: "Private task", notes: "", date: "", time: "", endTime: "" },
  });
  fixture.accountListeners[0]();
  assert.equal(fixture.cleared, 1);
  assert.equal(fixture.closed, 1, "previous-account confirmation is closed");
});
