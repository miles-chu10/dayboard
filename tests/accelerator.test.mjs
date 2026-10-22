import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const accelerator = await loadTs("shared/accelerator.ts");

test("normalizes modifier order", () => {
  assert.equal(accelerator.normalizeAccelerator("Alt+Control+space"), "Control+Alt+Space");
  assert.equal(accelerator.normalizeAccelerator("Cmd+Shift+k"), "Shift+Command+K");
  assert.equal(accelerator.normalizeAccelerator(42), null);
  assert.equal(accelerator.normalizeAccelerator("Control+Alt+Nope"), null);
});

test("rejects bare keys and reserved shortcuts", () => {
  for (const value of ["A", "Shift+A", "Command+Q", "Command+Space", "Control+Alt"]) {
    assert.equal(accelerator.validateAccelerator(value).ok, false, value);
  }
  assert.deepEqual(accelerator.validateAccelerator("Command+W"), {
    ok: false,
    reason: "That shortcut is reserved by macOS or common app commands.",
  });
  assert.deepEqual(accelerator.validateAccelerator("Control+Alt+Space"), { ok: true });
  assert.deepEqual(accelerator.validateAccelerator("Shift+Command+F5"), { ok: true });
});

test("maps key events by code", () => {
  const base = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  assert.equal(
    accelerator.acceleratorFromKeyEvent({ ...base, code: "KeyD", altKey: true, ctrlKey: true }),
    "Control+Alt+D",
  );
  assert.equal(
    accelerator.acceleratorFromKeyEvent({ ...base, code: "Digit1", metaKey: true, shiftKey: true }),
    "Shift+Command+1",
  );
  assert.equal(
    accelerator.acceleratorFromKeyEvent({ ...base, code: "ArrowUp", ctrlKey: true }),
    "Control+Up",
  );
  assert.equal(
    accelerator.acceleratorFromKeyEvent({ ...base, code: "AltLeft", altKey: true }),
    null,
  );
});

test("formats with macOS symbols", () => {
  assert.equal(accelerator.formatAccelerator("Control+Alt+Space"), "⌃⌥Space");
  assert.equal(accelerator.formatAccelerator("Control+Alt+Shift+Command+K"), "⌃⌥⇧⌘K");
});

test("reports a default macOS conflict when the plist has no entry", () => {
  assert.equal(
    accelerator.symbolicHotkeyConflict({}, "Control+Alt+Space"),
    "Select next source in Input menu",
  );
  assert.equal(accelerator.symbolicHotkeyConflict(null, "Command+Space"), "Show Spotlight search");
  assert.equal(accelerator.symbolicHotkeyConflict({}, "Control+Alt+D"), null);
});

test("honours a disabled entry", () => {
  const plist = {
    AppleSymbolicHotKeys: {
      61: { enabled: false, value: { parameters: [32, 49, 786432], type: "standard" } },
    },
  };
  assert.equal(accelerator.symbolicHotkeyConflict(plist, "Control+Alt+Space"), null);
});

test("detects a customized binding", () => {
  // Spotlight rebound to ⌥⌘D: ascii "d" (100), keyCode 2, Option + Command.
  const plist = {
    AppleSymbolicHotKeys: {
      64: { enabled: true, value: { parameters: [100, 2, 1572864], type: "standard" } },
    },
  };
  assert.equal(accelerator.symbolicHotkeyConflict(plist, "Alt+Command+D"), "Show Spotlight search");
  assert.equal(accelerator.symbolicHotkeyConflict(plist, "Command+Space"), null);
});

test("reserves ⌘N for DayBoard's New Item", () => {
  for (const value of ["Command+N", "Command+S", "Command+,", "Shift+Command+Z", "Command+T"]) {
    assert.equal(accelerator.validateAccelerator(value).ok, false, value);
  }
  assert.equal(accelerator.validateAccelerator("Control+Command+N").ok, true);
});
