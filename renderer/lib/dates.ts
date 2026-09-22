import type { CalendarEventItem } from "@main/shared-types";

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function longToday(): string {
  return new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function dayHeading(iso: string): string {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return parseISODate(iso).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export type DueColor = "red" | "orange" | "blue" | "secondary";

export function formatDue(date: string, time: string | null): { label: string; color: DueColor } {
  const today = todayISO();
  const clock = time ? ` ${formatClock(time)}` : "";
  if (date < today) return { label: `Overdue · ${shortDate(date)}`, color: "red" };
  if (date === today) return { label: `Today${clock}`, color: "orange" };
  if (date === addDays(today, 1)) return { label: `Tomorrow${clock}`, color: "blue" };
  return { label: `${shortDate(date)}${clock}`, color: "secondary" };
}

export function eventDayKey(event: CalendarEventItem): string {
  const key = event.allDay ? event.start.slice(0, 10) : toISODate(new Date(event.start));
  const today = todayISO();
  return key < today ? today : key;
}

export function eventTimeRange(event: CalendarEventItem): string {
  return event.allDay
    ? "All day"
    : `${formatTimeOfDay(event.start)} – ${formatTimeOfDay(event.end)}`;
}

export function isEventNow(event: CalendarEventItem): boolean {
  if (event.allDay) return false;
  const now = Date.now();
  return new Date(event.start).getTime() <= now && now < new Date(event.end).getTime();
}

export function isEventPast(event: CalendarEventItem): boolean {
  return !event.allDay && new Date(event.end).getTime() < Date.now();
}

export function formatMailDate(iso: string): string {
  const date = new Date(iso);
  return toISODate(date) === todayISO()
    ? formatTimeOfDay(iso)
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
