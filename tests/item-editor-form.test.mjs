import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;

async function load() {
  const result = await build({
    entryPoints: [path.join(root, "renderer/lib/item-editor-form.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const event = (overrides = {}) => ({
  id: "occurrence-1",
  calendarId: "calendar-1",
  calendarName: "Work",
  calendarColor: null,
  title: "Planning",
  description: "<p>Line one</p><p>Line two</p>",
  location: null,
  start: "2026-09-22T16:00:00.000Z",
  end: "2026-09-22T17:00:00.000Z",
  allDay: false,
  htmlLink: null,
  meetLink: null,
  attendees: [],
  ...overrides,
});

test("task and reminder forms do not require calendar times to save", async () => {
  const form = await load();
  assert.equal(form.eventTimesAreValid({ allDay: false, start: "", end: "" }), false);
  assert.equal(form.itemEditorCanSave("task", { allDay: false, start: "", end: "" }), true);
  assert.equal(form.itemEditorCanSave("reminder", { allDay: false, start: "", end: "" }), true);
  assert.equal(form.itemEditorCanSave("event", { allDay: false, start: "", end: "" }), false);
  assert.equal(form.reminderDueChanged({ dueDate: "2026-09-24", dueTime: "09:30" }, { dueDate: "2026-09-24", dueTime: "09:30" }), false);
});

test("all-day form dates stay inclusive while provider payload dates stay exclusive", async () => {
  const form = await load();
  const fields = form.eventEditorFields(event({ allDay: true, start: "2026-10-02", end: "2026-10-05" }));
  assert.equal(fields.start, "2026-10-02");
  assert.equal(fields.end, "2026-10-04");
  assert.equal(form.nextCalendarDate(fields.end), "2026-10-05");
  assert.equal(form.eventTimesAreValid(fields), true);
});

test("unchanged calendar description and reminder deadline are omitted from provider changes", async () => {
  const form = await load();
  const original = event();
  const fields = form.eventEditorFields(original);
  assert.equal(fields.notes, "Line one\nLine two");
  assert.equal(form.changedCalendarDescription(original, fields), undefined);
  assert.equal(
    form.reminderDueChanged(
      { dueDate: "2026-09-24", dueTime: null },
      { dueDate: "2026-09-24", dueTime: "" },
    ),
    false,
  );
});

test("unchanged event times are omitted so the event keeps its own time zone", async () => {
  const form = await load();
  const original = event();
  const fields = form.eventEditorFields(original);
  assert.equal(form.eventTimesChanged(original, { ...fields, title: "Renamed" }), false);
  assert.equal(form.eventTimesChanged(original, { ...fields, allDay: true }), true);
  assert.equal(form.eventTimesChanged(original, { ...fields, end: "2026-09-22T11:00" }), true);
});
