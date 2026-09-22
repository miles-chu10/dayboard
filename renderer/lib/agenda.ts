import type { CalendarEventItem } from "@main/shared-types";

import { addDays, parseISODate, toISODate } from "./dates";
import { calendarEventKey, identifyCalendarEvents } from "./calendar-identity";
import type { Todo } from "./todos";

export interface AgendaSources {
  calendar?: boolean;
  tasks?: boolean;
  reminders?: boolean;
}

export interface BuildAgendaInput {
  events: CalendarEventItem[];
  todos: Todo[];
  /** First displayed local calendar date, formatted YYYY-MM-DD. */
  startDate: string;
  /** Number of consecutive local calendar dates to display. */
  days: number;
  /** Current local time. Kept explicit so agenda results are deterministic. */
  now: Date;
  /** Case- and accent-insensitive title/detail filter. */
  search?: string;
  /** Sources to include. Omitted source flags are included. */
  sources?: AgendaSources;
}

export type AgendaEntry =
  | { kind: "event"; key: string; event: CalendarEventItem }
  | { kind: "todo"; key: string; todo: Todo };

export interface AgendaDay {
  date: string;
  allDay: CalendarEventItem[];
  timed: AgendaEntry[];
  anytime: Todo[];
}

export interface Agenda {
  days: AgendaDay[];
  overdue: Todo[];
  undated: Todo[];
}

export interface AvailableSlot {
  /** Local Date objects; each slot has exactly the requested duration. */
  start: Date;
  end: Date;
}

const MINUTE = 60_000;
const QUARTER_HOUR = 15 * MINUTE;

function startOfDay(isoDate: string): Date {
  return parseISODate(isoDate);
}

function endOfDay(isoDate: string): Date {
  return startOfDay(addDays(isoDate, 1));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function matchesSearch(search: string, ...values: Array<string | null | undefined>): boolean {
  const needle = normalize(search);
  return (
    !needle ||
    values.some(
      (value) => value !== null && value !== undefined && normalize(value).includes(needle),
    )
  );
}

function sourceEnabled(
  source: "calendar" | Todo["source"],
  sources: AgendaSources | undefined,
): boolean {
  return sources?.[source] !== false;
}

function eventBounds(event: CalendarEventItem): { start: Date; end: Date } | null {
  const start = event.allDay ? startOfDay(event.start.slice(0, 10)) : new Date(event.start);
  const end = event.allDay ? startOfDay(event.end.slice(0, 10)) : new Date(event.end);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start
    ? null
    : { start, end };
}

function overlapsDay(event: CalendarEventItem, date: string): boolean {
  const bounds = eventBounds(event);
  if (!bounds) return false;
  return bounds.start < endOfDay(date) && bounds.end > startOfDay(date);
}

function compareEvents(a: CalendarEventItem, b: CalendarEventItem): number {
  return (
    a.start.localeCompare(b.start) ||
    a.end.localeCompare(b.end) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function compareTodos(a: Todo, b: Todo): number {
  const aKey = `${a.dueTime ?? "99:99"}:${a.title}:${a.key}`;
  const bKey = `${b.dueTime ?? "99:99"}:${b.title}:${b.key}`;
  return aKey.localeCompare(bKey);
}

function compareTodosByDeadline(a: Todo, b: Todo): number {
  const aKey = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
  const bKey = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
  return aKey.localeCompare(bKey) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

function entryTimestamp(entry: AgendaEntry): number {
  if (entry.kind === "event") return new Date(entry.event.start).getTime();
  const dateTime = `${entry.todo.dueDate}T${entry.todo.dueTime}:00`;
  return new Date(dateTime).getTime();
}

/**
 * Creates a display model without mutating provider data. All-day event ends are
 * exclusive; timed events appear on each local date they overlap.
 */
export function buildAgenda({
  events,
  todos,
  startDate,
  days,
  now,
  search = "",
  sources,
}: BuildAgendaInput): Agenda {
  const count = Math.max(0, Math.floor(days));
  const displayedDates = Array.from({ length: count }, (_, index) => addDays(startDate, index));
  const today = toISODate(now);
  const agendaDays = displayedDates.map<AgendaDay>((date) => ({
    date,
    allDay: [],
    timed: [],
    anytime: [],
  }));
  const dayByDate = new Map(agendaDays.map((day) => [day.date, day]));
  if (sourceEnabled("calendar", sources)) {
    for (const event of identifyCalendarEvents(events)) {
      if (
        !matchesSearch(search, event.title, event.location, event.description, event.calendarName)
      )
        continue;
      const key = calendarEventKey(event);
      for (const date of displayedDates) {
        const day = dayByDate.get(date);
        if (!day || !overlapsDay(event, date)) continue;
        if (event.allDay) day.allDay.push(event);
        else day.timed.push({ kind: "event", key, event });
      }
    }
  }

  const overdue: Todo[] = [];
  const undated: Todo[] = [];
  for (const todo of todos) {
    if (todo.completed || !sourceEnabled(todo.source, sources)) continue;
    if (!matchesSearch(search, todo.title, todo.notes, todo.listTitle)) continue;
    if (!todo.dueDate) {
      undated.push(todo);
      continue;
    }
    if (todo.dueDate < today) {
      overdue.push(todo);
      continue;
    }
    const day = dayByDate.get(todo.dueDate);
    if (!day) continue;
    if (todo.dueTime) day.timed.push({ kind: "todo", key: `todo:${todo.key}`, todo });
    else day.anytime.push(todo);
  }

  for (const day of agendaDays) {
    day.allDay.sort(compareEvents);
    day.timed.sort((a, b) => {
      const aTime = entryTimestamp(a);
      const bTime = entryTimestamp(b);
      return aTime - bTime || a.key.localeCompare(b.key);
    });
    day.anytime.sort(compareTodos);
  }
  overdue.sort(compareTodosByDeadline);
  undated.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));

  return { days: agendaDays, overdue, undated };
}

function ceilToQuarterHour(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / QUARTER_HOUR) * QUARTER_HOUR);
}

function clipTimedEvent(
  event: CalendarEventItem,
  dayStart: Date,
  dayEnd: Date,
): { start: Date; end: Date } | null {
  const bounds = eventBounds(event);
  if (!bounds || bounds.end <= dayStart || bounds.start >= dayEnd) return null;
  return {
    start: new Date(Math.max(bounds.start.getTime(), dayStart.getTime())),
    end: new Date(Math.min(bounds.end.getTime(), dayEnd.getTime())),
  };
}

/**
 * Returns every future 15-minute-aligned start on `date` where a meeting of the
 * requested duration fits inside local work hours and avoids all events.
 */
export function getAvailableSlots(
  events: CalendarEventItem[],
  date: string,
  durationMinutes: number,
  now: Date,
  workdayStartHour = 9,
  workdayEndHour = 18,
): AvailableSlot[] {
  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    workdayEndHour <= workdayStartHour
  )
    return [];

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const workStart = new Date(dayStart);
  workStart.setHours(workdayStartHour, 0, 0, 0);
  const workEnd = new Date(dayStart);
  workEnd.setHours(workdayEndHour, 0, 0, 0);
  const duration = durationMinutes * MINUTE;

  if (date < toISODate(now)) return [];

  if (events.some((event) => event.allDay && overlapsDay(event, date))) return [];

  const busy = events
    .filter((event) => !event.allDay)
    .map((event) => clipTimedEvent(event, dayStart, dayEnd))
    .filter((interval): interval is { start: Date; end: Date } => interval !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .reduce<Array<{ start: Date; end: Date }>>((merged, interval) => {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) {
        if (interval.end > previous.end) previous.end = interval.end;
      } else {
        merged.push(interval);
      }
      return merged;
    }, []);

  const earliest = toISODate(now) === date ? ceilToQuarterHour(now) : workStart;
  const firstStart = new Date(Math.max(workStart.getTime(), earliest.getTime()));
  const slots: AvailableSlot[] = [];
  for (
    let start = firstStart.getTime();
    start + duration <= workEnd.getTime();
    start += QUARTER_HOUR
  ) {
    const end = start + duration;
    if (
      !busy.some((interval) => start < interval.end.getTime() && end > interval.start.getTime())
    ) {
      slots.push({ start: new Date(start), end: new Date(end) });
    }
  }
  return slots;
}

const STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "to", "with"]);

function titleTokens(title: string): Set<string> {
  return new Set(
    normalize(title)
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

/** Returns similar open to-dos as suggestions; it never deduplicates or merges them. */
export function findRelatedTodos(todo: Todo, todos: Todo[]): Todo[] {
  const target = titleTokens(todo.title);
  if (!target.size) return [];
  return todos
    .filter((candidate) => !candidate.completed && candidate.key !== todo.key)
    .map((candidate) => {
      const tokens = titleTokens(candidate.title);
      const shared = [...target].filter((token) => tokens.has(token)).length;
      const union = new Set([...target, ...tokens]).size;
      const score = shared / union;
      return { candidate, score, shared };
    })
    .filter(({ score, shared }) => shared > 0 && (score >= 0.25 || shared >= 2))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.shared - a.shared ||
        a.candidate.title.localeCompare(b.candidate.title) ||
        a.candidate.key.localeCompare(b.candidate.key),
    )
    .map(({ candidate }) => candidate);
}
