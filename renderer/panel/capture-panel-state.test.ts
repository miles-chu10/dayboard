import assert from "node:assert/strict";
import test from "node:test";

import { initialCaptureState, reduceCapturePanel } from "./capture-panel-state";

const failedRecord = {
  id: "capture-1",
  text: "Call dentist Thursday 3pm",
  draft: null,
  partial: { kind: "reminder" as const, title: "Call dentist", date: "2026-10-22" },
  state: "failed" as const,
  error: "The time wasn't clear. Check the details, then add it.",
  createdAt: "2026-10-20T16:00:00.000Z",
  canUndo: false,
};

test("clears the input after submit", () => {
  const typed = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Buy milk" });
  assert.equal(reduceCapturePanel(typed, { type: "submitted" }).text, "");
});

test("queues a wrapper-level rejection without losing the text", () => {
  const typed = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Buy milk" });
  const state = reduceCapturePanel(typed, {
    type: "rejected",
    key: "local-1",
    text: "Call dentist Thursday 3pm",
    error: "License required",
  });
  assert.equal(state.text, "Buy milk");
  assert.deepEqual(state.failures, [
    { key: "local-1", text: "Call dentist Thursday 3pm", error: "License required", partial: null },
  ]);
});

test("keeps typed text when an earlier capture fails", () => {
  const typed = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Buy milk" });
  const state = reduceCapturePanel(typed, { type: "recordsChanged", records: [failedRecord] });
  assert.equal(state.text, "Buy milk");
  assert.equal(state.failures.length, 1);
  const again = reduceCapturePanel(state, { type: "recordsChanged", records: [failedRecord] });
  assert.equal(again.failures.length, 1, "a record is listed once");
});

test("editFailure loads the failed text into the manual form", () => {
  const failed = reduceCapturePanel(initialCaptureState, {
    type: "recordsChanged",
    records: [failedRecord],
  });
  const state = reduceCapturePanel(failed, {
    type: "editFailure",
    key: "capture-1",
    defaultKind: "task",
  });
  assert.equal(state.mode, "form");
  assert.deepEqual(state.form, {
    kind: "reminder",
    title: "Call dentist",
    notes: "",
    date: "2026-10-22",
    time: "",
    endTime: "",
  });
  assert.equal(state.failures.length, 0);
  const dismissed = reduceCapturePanel(failed, { type: "dismissFailure", key: "capture-1" });
  assert.equal(dismissed.failures.length, 0);
  const again = reduceCapturePanel(dismissed, { type: "recordsChanged", records: [failedRecord] });
  assert.equal(again.failures.length, 0, "a dismissed failure stays dismissed");
});

test("uses the manual form when AI capture is unavailable", () => {
  const state = reduceCapturePanel(initialCaptureState, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "reminder",
  });
  assert.equal(state.mode, "form");
  assert.equal(state.form?.kind, "reminder");
  const ai = reduceCapturePanel(initialCaptureState, {
    type: "shown",
    aiAvailable: true,
    defaultKind: "reminder",
  });
  assert.equal(ai.mode, "text");
});

test("a rejected manual capture keeps every field for Edit", () => {
  const draft = {
    kind: "event" as const,
    title: "Dentist",
    notes: "Bring forms",
    date: "2026-10-22",
    time: "15:00",
    endTime: "16:00",
  };
  const rejected = reduceCapturePanel(initialCaptureState, {
    type: "rejected",
    key: "local-2",
    text: "Dentist",
    error: "License required",
    partial: draft,
  });
  const edited = reduceCapturePanel(rejected, {
    type: "editFailure",
    key: "local-2",
    defaultKind: "task",
  });
  assert.deepEqual(edited.form, draft);
});

test("account reset removes old failures, recovered form and typed content", () => {
  let state = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Private draft" });
  state = reduceCapturePanel(state, { type: "recordsChanged", records: [failedRecord] });
  state = reduceCapturePanel(state, {
    type: "editFailure",
    key: failedRecord.id,
    defaultKind: "task",
  });
  assert.deepEqual(reduceCapturePanel(state, { type: "accountChanged" }), initialCaptureState);
});
