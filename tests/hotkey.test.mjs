import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { createHotkeyManager } = await loadTs("main/system-panels/hotkey.ts");

function fixture({ registerResult = true, plist = null, native = true } = {}) {
  const registered = new Map();
  const statuses = [];
  let triggers = 0;
  const manager = createHotkeyManager({
    nativeEnabled: native,
    globalShortcut: {
      register(accelerator, callback) {
        if (!registerResult) return false;
        registered.set(accelerator, callback);
        return true;
      },
      unregister(accelerator) {
        registered.delete(accelerator);
      },
    },
    readSymbolicHotkeys: async () => (plist instanceof Error ? null : plist),
    onTrigger: () => triggers++,
    onStatus: (status) => statuses.push(status),
  });
  return { manager, registered, statuses, triggers: () => triggers };
}

const on = { enabled: true, hotkey: "Control+Alt+D" };

test("registers the configured accelerator", async () => {
  const { manager, registered, triggers } = fixture();
  const status = await manager.apply(on);
  assert.deepEqual(status, {
    accelerator: "Control+Alt+D",
    enabled: true,
    registered: true,
    conflict: null,
  });
  registered.get("Control+Alt+D")();
  assert.equal(triggers(), 1);
});

test("reports registration failure as in use by another app", async () => {
  const { manager } = fixture({ registerResult: false });
  const status = await manager.apply(on);
  assert.equal(status.registered, false);
  assert.equal(status.conflict, "⌃⌥D is in use by another app. Choose a different shortcut.");
});

test("reports a macOS conflict from the plist", async () => {
  const { manager } = fixture({ plist: {} });
  const status = await manager.apply({ enabled: true, hotkey: "Control+Alt+Space" });
  assert.equal(
    status.conflict,
    "macOS uses ⌃⌥Space for Select next source in Input menu. Turn it off in System Settings → Keyboard → Keyboard Shortcuts, or choose another shortcut.",
  );
});

test("skips the plist check when reading fails", async () => {
  const { manager } = fixture({ plist: new Error("unreadable") });
  const status = await manager.apply({ enabled: true, hotkey: "Control+Alt+Space" });
  assert.equal(status.registered, true);
  assert.equal(status.conflict, null);
});

test("re-registers when the hotkey setting changes", async () => {
  const { manager, registered } = fixture();
  await manager.apply(on);
  await manager.apply({ enabled: true, hotkey: "Control+Alt+K" });
  assert.deepEqual([...registered.keys()], ["Control+Alt+K"]);
});

test("unregisters when Quick Capture is switched off", async () => {
  const { manager, registered, statuses } = fixture();
  await manager.apply(on);
  const status = await manager.apply({ enabled: false, hotkey: "Control+Alt+D" });
  assert.equal(registered.size, 0);
  assert.deepEqual(status, {
    accelerator: "Control+Alt+D",
    enabled: false,
    registered: false,
    conflict: null,
  });
  assert.equal(statuses.at(-1), status);
});

test("suspends the global hotkey while the recorder has focus", async () => {
  const { manager, registered } = fixture();
  await manager.apply(on);
  await manager.suspend(true);
  assert.equal(registered.size, 0);
  await manager.suspend(false);
  assert.deepEqual([...registered.keys()], ["Control+Alt+D"]);
});

test("does not register in test builds", async () => {
  const { manager, registered } = fixture({ native: false });
  const status = await manager.apply(on);
  assert.equal(registered.size, 0);
  assert.equal(status.registered, false);
  assert.equal(status.conflict, null);
});

test("a superseded change never registers its shortcut", async () => {
  const registered = new Map();
  const reads = [];
  const manager = createHotkeyManager({
    nativeEnabled: true,
    globalShortcut: {
      register(accelerator, callback) {
        registered.set(accelerator, callback);
        return true;
      },
      unregister(accelerator) {
        registered.delete(accelerator);
      },
    },
    readSymbolicHotkeys: () => new Promise((resolve) => reads.push(resolve)),
    onTrigger() {},
    onStatus() {},
  });
  const first = manager.apply({ enabled: true, hotkey: "Control+Alt+D" });
  const second = manager.apply({ enabled: true, hotkey: "Control+Alt+K" });
  reads[1]({});
  reads[0]({});
  await Promise.all([first, second]);
  assert.deepEqual([...registered.keys()], ["Control+Alt+K"]);
  assert.equal(manager.status().accelerator, "Control+Alt+K");
});
