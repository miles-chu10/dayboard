import assert from "node:assert/strict";
import test from "node:test";

import { chatAsNote } from "./chat-note";

test("a chat becomes a markdown note with each turn labeled", () => {
  const note = chatAsNote(
    "Plan my week",
    [
      { role: "user", content: "What's on Friday?" },
      { role: "assistant", content: "  Two meetings and the launch review.  " },
      { role: "assistant", content: "   " },
    ],
    new Date(2026, 10, 4),
  );
  assert.equal(note.title, "Plan my week");
  assert.equal(
    note.body,
    [
      "# Plan my week",
      "_Saved from the Assistant on November 4, 2026._",
      "**You:** What's on Friday?",
      "**Assistant:** Two meetings and the launch review.",
    ].join("\n\n"),
  );
});

test("an untitled chat gets a plain title", () => {
  assert.equal(chatAsNote("  ", [], new Date(2026, 10, 4)).title, "Assistant chat");
});
