import type { CalendarRange } from "@main/shared-types";

import { parseISODate, toISODate } from "./dates";

/** `week` remains valid for existing saved and linked Agenda routes. */
export type AgendaSpan = CalendarRange | "week";

export interface AgendaSearch {
  span?: AgendaSpan;
  date?: string;
  q?: string;
  item?: string;
  eventsOnly?: boolean;
  /** Calendar route only: grid layout. Schedule is the Agenda-style list. */
  view?: CalendarLayout;
}

export type CalendarLayout = "month" | "week" | "schedule";

const CALENDAR_SPANS: readonly CalendarRange[] = [
  "today",
  "today-tomorrow",
  "next-3-days",
  "this-week",
  "next-7-days",
  "next-14-days",
  "this-month",
];

/** Resolves a route span to the number of local dates it displays from `startDate`. */
export function agendaSpanDays(span: AgendaSpan, startDate: string): number {
  const start = parseISODate(startDate);
  switch (span) {
    case "today":
      return 1;
    case "today-tomorrow":
      return 2;
    case "next-3-days":
      return 3;
    case "week":
    case "next-7-days":
      return 7;
    case "next-14-days":
      return 14;
    case "this-week": {
      const weekday = start.getDay();
      return weekday === 0 ? 1 : 8 - weekday;
    }
    case "this-month": {
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return Math.round((end.getTime() - start.getTime()) / 86_400_000);
    }
  }
}

export function validateAgendaSearch(search: Record<string, unknown>): AgendaSearch {
  const date =
    typeof search.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(search.date) &&
    toISODate(parseISODate(search.date)) === search.date
      ? search.date
      : undefined;
  return {
    span:
      search.span === "week" ||
      (typeof search.span === "string" && CALENDAR_SPANS.includes(search.span as CalendarRange))
        ? (search.span as AgendaSpan)
        : undefined,
    date,
    q: typeof search.q === "string" ? search.q.slice(0, 200) || undefined : undefined,
    item: typeof search.item === "string" ? search.item : undefined,
    eventsOnly: search.eventsOnly === true || undefined,
    view:
      search.view === "month" || search.view === "week" || search.view === "schedule"
        ? search.view
        : undefined,
  };
}
