import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../renderer/lib/shortcuts.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { isNewItemShortcut } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const key = (value, modifiers = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

test("New Item accepts Command+N with either Caps Lock state", () => {
  assert.equal(isNewItemShortcut(key("n", { metaKey: true })), true);
  assert.equal(isNewItemShortcut(key("N", { metaKey: true })), true);
});
test("New Item leaves Shift, Option and Control commands alone", () => {
  for (const modifier of ["shiftKey", "altKey", "ctrlKey"])
    assert.equal(isNewItemShortcut(key("n", { metaKey: true, [modifier]: true })), false);
});
test("typing N and Control+N do not open New Item", () => {
  assert.equal(isNewItemShortcut(key("n")), false);
  assert.equal(isNewItemShortcut(key("n", { ctrlKey: true })), false);
});
test("other Command keys are preserved", () => {
  for (const value of ["f", "m", "[", "Enter"])
    assert.equal(isNewItemShortcut(key(value, { metaKey: true })), false);
});
test("handled or composed keyboard input cannot open New Item", () => {
  for (const property of ["defaultPrevented", "isComposing"])
    assert.equal(isNewItemShortcut(key("n", { metaKey: true, [property]: true })), false);
});
test("holding Command+N cannot reopen the form through repeated key events", () => {
  assert.equal(isNewItemShortcut(key("n", { metaKey: true, repeat: true })), false);
});
