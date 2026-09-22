import type { ReminderItem } from "../main/shared-types.js";

/**
 * An Apple reminder ref is an opaque, mutable transport reference. Prefer the
 * calendar-qualified provider id, falling back to the current ref only when
 * EventKit provides no stable identity.
 */
export function reminderIdentity(reminder: Pick<ReminderItem, "identity" | "ref">): string {
  return reminder.identity || reminder.ref;
}

export function reminderAgendaKey(reminder: Pick<ReminderItem, "identity" | "ref">): string {
  return `reminder:${reminderIdentity(reminder)}`;
}

/** A mutation proves this exact ref replacement; titles never participate. */
export function replacementAgendaKey(
  previousRef: string,
  result: Pick<ReminderItem, "identity" | "ref">,
): { previousKey: string; currentKey: string } | null {
  const previousKey = `reminder:${previousRef}`;
  const currentKey = reminderAgendaKey(result);
  return previousKey === currentKey ? null : { previousKey, currentKey };
}
