import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  stdin: {
    contents: `
      export { buildAgenda, getAvailableSlots } from "./renderer/lib/agenda";
      export { identifyCalendarEvents, calendarEventKey } from "./renderer/lib/calendar-identity";
    `,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { buildAgenda, getAvailableSlots, identifyCalendarEvents, calendarEventKey } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const date = "2026-09-22";
const before = new Date("2026-01-01T08:00:00");
const clock = (value) => value.toTimeString().slice(0, 5);

function event(overrides = {}) {
  return {
    id: "event-1",
    calendarId: "primary",
    calendarName: "Primary",
    calendarColor: null,
    title: "Design review",
    start: `${date}T09:00:00`,
    end: `${date}T10:00:00`,
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    attendees: [],
    ...overrides,
  };
}

for (const invalidDate of [
  "2026-02-29",
  "2026-02-30",
  "2026-04-31",
  "2026-13-01",
  "2026-09-00",
  "2026-9-22",
  "2026-09-22T09:00:00",
  "not-a-date",
  "",
]) {
  test(`availability rejects invalid local date ${JSON.stringify(invalidDate)}`, () => {
    assert.deepEqual(getAvailableSlots([], invalidDate, 30, before), []);
  });
}

test("availability accepts a real leap day without changing the requested date", () => {
  const slots = getAvailableSlots([], "2028-02-29", 30, before);
  assert.equal(slots.length, 35);
  assert.ok(slots.every(({ start }) => start.getMonth() === 1 && start.getDate() === 29));
});

test("availability rejects work hours that roll outside the requested day or truncate", () => {
  for (const [start, end] of [
    [-1, 18],
    [9, 25],
    [23, 26],
    [9.5, 18],
    [9, 18.5],
    [18, 9],
    [9, 9],
    [NaN, 18],
    [9, Infinity],
  ]) {
    assert.deepEqual(getAvailableSlots([], date, 30, before, start, end), [], `${start}..${end}`);
  }
});

test("midnight is a valid exclusive workday end, not another day of suggested starts", () => {
  const slots = getAvailableSlots([], date, 30, before, 23, 24);
  assert.deepEqual(
    slots.map(({ start }) => clock(start)),
    ["23:00", "23:15", "23:30"],
  );
  assert.ok(slots.every(({ start }) => start.getDate() === 22));
  assert.equal(clock(slots.at(-1).end), "00:00");
  assert.equal(slots.at(-1).end.getDate(), 23);
});

test("invalid duration or clock and meetings longer than the workday return no slots", () => {
  for (const duration of [0, -1, NaN, Infinity, 541]) {
    assert.deepEqual(getAvailableSlots([], date, duration, before), []);
  }
  assert.deepEqual(getAvailableSlots([], date, 30, new Date(NaN)), []);
});

test("current time rounds up without offering a slot that has already started", () => {
  const slots = getAvailableSlots([], date, 30, new Date(`${date}T10:15:00.001`));
  assert.equal(clock(slots[0].start), "10:30");
  const aligned = getAvailableSlots([], date, 30, new Date(`${date}T10:15:00`));
  assert.equal(clock(aligned[0].start), "10:15");
  assert.deepEqual(getAvailableSlots([], date, 30, new Date(`${date}T17:30:00.001`)), []);
});

test("event boundaries are exclusive and an exact-sized gap remains bookable", () => {
  const events = [
    event({ start: `${date}T09:00:00`, end: `${date}T10:00:00` }),
    event({ id: "next", start: `${date}T10:30:00`, end: `${date}T12:00:00` }),
  ];
  const slots = getAvailableSlots(events, date, 30, before, 9, 12);
  assert.deepEqual(
    slots.map(({ start }) => clock(start)),
    ["10:00"],
  );
});

test("overnight events block only their overlapping part of the requested day", () => {
  const slots = getAvailableSlots(
    [event({ start: "2026-09-21T23:00:00", end: `${date}T10:15:00` })],
    date,
    30,
    before,
    9,
    12,
  );
  assert.equal(clock(slots[0].start), "10:15");
});

test("overlapping events are merged without mutating provider data", () => {
  const events = Object.freeze([
    Object.freeze(event({ start: `${date}T09:00:00`, end: `${date}T10:20:00` })),
    Object.freeze(event({ id: "next", start: `${date}T10:00:00`, end: `${date}T11:00:00` })),
  ]);
  const snapshot = JSON.stringify(events);
  const slots = getAvailableSlots(events, date, 30, before, 9, 12);
  assert.equal(clock(slots[0].start), "11:00");
  assert.equal(JSON.stringify(events), snapshot);
});

test("all-day event ends are exclusive across multiple local dates", () => {
  const events = [event({ allDay: true, start: "2026-09-21", end: "2026-09-23" })];
  assert.deepEqual(getAvailableSlots(events, date, 30, before), []);
  assert.equal(getAvailableSlots(events, "2026-09-23", 30, before).length, 35);
});

for (const transitionDate of ["2026-03-08", "2026-11-01"]) {
  test(`workday slots stay local and keep exact duration on ${transitionDate}`, () => {
    const slots = getAvailableSlots([], transitionDate, 30, before);
    assert.equal(slots.length, 35);
    assert.equal(clock(slots[0].start), "09:00");
    assert.equal(clock(slots.at(-1).end), "18:00");
    assert.ok(slots.every(({ start, end }) => end.getTime() - start.getTime() === 30 * 60_000));
    assert.ok(slots.every(({ start }) => start.getMinutes() % 15 === 0));
  });
}

test("Agenda construction preserves a pre-identified selection after upstream filtering", () => {
  const original = identifyCalendarEvents([event({ title: "First" }), event({ title: "Second" })]);
  const agenda = buildAgenda({
    events: [original[1]],
    todos: [],
    startDate: date,
    days: 1,
    now: before,
  });
  assert.equal(agenda.days[0].timed[0].key, calendarEventKey(original[1]));
  assert.equal(agenda.days[0].timed[0].event.title, "Second");
});

test("Agenda preserves pre-identified all-day keys after upstream filtering", () => {
  const original = identifyCalendarEvents([
    event({ title: "First", allDay: true, start: date, end: "2026-09-23" }),
    event({ title: "Second", allDay: true, start: date, end: "2026-09-23" }),
  ]);
  const agenda = buildAgenda({
    events: [original[1]],
    todos: [],
    startDate: date,
    days: 1,
    now: before,
  });
  assert.equal(calendarEventKey(agenda.days[0].allDay[0]), calendarEventKey(original[1]));
  assert.equal(agenda.days[0].allDay[0].title, "Second");
});
