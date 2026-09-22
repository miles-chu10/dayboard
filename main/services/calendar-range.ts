import type { CalendarRange } from "../shared-types.js";

export const CALENDAR_RANGES: CalendarRange[] = [
  "today",
  "today-tomorrow",
  "next-3-days",
  "this-week",
  "next-7-days",
  "next-14-days",
  "this-month",
];

/** Number of calendar days, starting today, covered by a relative range. */
export function calendarRangeDays(range: CalendarRange, now = new Date()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return 1;
    case "today-tomorrow":
      return 2;
    case "next-3-days":
      return 3;
    case "next-7-days":
      return 7;
    case "next-14-days":
      return 14;
    case "this-week": {
      // Through Sunday; on Sunday that's just today.
      const weekday = start.getDay();
      return weekday === 0 ? 1 : 8 - weekday;
    }
    case "this-month": {
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return Math.round((end.getTime() - start.getTime()) / 86_400_000);
    }
  }
}
