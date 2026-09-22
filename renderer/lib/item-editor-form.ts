import type { CalendarEventItem } from "@main/shared-types";

export interface ItemEditorFields {
  title: string;
  notes: string;
  dueDate: string;
  dueTime: string;
  priority: string;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
}

function calendarDateOffset(date: string, days: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function nextCalendarDate(date: string): string {
  return calendarDateOffset(date, 1);
}

export function previousCalendarDate(date: string): string {
  return calendarDateOffset(date, -1);
}

export function localDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function dateTimeInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** Google Calendar descriptions are HTML. The editor deliberately offers plain text. */
export function plainCalendarDescription(html: string | null): string {
  if (!html) return "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n");
  if (typeof DOMParser !== "undefined") {
    const text = new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }
  return withBreaks
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function eventEditorFields(event: CalendarEventItem): ItemEditorFields {
  return {
    title: event.title,
    notes: plainCalendarDescription(event.description),
    dueDate: "",
    dueTime: "",
    priority: "0",
    allDay: event.allDay,
    start: event.allDay ? event.start.slice(0, 10) : localDateTimeInput(event.start),
    // Calendar's all-day end is exclusive; the form is deliberately inclusive.
    end: event.allDay
      ? previousCalendarDate(event.end.slice(0, 10))
      : localDateTimeInput(event.end),
    location: event.location ?? "",
  };
}

export function eventTimesAreValid(
  fields: Pick<ItemEditorFields, "allDay" | "start" | "end">,
): boolean {
  if (!fields.start || !fields.end) return false;
  if (fields.allDay) return fields.end >= fields.start;
  return new Date(fields.end) > new Date(fields.start);
}

export function itemEditorCanSave(
  kind: "task" | "reminder" | "event",
  fields: Pick<ItemEditorFields, "allDay" | "start" | "end">,
): boolean {
  return kind !== "event" || eventTimesAreValid(fields);
}

export function reminderDueChanged(
  original: { dueDate: string | null; dueTime: string | null },
  fields: Pick<ItemEditorFields, "dueDate" | "dueTime">,
): boolean {
  return (
    original.dueDate !== (fields.dueDate || null) || original.dueTime !== (fields.dueTime || null)
  );
}

export function changedCalendarDescription(
  original: CalendarEventItem,
  fields: Pick<ItemEditorFields, "notes">,
): string | undefined {
  return fields.notes === plainCalendarDescription(original.description) ? undefined : fields.notes;
}
