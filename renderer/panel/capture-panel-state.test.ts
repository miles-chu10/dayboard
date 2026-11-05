import assert from "node:assert/strict";
import test from "node:test";

import { initialCaptureState, panelAiCapture, reduceCapturePanel } from "./capture-panel-state";

const available = { reminder: true, task: true, event: true };

const failedRecord = {
  id: "capture-1",
  text: "Call dentist Thursday 3pm",
  draft: null,
  partial: { kind: "reminder" as const, title: "Call dentist", date: "2026-10-22" },
  state: "failed" as const,
  error: "The time wasn't clear. Check the details, then add it.",
  reason: null,
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
    {
      key: "local-1",
      text: "Call dentist Thursday 3pm",
      error: "License required",
      partial: null,
      reason: null,
    },
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
    available,
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
    available,
    defaultKind: "reminder",
  });
  assert.equal(state.mode, "form");
  assert.equal(state.form?.kind, "reminder");
  const ai = reduceCapturePanel(initialCaptureState, {
    type: "shown",
    aiAvailable: true,
    available,
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
    available,
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
    available,
    defaultKind: "task",
  });
  assert.deepEqual(reduceCapturePanel(state, { type: "accountChanged" }), initialCaptureState);
});

for (const kind of ["task", "event"] as const) {
  test(`manual form switches from an unavailable destination to ${kind} after hydration`, () => {
    const initial = reduceCapturePanel(initialCaptureState, {
      type: "shown",
      aiAvailable: false,
      defaultKind: "reminder",
      available: { reminder: false, task: false, event: false },
    });
    const typed = reduceCapturePanel(initial, {
      type: "formChanged",
      patch: { title: "Keep this", notes: "Details", date: "2026-10-22" },
    });
    const hydrated = reduceCapturePanel(typed, {
      type: "shown",
      aiAvailable: false,
      defaultKind: kind,
      available: { reminder: false, task: kind === "task", event: kind === "event" },
    });
    assert.deepEqual(hydrated.form, { ...typed.form, kind });
  });
}

test("hydration preserves a valid user-selected destination and fields", () => {
  const initial = reduceCapturePanel(initialCaptureState, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "reminder",
    available,
  });
  const chosen = reduceCapturePanel(initial, {
    type: "formChanged",
    patch: { kind: "event", title: "Dentist", time: "10:00" },
  });
  const hydrated = reduceCapturePanel(chosen, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "task",
    available,
  });
  assert.deepEqual(hydrated.form, chosen.form);
});

test("no available destination preserves the draft until a source becomes usable", () => {
  const initial = reduceCapturePanel(initialCaptureState, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "task",
    available,
  });
  const typed = reduceCapturePanel(initial, { type: "formChanged", patch: { title: "Keep this" } });
  const disconnected = reduceCapturePanel(typed, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "reminder",
    available: { reminder: false, task: false, event: false },
  });
  assert.deepEqual(disconnected.form, typed.form);
});

test("text typed before settings load carries into the manual form", () => {
  const typed = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Buy milk" });
  const hydrated = reduceCapturePanel(typed, {
    type: "shown",
    aiAvailable: false,
    defaultKind: "task",
    available,
  });
  assert.equal(hydrated.mode, "form");
  assert.equal(hydrated.text, "");
  assert.equal(hydrated.form?.title, "Buy milk");
  const withAi = reduceCapturePanel(typed, {
    type: "shown",
    aiAvailable: true,
    defaultKind: "task",
    available,
  });
  assert.equal(withAi.text, "Buy milk");
});

const aiSettings = (capture: boolean) => ({
  ai: { enabled: true, providerChosen: true, features: { capture } },
});

test("a license that locks AI turns off AI capture in the panels, naming the lock", () => {
  for (const status of [
    { state: "expired" as const },
    { state: "invalid" as const, message: "Revoked", keyHint: "ABCD" },
    { state: "network-error" as const, keyHint: "ABCD", lastValidatedAt: "2026-09-01T00:00:00Z" },
  ])
    assert.deepEqual(panelAiCapture(aiSettings(true), status), {
      available: false,
      lock: status.state,
    });
  for (const status of [
    undefined,
    { state: "trial" as const, daysLeft: 3 },
    { state: "licensed" as const, keyHint: "ABCD" },
    { state: "unconfigured" as const },
    { state: "disabled" as const },
    { state: "demo" as const },
  ])
    assert.deepEqual(
      panelAiCapture(aiSettings(true), status),
      { available: true, lock: null },
      status?.state ?? "status still loading",
    );
  assert.deepEqual(panelAiCapture(aiSettings(false), { state: "expired" }), {
    available: false,
    lock: null,
  });
  assert.deepEqual(panelAiCapture(undefined, { state: "trial", daysLeft: 3 }), {
    available: false,
    lock: null,
  });
});

test("a locked AI license opens on the free manual form, every time it is shown", () => {
  const { available: aiAvailable } = panelAiCapture(aiSettings(true), { state: "expired" });
  const typed = reduceCapturePanel(initialCaptureState, { type: "typed", text: "Buy milk" });
  const shown = reduceCapturePanel(typed, {
    type: "shown",
    aiAvailable,
    defaultKind: "task",
    available,
  });
  assert.equal(shown.mode, "form");
  assert.equal(shown.form?.title, "Buy milk", "text typed before the status loaded is kept");
  const submitted = reduceCapturePanel(shown, { type: "submitted" });
  assert.equal(submitted.form, null);
  const again = reduceCapturePanel(submitted, {
    type: "shown",
    aiAvailable,
    defaultKind: "task",
    available,
  });
  assert.equal(again.mode, "form", "after a manual add, the next show is the form again");
  assert.equal(again.form?.title, "");
});

test("a parse the license refused is marked, so the panel can refresh the license", () => {
  const state = reduceCapturePanel(initialCaptureState, {
    type: "recordsChanged",
    records: [
      {
        ...failedRecord,
        partial: { title: failedRecord.text },
        error: "Your AI trial has ended, so DayBoard can't read this for you.",
        reason: "license",
      },
    ],
  });
  assert.equal(state.failures[0]?.reason, "license");
  const edited = reduceCapturePanel(state, {
    type: "editFailure",
    key: failedRecord.id,
    available,
    defaultKind: "task",
  });
  assert.equal(edited.mode, "form");
  assert.equal(edited.form?.title, failedRecord.text);
});
