import type { CalendarEventItem } from "@main/shared-types";

export interface IdentifiedCalendarEvent extends CalendarEventItem {
  selectionKey: string;
}

function eventBaseKey(event: CalendarEventItem): string {
  return `event:${JSON.stringify([event.calendarId, event.id, event.start, event.end])}`;
}

/** Assign before filtering so a search cannot change which duplicate a selection identifies. */
export function identifyCalendarEvents(events: CalendarEventItem[]): IdentifiedCalendarEvent[] {
  const occurrences = new Map<string, number>();
  return events.map((event) => {
    const base = eventBaseKey(event);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { ...event, selectionKey: `${base}:${occurrence}` };
  });
}

export function calendarEventKey(event: CalendarEventItem): string {
  return "selectionKey" in event && typeof event.selectionKey === "string"
    ? event.selectionKey
    : `${eventBaseKey(event)}:0`;
}

export function selectedCalendarEvent(events: CalendarEventItem[], key: string | undefined) {
  if (!key) return undefined;
  const exact = events.find((event) => calendarEventKey(event) === key);
  if (exact) return exact;
  // Preserve old route links only when they identify one event unambiguously.
  const legacy = events.filter((event) => `event:${event.calendarId}:${event.id}` === key);
  return legacy.length === 1 ? legacy[0] : undefined;
}
