import assert from "node:assert/strict";
import test from "node:test";

import {
  SHORTCUTS,
  formatShortcut,
  isNewItemShortcut,
  isTypingTarget,
  matchesShortcut,
  shortcutGroups,
  stepRow,
  viewSlot,
  type KeyEventLike,
} from "./shortcuts";

function press(key: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
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

test("handled keys and input composition do not open a new item", () => {
  assert.equal(isNewItemShortcut(press("n", { metaKey: true, defaultPrevented: true })), false);
  assert.equal(isNewItemShortcut(press("n", { metaKey: true, isComposing: true })), false);
});

function chord(code: string, key: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}) {
  return press(key, { code, ...modifiers });
}

test("⌥⌘J matches on the physical key, whatever character Option types", () => {
  assert.equal(
    matchesShortcut(chord("KeyJ", "∆", { metaKey: true, altKey: true }), SHORTCUTS.askAgent),
    true,
  );
  assert.equal(matchesShortcut(chord("KeyJ", "j", { metaKey: true }), SHORTCUTS.askAgent), false);
  assert.equal(
    matchesShortcut(
      chord("KeyJ", "∆", { metaKey: true, altKey: true, shiftKey: true }),
      SHORTCUTS.askAgent,
    ),
    false,
  );
});

test("⌘K and ⌥⌘K are different commands", () => {
  const plain = chord("KeyK", "k", { metaKey: true });
  const option = chord("KeyK", "˚", { metaKey: true, altKey: true });
  assert.equal(matchesShortcut(plain, SHORTCUTS.commandMenu), true);
  assert.equal(matchesShortcut(plain, SHORTCUTS.calendarPeek), false);
  assert.equal(matchesShortcut(option, SHORTCUTS.calendarPeek), true);
  assert.equal(matchesShortcut(option, SHORTCUTS.commandMenu), false);
});

test("? needs Shift to type but no other modifier", () => {
  assert.equal(matchesShortcut(press("?", { shiftKey: true }), SHORTCUTS.shortcutsSheet), true);
  assert.equal(
    matchesShortcut(press("?", { shiftKey: true, metaKey: true }), SHORTCUTS.shortcutsSheet),
    false,
  );
});

test("handled and composing key presses match nothing", () => {
  const handled = chord("KeyK", "k", { metaKey: true, defaultPrevented: true });
  const composing = chord("KeyK", "k", { metaKey: true, isComposing: true });
  assert.equal(matchesShortcut(handled, SHORTCUTS.commandMenu), false);
  assert.equal(matchesShortcut(composing, SHORTCUTS.commandMenu), false);
});

test("shortcuts read in macOS modifier order", () => {
  assert.equal(formatShortcut(SHORTCUTS.askAgent), "⌥⌘J");
  assert.equal(formatShortcut(SHORTCUTS.commandMenu), "⌘K");
  assert.equal(formatShortcut(SHORTCUTS.shortcutsSheetAlt), "⌘/");
  assert.equal(formatShortcut({ code: "Digit3", ctrl: true }), "⌃3");
});

test("⌃1–⌃9 pick sidebar slots; other chords don't", () => {
  assert.equal(viewSlot(chord("Digit1", "1", { ctrlKey: true })), 0);
  assert.equal(viewSlot(chord("Digit9", "9", { ctrlKey: true })), 8);
  assert.equal(viewSlot(chord("Digit0", "0", { ctrlKey: true })), null);
  assert.equal(viewSlot(chord("Digit1", "1", { ctrlKey: true, metaKey: true })), null);
  assert.equal(viewSlot(chord("Digit1", "1")), null);
});

test("fields that take text block single-key shortcuts; buttons don't", () => {
  const element = (tagName: string, attributes: Record<string, string> = {}, editable = false) => ({
    tagName,
    isContentEditable: editable,
    getAttribute: (name: string) => attributes[name] ?? null,
  });
  assert.equal(isTypingTarget(element("INPUT")), true);
  assert.equal(isTypingTarget(element("INPUT", { type: "search" })), true);
  assert.equal(isTypingTarget(element("INPUT", { type: "checkbox" })), false);
  assert.equal(isTypingTarget(element("TEXTAREA")), true);
  assert.equal(isTypingTarget(element("DIV", {}, true)), true);
  assert.equal(isTypingTarget(element("DIV", { role: "textbox" })), true);
  assert.equal(isTypingTarget(element("BUTTON")), false);
  assert.equal(isTypingTarget(null), false);
});

test("the shortcut sheet lists each view's ⌃ number, at most nine", () => {
  const titles = Array.from({ length: 11 }, (_, index) => `View ${index + 1}`);
  const goTo = shortcutGroups(titles).find((group) => group.title === "Go to");
  assert.equal(goTo?.entries.length, 9);
  assert.deepEqual(goTo?.entries[2], { title: "View 3", keys: [["⌃", "3"]] });
});

test("no two General entries share a key combination", () => {
  const general = shortcutGroups([]).find((group) => group.title === "General")!;
  const combos = general.entries.flatMap((entry) => entry.keys.map((keys) => keys.join("")));
  assert.equal(new Set(combos).size, combos.length);
});

test("J and K step through rows and stop at the ends", () => {
  assert.equal(stepRow(-1, 3, "j"), 0);
  assert.equal(stepRow(-1, 3, "k"), 0);
  assert.equal(stepRow(0, 3, "J"), 1);
  assert.equal(stepRow(2, 3, "j"), 2);
  assert.equal(stepRow(1, 3, "k"), 0);
  assert.equal(stepRow(0, 3, "k"), 0);
  assert.equal(stepRow(0, 0, "j"), null);
  assert.equal(stepRow(0, 3, "x"), null);
});

test("the sheet lists the Inbox's single keys", () => {
  const mail = shortcutGroups([]).find((group) => group.title === "Mail");
  assert.deepEqual(
    mail?.entries.map((entry) => entry.keys[0].join("")),
    ["J", "K", "↩", "E", "R", "C"],
  );
});
