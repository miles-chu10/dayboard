import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarEventItem, SourceResult, TaskItem } from "@main/shared-types";

import { buildAgenda, findRelatedTodos, getAvailableSlots } from "./agenda";
import { agendaSpanDays, validateAgendaSearch } from "./agenda-search";
import { buildTodos, type Todo } from "./todos";

const now = new Date("2026-09-22T10:07:00");

test("Agenda route spans include saved relative ranges and retain the week alias", () => {
  assert.equal(agendaSpanDays("today", "2026-09-22"), 1);
  assert.equal(agendaSpanDays("today-tomorrow", "2026-09-22"), 2);
  assert.equal(agendaSpanDays("next-3-days", "2026-09-22"), 3);
  assert.equal(agendaSpanDays("week", "2026-09-22"), 7);
  assert.equal(agendaSpanDays("this-week", "2026-09-23"), 5);
  assert.equal(agendaSpanDays("this-week", "2026-09-27"), 1);
  assert.equal(agendaSpanDays("this-month", "2026-02-27"), 2);
  assert.equal(validateAgendaSearch({ span: "next-14-days" }).span, "next-14-days");
  assert.equal(validateAgendaSearch({ span: "week" }).span, "week");
  assert.equal(validateAgendaSearch({ span: "forever" }).span, undefined);
});

function event(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "event-1",
    title: "Design review",
    start: "2026-09-22T09:00:00",
    end: "2026-09-22T10:00:00",
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: null,
    calendarId: "primary",
    calendarName: "Primary",
    calendarColor: null,
    attendees: [],
    ...overrides,
  };
}

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    key: "task-1",
    source: "tasks",
    title: "Draft launch brief",
    notes: null,
    dueDate: "2026-09-22",
    dueTime: null,
    listTitle: "Work",
    completed: false,
    completedAt: null,
    ...overrides,
  };
}

test("buildAgenda preserves duplicate provider ids and spans overnight timed events", () => {
  const agenda = buildAgenda({
    events: [
      event({
        id: "duplicate",
        title: "First copy",
        start: "2026-09-22T23:00:00",
        end: "2026-09-23T01:00:00",
      }),
      event({
        id: "duplicate",
        title: "Second copy",
        start: "2026-09-22T23:00:00",
        end: "2026-09-23T01:00:00",
      }),
      event({
        id: "holiday",
        title: "Holiday",
        allDay: true,
        start: "2026-09-22",
        end: "2026-09-24",
      }),
    ],
    todos: [],
    startDate: "2026-09-22",
    days: 2,
    now,
  });

  assert.equal(agenda.days[0].allDay.length, 1);
  assert.equal(agenda.days[1].allDay.length, 1);
  assert.equal(agenda.days[0].timed.length, 2);
  assert.equal(agenda.days[1].timed.length, 2);
  assert.notEqual(agenda.days[0].timed[0].key, agenda.days[0].timed[1].key);
});

test("buildAgenda uses an exclusive all-day end and separates overdue, undated, and timed reminders", () => {
  const agenda = buildAgenda({
    events: [event({ allDay: true, start: "2026-09-22", end: "2026-09-23" })],
    todos: [
      todo({ key: "old", dueDate: "2026-09-21" }),
      todo({ key: "no-date", dueDate: null }),
      todo({ key: "reminder", source: "reminders", dueDate: "2026-09-22", dueTime: "08:30" }),
      todo({ key: "done", completed: true }),
    ],
    startDate: "2026-09-22",
    days: 2,
    now,
    sources: { tasks: false, reminders: true },
  });

  assert.deepEqual(agenda.overdue, []);
  assert.deepEqual(agenda.undated, []);
  assert.equal(agenda.days[0].allDay.length, 1);
  assert.equal(agenda.days[1].allDay.length, 0);
  assert.deepEqual(
    agenda.days[0].timed.map((entry) => entry.kind),
    ["todo"],
  );
  assert.equal(
    agenda.days[0].timed[0].kind === "todo" && agenda.days[0].timed[0].todo.key,
    "reminder",
  );
});

test("buildAgenda keeps an earlier timed deadline visible today and applies normalized search", () => {
  const agenda = buildAgenda({
    events: [
      event({ title: "Café planning", start: "2026-09-22T14:00:00", end: "2026-09-22T15:00:00" }),
    ],
    todos: [todo({ key: "deadline", title: "Café launch", dueTime: "09:00" })],
    startDate: "2026-09-22",
    days: 1,
    now,
    search: "cafe",
  });

  assert.equal(agenda.days[0].timed.length, 2);
  assert.equal(agenda.days[0].timed.find((entry) => entry.kind === "todo")?.kind, "todo");
});

test("buildAgenda orders offset calendar instants and local deadlines across the DST boundary", () => {
  const agenda = buildAgenda({
    events: [event({ id: "dst", start: "2026-03-08T09:30:00Z", end: "2026-03-08T10:00:00Z" })],
    todos: [
      todo({ key: "early", dueDate: "2026-03-08", dueTime: "00:30" }),
      todo({ key: "late-overdue", dueDate: "2026-03-07", dueTime: "20:00" }),
      todo({ key: "early-overdue", dueDate: "2026-03-06", dueTime: "21:00" }),
    ],
    startDate: "2026-03-08",
    days: 1,
    now: new Date("2026-03-08T10:30:00Z"),
  });

  assert.deepEqual(
    agenda.days[0].timed.map((entry) => entry.key),
    ["todo:early", "event:primary:dst:2026-03-08T09:30:00Z:2026-03-08T10:00:00Z:0"],
  );
  assert.deepEqual(
    agenda.overdue.map((item) => item.key),
    ["early-overdue", "late-overdue"],
  );
});

test("getAvailableSlots unions overlapping events, uses quarter-hour starts, and honors all-day busy", () => {
  const slots = getAvailableSlots(
    [
      event({ start: "2026-09-22T09:00:00", end: "2026-09-22T10:20:00" }),
      event({ id: "event-2", start: "2026-09-22T10:00:00", end: "2026-09-22T11:00:00" }),
    ],
    "2026-09-22",
    30,
    now,
    9,
    12,
  );

  assert.equal(slots[0].start.toTimeString().slice(0, 5), "11:00");
  assert.equal(slots[0].end.toTimeString().slice(0, 5), "11:30");
  assert.equal(
    getAvailableSlots(
      [event({ allDay: true, start: "2026-09-22", end: "2026-09-23" })],
      "2026-09-22",
      30,
      now,
    ).length,
    0,
  );
  assert.equal(getAvailableSlots([], "2026-09-21", 30, now).length, 0);
});

test("findRelatedTodos normalizes titles and returns suggestions without merging duplicates", () => {
  const source = todo({ key: "source", title: "Plan café launch" });
  const related = todo({ key: "related", title: "Cafe launch checklist" });
  const duplicateTitle = todo({ key: "duplicate", title: "Plan cafe launch" });
  const unrelated = todo({ key: "other", title: "File expenses" });

  assert.deepEqual(
    findRelatedTodos(source, [source, related, duplicateTitle, unrelated]).map((item) => item.key),
    ["duplicate", "related"],
  );
});

test("buildTodos scopes Google task keys by list and provider id", () => {
  const tasks: SourceResult<TaskItem> = {
    state: "ok",
    items: [
      {
        id: "shared-id",
        listId: "list-a",
        listTitle: "A",
        title: "First",
        notes: null,
        due: null,
        completed: false,
        completedAt: null,
      },
      {
        id: "shared-id",
        listId: "list-b",
        listTitle: "B",
        title: "Second",
        notes: null,
        due: null,
        completed: false,
        completedAt: null,
      },
    ],
  };

  assert.deepEqual(
    buildTodos(tasks, undefined).map((item) => item.key),
    ["task:list-a:shared-id", "task:list-b:shared-id"],
  );
});
