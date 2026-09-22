import type { CalendarEventItem } from "@main/shared-types";

export interface IdentifiedCalendarEvent extends CalendarEventItem {
  selectionKey: string;
}

function eventBaseKey(event: CalendarEventItem): string {
  return `event:${JSON.stringify([event.calendarId, event.id, event.start, event.end])}`;
}

function existingSelectionKey(event: CalendarEventItem): string | undefined {
  const key = "selectionKey" in event ? event.selectionKey : undefined;
  const prefix = `${eventBaseKey(event)}:`;
  return typeof key === "string" &&
    key.startsWith(prefix) &&
    /^(0|[1-9]\d*)$/.test(key.slice(prefix.length))
    ? key
    : undefined;
}

/**
 * Assign before filtering. Existing identities survive subsets and reordering;
 * reserve them before allocating keys for newly added duplicate entries.
 */
export function identifyCalendarEvents(events: CalendarEventItem[]): IdentifiedCalendarEvent[] {
  const reserved = new Set(events.map(existingSelectionKey).filter((key) => key !== undefined));
  const used = new Set<string>();
  const occurrences = new Map<string, number>();
  return events.map((event) => {
    const existing = existingSelectionKey(event);
    if (existing && !used.has(existing)) {
      used.add(existing);
      return { ...event, selectionKey: existing };
    }
    const base = eventBaseKey(event);
    let occurrence = occurrences.get(base) ?? 0;
    let selectionKey = `${base}:${occurrence}`;
    while (reserved.has(selectionKey) || used.has(selectionKey)) {
      occurrence += 1;
      selectionKey = `${base}:${occurrence}`;
    }
    occurrences.set(base, occurrence + 1);
    used.add(selectionKey);
    return { ...event, selectionKey };
  });
}

export function calendarEventKey(event: CalendarEventItem): string {
  return existingSelectionKey(event) ?? `${eventBaseKey(event)}:0`;
}

export function selectedCalendarEvent(events: CalendarEventItem[], key: string | undefined) {
  if (!key) return undefined;
  const exact = events.find((event) => calendarEventKey(event) === key);
  if (exact) return exact;
  // Preserve old route links only when they identify one event unambiguously.
  const legacy = events.filter((event) => `event:${event.calendarId}:${event.id}` === key);
  return legacy.length === 1 ? legacy[0] : undefined;
}
