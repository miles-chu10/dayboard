import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const capture = await loadTs("shared/capture.ts");
const all = { task: true, reminder: true, event: true };
const json = (value) => JSON.stringify(value);

test("parseDraftStrict refuses an unavailable kind instead of switching it", () => {
  const result = capture.parseDraftStrict(
    json({ kind: "event", title: "Dentist", date: "2026-10-22", time: "15:00" }),
    { task: true, reminder: true, event: false },
  );
  assert.equal(result.ok, false);
  assert.equal(result.partial.kind, undefined);
  assert.equal(result.partial.title, "Dentist");
  assert.match(result.reason, /Calendar isn't available/);
});

test("parseDraftStrict refuses a malformed time instead of dropping it", () => {
  const result = capture.parseDraftStrict(
    json({ kind: "reminder", title: "Call dentist", date: "2026-10-22", time: "3pm" }),
    all,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "The time wasn't clear.");
});

test("parseDraftStrict keeps cleanly parsed fields in partial", () => {
  const result = capture.parseDraftStrict(
    json({ kind: "task", title: "Call dentist", date: "2026-10-22", time: "15:00" }),
    all,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Google Tasks can't hold a time. Choose a reminder or event.");
  assert.deepEqual(result.partial, {
    kind: "task",
    title: "Call dentist",
    date: "2026-10-22",
    time: "15:00",
  });
});

test("parseDraftStrict accepts a complete reminder", () => {
  assert.deepEqual(
    capture.parseDraftStrict(
      `Here you go: ${json({ kind: "reminder", title: " Call dentist ", notes: "", date: "2026-10-22", time: "15:00", endTime: "" })}`,
      all,
    ),
    {
      ok: true,
      draft: {
        kind: "reminder",
        title: "Call dentist",
        notes: "",
        date: "2026-10-22",
        time: "15:00",
        endTime: "",
      },
    },
  );
});

test("parseDraftStrict refuses impossible dates and events without a date", () => {
  assert.equal(
    capture.parseDraftStrict(json({ kind: "reminder", title: "X", date: "2026-02-30" }), all)
      .reason,
    "The date wasn't clear.",
  );
  assert.equal(
    capture.parseDraftStrict(json({ kind: "event", title: "Lunch", time: "12:30" }), all).reason,
    "Events need a date.",
  );
  assert.equal(capture.parseDraftStrict("not json", all).reason, "Couldn't read the details.");
});

test("aiCaptureEnabled requires the capture feature switch", () => {
  const settings = (enabled, captureOn) => ({
    ai: { enabled, features: { capture: captureOn } },
  });
  assert.equal(capture.aiCaptureEnabled(settings(true, true)), true);
  assert.equal(capture.aiCaptureEnabled(settings(true, false)), false);
  assert.equal(capture.aiCaptureEnabled(settings(false, true)), false);
});

test("availableKinds follows Google, Reminders access and source switches", () => {
  const sources = (tasks, reminders, calendar) => ({
    tasks: { enabled: tasks },
    reminders: { enabled: reminders },
    calendar: { enabled: calendar },
  });
  assert.deepEqual(
    capture.availableKinds({
      googleConnected: true,
      remindersAccess: "full-access",
      sources: sources(true, true, true),
    }),
    all,
  );
  assert.deepEqual(
    capture.availableKinds({
      googleConnected: false,
      remindersAccess: "full-access",
      sources: sources(true, true, true),
    }),
    { task: false, reminder: true, event: false },
  );
  assert.deepEqual(
    capture.availableKinds({
      googleConnected: true,
      remindersAccess: "denied",
      sources: sources(true, true, false),
    }),
    { task: true, reminder: false, event: false },
  );
});

test("parseDraft keeps today's behaviour", () => {
  assert.equal(capture.parseDraft(json({ kind: "task" }), all), null);
  assert.equal(
    capture.parseDraft(json({ kind: "event", title: "Lunch" }), {
      task: true,
      reminder: true,
      event: false,
    }).kind,
    "reminder",
  );
  assert.equal(
    capture.parseDraft(json({ kind: "event", title: "Lunch" }), {
      task: true,
      reminder: false,
      event: false,
    }).kind,
    "task",
  );
  assert.equal(
    capture.parseDraft(json({ kind: "reminder", title: "X", time: "3pm" }), all).time,
    "",
  );
});

test("normalizeDraft rejects an event without a date", () => {
  assert.deepEqual(
    capture.normalizeDraft(
      { kind: "event", title: "Lunch", notes: "", date: "", time: "", endTime: "" },
      all,
    ),
    { error: "Events need a date." },
  );
});

test("normalizeDraft trims and caps the title", () => {
  const draft = capture.normalizeDraft(
    {
      kind: "task",
      title: `  ${"a".repeat(600)}  `,
      notes: "",
      date: "",
      time: "09:00",
      endTime: "",
    },
    all,
  );
  assert.equal(draft.title.length, 500);
  assert.equal(draft.time, "", "tasks never keep a time");
  assert.deepEqual(capture.normalizeDraft({ kind: "task", title: "  " }, all), {
    error: "Add a title.",
  });
  assert.deepEqual(
    capture.normalizeDraft(
      { kind: "event", title: "X", date: "2026-10-22" },
      { ...all, event: false },
    ),
    {
      error: "Choose where to add it.",
    },
  );
});

test("describeCapture formats each kind", () => {
  const base = { notes: "", date: "", time: "", endTime: "" };
  assert.deepEqual(
    capture.describeCapture({ ...base, kind: "task", title: "Pay rent", date: "2026-10-22" }),
    {
      title: "Added to Google Tasks",
      body: "Pay rent · Thu, Oct 22",
    },
  );
  assert.deepEqual(
    capture.describeCapture({
      ...base,
      kind: "reminder",
      title: "Call dentist",
      date: "2026-10-22",
      time: "15:00",
    }),
    { title: "Added to Reminders", body: "Call dentist · Thu, Oct 22, 3:00 PM" },
  );
  assert.deepEqual(
    capture.describeCapture({
      ...base,
      kind: "event",
      title: "Lunch",
      date: "2026-10-23",
      time: "12:30",
      endTime: "13:30",
    }),
    { title: "Added to Calendar", body: "Lunch · Fri, Oct 23, 12:30 PM" },
  );
  assert.deepEqual(capture.describeCapture({ ...base, kind: "reminder", title: "Buy milk" }), {
    title: "Added to Reminders",
    body: "Buy milk",
  });
});

test("buildCapturePrompt lists only available kinds", () => {
  const prompt = capture.buildCapturePrompt(
    "Call dentist Thursday 3pm",
    { task: false, reminder: true, event: true },
    new Date(2026, 9, 20, 9, 0),
  );
  assert.match(prompt, /"reminder" — Apple Reminders/);
  assert.match(prompt, /"event" — Google Calendar/);
  assert.doesNotMatch(prompt, /"task" — Google Tasks/);
  assert.match(prompt, /Today's ISO date is 2026-10-20\./);
  assert.match(prompt, /Sentence: "Call dentist Thursday 3pm"/);
});
