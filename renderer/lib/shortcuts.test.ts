import assert from "node:assert/strict";
import test from "node:test";

import { isNewItemShortcut, type KeyEventLike } from "./shortcuts";

function press(key: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

test("⌘N is the new item shortcut", () => {
  assert.equal(isNewItemShortcut(press("n", { metaKey: true })), true);
});

test("Caps Lock does not change the shortcut", () => {
  assert.equal(isNewItemShortcut(press("N", { metaKey: true })), true);
});

test("other modifier combinations are left to other commands", () => {
  assert.equal(isNewItemShortcut(press("n", { metaKey: true, shiftKey: true })), false);
  assert.equal(isNewItemShortcut(press("n", { metaKey: true, altKey: true })), false);
  assert.equal(isNewItemShortcut(press("n", { metaKey: true, ctrlKey: true })), false);
});

test("typing n without ⌘ never opens it", () => {
  assert.equal(isNewItemShortcut(press("n")), false);
  assert.equal(isNewItemShortcut(press("n", { ctrlKey: true })), false);
});

test("⌘ with another key does not match", () => {
  assert.equal(isNewItemShortcut(press("m", { metaKey: true })), false);
  assert.equal(isNewItemShortcut(press("[", { metaKey: true })), false);
});
