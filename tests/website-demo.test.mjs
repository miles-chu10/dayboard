import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState, reduceDemo } from "../website/assets/demo-state.js";

test("adding a suggestion once moves it into tasks without changing the original sample", () => {
  const initial = createDemoState();
  const added = reduceDemo(initial, { type: "add-suggestion", id: "s1" });
  assert.equal(added.tasks.length, initial.tasks.length + 1);
  assert.equal(
    added.suggestions.some((item) => item.id === "s1"),
    false,
  );
  assert.equal(
    reduceDemo(added, { type: "add-suggestion", id: "s1" }).tasks.length,
    added.tasks.length,
  );
  assert.equal(initial.suggestions.length, 2);
});

test("task completion, snoozed mail and notes all reset to independent fictional state", () => {
  let state = createDemoState();
  state = reduceDemo(state, { type: "toggle-task", id: "t1" });
  state = reduceDemo(state, { type: "mail-status", id: "m1", status: "snoozed" });
  state = reduceDemo(state, { type: "note", value: "A local draft" });
  assert.equal(state.tasks[0].done, true);
  assert.equal(state.mail[0].status, "snoozed");
  assert.equal(state.note, "A local draft");
  assert.deepEqual(reduceDemo(state, { type: "reset" }), createDemoState());
  assert.equal(createDemoState().tasks[0].done, false);
});

test("task inputs are bounded and blank additions do not change the sample", () => {
  let state = createDemoState();
  assert.equal(reduceDemo(state, { type: "add-task", title: "  " }), state);
  state = reduceDemo(state, { type: "add-task", title: "a".repeat(200) });
  assert.equal(state.tasks.at(-1).title.length, 120);
  for (let i = 0; i < 40; i++) state = reduceDemo(state, { type: "add-task", title: `Task ${i}` });
  assert.equal(state.tasks.length, 30);
  assert.equal(new Set(state.tasks.map((item) => item.id)).size, state.tasks.length);
});

test("unknown items and unsupported mail operations leave state intact", () => {
  const state = createDemoState();
  assert.equal(reduceDemo(state, { type: "mail-status", id: "m1", status: "send" }), state);
  assert.equal(reduceDemo(state, { type: "mail-status", id: "missing", status: "inbox" }), state);
  assert.deepEqual(reduceDemo(state, { type: "toggle-task", id: "missing" }), state);
  assert.equal(reduceDemo(state, { type: "note", value: "x".repeat(5000) }).note.length, 4000);
});
