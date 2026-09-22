import type { CalendarRange } from "@main/shared-types";

export const CALENDAR_OPTIONS: { value: CalendarRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "today-tomorrow", label: "Today & Tomorrow" },
  { value: "next-3-days", label: "Next 3 days" },
  { value: "this-week", label: "This week (through Sunday)" },
  { value: "next-7-days", label: "Next 7 days" },
  { value: "next-14-days", label: "Next 2 weeks" },
  { value: "this-month", label: "Rest of this month" },
];
