import type { CalendarEventItem } from "@main/shared-types";

import { addDays, parseISODate, toISODate } from "./dates";
import type { Todo } from "./todos";

export interface DayItems {
  allDay: CalendarEventItem[];
  timed: CalendarEventItem[];
  todos: Todo[];
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -parseISODate(iso).getDay());
}

/** Local dates an event covers (all-day end dates are exclusive). */
export function eventDays(event: CalendarEventItem): string[] {
  if (event.allDay) {
    const days: string[] = [];
    const end = event.end.slice(0, 10);
    for (let day = event.start.slice(0, 10); day < end && days.length < 62; day = addDays(day, 1))
      days.push(day);
    return days.length ? days : [event.start.slice(0, 10)];
  }
  const start = toISODate(new Date(event.start));
  // An event ending exactly at midnight doesn't occupy the next day.
  const end = toISODate(new Date(new Date(event.end).getTime() - 1));
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 62; day = addDays(day, 1)) days.push(day);
  return days;
}

export function groupByDay(
  events: CalendarEventItem[],
  todos: Todo[],
  dates: string[],
): Map<string, DayItems> {
  const map = new Map<string, DayItems>(
    dates.map((date) => [date, { allDay: [], timed: [], todos: [] }]),
  );
  for (const event of events)
    for (const day of eventDays(event)) {
      const bucket = map.get(day);
      if (bucket) (event.allDay ? bucket.allDay : bucket.timed).push(event);
    }
  for (const todo of todos) if (todo.dueDate) map.get(todo.dueDate)?.todos.push(todo);
  for (const bucket of map.values()) {
    bucket.timed.sort((a, b) => a.start.localeCompare(b.start));
    bucket.todos.sort((a, b) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99"));
  }
  return map;
}
