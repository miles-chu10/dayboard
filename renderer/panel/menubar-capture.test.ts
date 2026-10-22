import assert from "node:assert/strict";
import test from "node:test";

import { afterRejection } from "./menubar-capture";

test("a late rejection never replaces newer typing", () => {
  assert.deepEqual(afterRejection("Buy milk", "Call dentist", "License required"), {
    text: "Buy milk",
    error: "Couldn’t add “Call dentist”: License required",
  });
});

test("an empty box gets the rejected text back", () => {
  assert.deepEqual(afterRejection("  ", "Call dentist", "License required"), {
    text: "Call dentist",
    error: "Couldn’t add “Call dentist”: License required",
  });
});
