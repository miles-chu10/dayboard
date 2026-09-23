import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["renderer/lib/calendar-identity.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { calendarEventKey, identifyCalendarEvents, selectedCalendarEvent } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

function event(overrides = {}) {
  return {
    id: "shared-id",
    calendarId: "primary",
    calendarName: "Primary",
    calendarColor: null,
    title: "Design review",
    start: "2026-09-22T09:00:00",
    end: "2026-09-22T10:00:00",
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    attendees: [],
    ...overrides,
  };
}

function duplicateEvents() {
  return identifyCalendarEvents([event({ title: "First" }), event({ title: "Second" })]);
}

test("re-identifying a filtered event preserves its selection and original detail target", () => {
  const original = duplicateEvents();
  const filtered = identifyCalendarEvents([original[1]]);
  assert.equal(calendarEventKey(filtered[0]), calendarEventKey(original[1]));
  assert.equal(selectedCalendarEvent(original, calendarEventKey(filtered[0]))?.title, "Second");
});

test("re-identifying reordered events preserves each key without mutating inputs", () => {
  const original = duplicateEvents().map(Object.freeze);
  const reversed = Object.freeze([...original].reverse());
  const identified = identifyCalendarEvents(reversed);
  assert.deepEqual(identified.map(calendarEventKey), reversed.map(calendarEventKey));
  assert.notEqual(identified[0], reversed[0]);
});

test("fresh duplicates cannot claim keys reserved by identified events later in the list", () => {
  const original = duplicateEvents();
  const result = identifyCalendarEvents([event({ title: "New" }), ...original]);
  assert.deepEqual(result.slice(1).map(calendarEventKey), original.map(calendarEventKey));
  assert.equal(new Set(result.map(calendarEventKey)).size, 3);
  assert.ok(calendarEventKey(result[0]).endsWith(":2"));
});

test("identified subsets and newly appended duplicates remain unique on another pass", () => {
  const original = duplicateEvents();
  const result = identifyCalendarEvents([original[1], event({ title: "New" })]);
  assert.equal(calendarEventKey(result[0]), calendarEventKey(original[1]));
  assert.notEqual(calendarEventKey(result[0]), calendarEventKey(result[1]));
  assert.deepEqual(
    identifyCalendarEvents(result).map(calendarEventKey),
    result.map(calendarEventKey),
  );
});

test("a repeated supplied key is retained once and reassigned for the second entry", () => {
  const [first] = duplicateEvents();
  const result = identifyCalendarEvents([first, { ...first, title: "Repeated" }]);
  assert.equal(calendarEventKey(result[0]), calendarEventKey(first));
  assert.equal(new Set(result.map(calendarEventKey)).size, 2);
  assert.equal(selectedCalendarEvent(result, calendarEventKey(result[1]))?.title, "Repeated");
});

test("edited event bounds or provider identity invalidate a stale supplied key", () => {
  const [original] = duplicateEvents();
  for (const change of [
    { start: "2026-09-22T09:30:00" },
    { end: "2026-09-22T10:30:00" },
    { calendarId: "work" },
    { id: "different-id" },
  ]) {
    const changed = { ...original, ...change };
    const [identified] = identifyCalendarEvents([changed]);
    assert.notEqual(calendarEventKey(identified), calendarEventKey(original));
    assert.equal(calendarEventKey(changed), calendarEventKey(identified));
    assert.equal(selectedCalendarEvent([changed], calendarEventKey(original)), undefined);
  }
});

test("title-only edits retain the event selection", () => {
  const original = duplicateEvents()[1];
  const [renamed] = identifyCalendarEvents([{ ...original, title: "Renamed" }]);
  assert.equal(calendarEventKey(renamed), calendarEventKey(original));
});

test("invalid supplied selection keys are ignored rather than becoming route identities", () => {
  const raw = event();
  const canonical = calendarEventKey(raw);
  const prefix = canonical.slice(0, -1);
  for (const selectionKey of [
    "",
    "unrelated",
    `${prefix}-1`,
    `${prefix}01`,
    `${prefix}1.5`,
    7,
    null,
  ]) {
    const malformed = { ...raw, selectionKey };
    assert.equal(calendarEventKey(malformed), canonical);
    assert.equal(calendarEventKey(identifyCalendarEvents([malformed])[0]), canonical);
  }
});

test("legacy routes still resolve only when the provider identity is unambiguous", () => {
  const duplicate = duplicateEvents();
  assert.equal(selectedCalendarEvent(duplicate, "event:primary:shared-id"), undefined);
  const [unique] = identifyCalendarEvents([event({ id: "unique" })]);
  assert.equal(selectedCalendarEvent([unique], "event:primary:unique"), unique);
});
