import { reminders, systemPreferences } from "@glaze/core/backend";

import type { CreateReminderInput, ReminderItem, RemindersAccess } from "../shared-types.js";
import type { UpdateReminderInput } from "../../shared/item-edits.js";

type NativeReminder = Awaited<ReturnType<typeof reminders.getReminders>>["reminders"][number];
const knownIdentities = new Map<string, string>();

function stableIdentity(reminder: NativeReminder): string {
  // JSON encoding preserves both tuple boundaries, unlike delimiter joining.
  return reminder.externalId
    ? JSON.stringify([reminder.calendarId, reminder.externalId])
    : reminder.ref.value;
}

function toItem(
  reminder: NativeReminder,
  listTitles: Map<string, string>,
  identity = stableIdentity(reminder),
): ReminderItem {
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  if (reminder.due?.kind === "date") {
    dueDate = reminder.due.date.slice(0, 10);
  } else if (reminder.due?.kind === "date-time") {
    dueDate = reminder.due.dateTime.slice(0, 10);
    dueTime = reminder.due.dateTime.slice(11, 16) || null;
  }
  return {
    identity,
    ref: reminder.ref.value,
    listTitle: listTitles.get(reminder.calendarId) ?? "Reminders",
    title: reminder.title.trim() || "(Untitled)",
    notes: reminder.notes?.trim() || null,
    dueDate,
    dueTime,
    priority: reminder.priority,
    completed: reminder.isCompleted,
    completedAt: reminder.completionDate,
    recurring: reminder.recurrenceRules.length > 0,
  };
}

export function getRemindersAccess(): Promise<RemindersAccess> {
  return reminders.status();
}

export async function requestRemindersAccess(): Promise<RemindersAccess> {
  const status = await reminders.status();
  return status === "not-determined" ? reminders.requestAccess() : status;
}

export async function openRemindersPrivacySettings(): Promise<void> {
  await systemPreferences.openPrivacySettings("reminders");
}

async function listWith(options: { completed: boolean; limit: number }): Promise<ReminderItem[]> {
  const [calendars, page] = await Promise.all([
    reminders.getCalendars(),
    reminders.getReminders(options),
  ]);
  const titles = new Map(calendars.map((calendar) => [calendar.id, calendar.title]));
  const items = page.reminders.map((reminder) => toItem(reminder, titles));
  const identityCounts = new Map<string, number>();
  for (const item of items)
    identityCounts.set(item.identity, (identityCounts.get(item.identity) ?? 0) + 1);
  // A provider identity collision is ambiguous. Retain each current opaque ref
  // instead of merging/migrating unrelated reminders.
  return items.map((item) => {
    const known = knownIdentities.get(item.ref);
    const resolved =
      known && known === item.identity && (identityCounts.get(item.identity) ?? 0) === 1
        ? { ...item, identity: known }
        : !page.truncated && (identityCounts.get(item.identity) ?? 0) === 1
          ? item
          : { ...item, identity: item.ref };
    knownIdentities.set(resolved.ref, resolved.identity);
    return resolved;
  });
}

export function listReminders(): Promise<ReminderItem[]> {
  return listWith({ completed: false, limit: 200 });
}

export async function listCompletedReminders(since: Date): Promise<ReminderItem[]> {
  const items = await listWith({ completed: true, limit: 400 });
  return items.filter((item) => item.completedAt && new Date(item.completedAt) >= since);
}

export async function setReminderCompleted(ref: string, completed: boolean): Promise<ReminderItem> {
  // Read display metadata before the write. If it fails, no mutation has been
  // attempted; after a successful mutation we always return its canonical ref.
  const calendars = await reminders.getCalendars();
  const previousIdentity = knownIdentities.get(ref);
  const updated = await reminders.updateReminder({ value: ref }, { isCompleted: completed });
  // Keep a provider identity whose uniqueness was established by the source list.
  // A ref-only identity follows the exact replacement lineage instead.
  const identity =
    previousIdentity && previousIdentity !== ref && stableIdentity(updated) === previousIdentity
      ? previousIdentity
      : updated.ref.value;
  knownIdentities.set(updated.ref.value, identity);
  return toItem(
    updated,
    new Map(calendars.map((calendar) => [calendar.id, calendar.title])),
    identity,
  );
}

function mutationIdentity(ref: string, updated: NativeReminder): string {
  const previousIdentity = knownIdentities.get(ref);
  const identity =
    previousIdentity && previousIdentity !== ref && stableIdentity(updated) === previousIdentity
      ? previousIdentity
      : updated.ref.value;
  knownIdentities.set(updated.ref.value, identity);
  return identity;
}

/** Updates one non-recurring reminder and returns EventKit's current canonical reference. */
export async function updateReminder(input: UpdateReminderInput): Promise<ReminderItem> {
  const [calendars, current] = await Promise.all([
    reminders.getCalendars(),
    reminders.getReminder({ value: input.ref }),
  ]);
  // The public SDK does not expose an occurrence-specific edit/delete operation.
  // Refusing a series prevents a request for one visible occurrence from changing every occurrence.
  if (current.recurrenceRules.length) {
    throw new Error(
      "Apple Reminders does not expose a safe one-occurrence edit here. Edit this recurring reminder in Apple Reminders.",
    );
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const patch = {
    title: input.title,
    priority: input.priority,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.dueChanged && input.dueDate
      ? {
          due: input.dueTime
            ? {
                kind: "date-time" as const,
                dateTime: `${input.dueDate}T${input.dueTime}:00`,
                timeZone,
              }
            : { kind: "date" as const, date: input.dueDate },
        }
      : {}),
    clearFields: [
      ...(input.notes ? [] : ["notes" as const]),
      ...(input.dueChanged && !input.dueDate ? ["due" as const] : []),
    ],
  };
  const updated = await reminders.updateReminder({ value: input.ref }, patch);
  return toItem(
    updated,
    new Map(calendars.map((calendar) => [calendar.id, calendar.title])),
    mutationIdentity(input.ref, updated),
  );
}

/** Deletes one non-recurring reminder. The SDK has no safe occurrence-only delete API for a series. */
export async function deleteReminder(ref: string): Promise<void> {
  const current = await reminders.getReminder({ value: ref });
  if (current.recurrenceRules.length) {
    throw new Error(
      "Apple Reminders does not expose a safe one-occurrence delete here. Delete this recurring reminder in Apple Reminders.",
    );
  }
  await reminders.deleteReminder({ value: ref });
}

/** Confirms a reminder reference still resolves before linking it to a calendar block. */
export async function getReminder(ref: string): Promise<void> {
  await reminders.getReminder({ value: ref });
}

export async function createReminder(input: CreateReminderInput): Promise<void> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await reminders.createReminder({
    title: input.title,
    notes: input.notes || undefined,
    due: input.dueDate
      ? input.dueTime
        ? { kind: "date-time", dateTime: `${input.dueDate}T${input.dueTime}:00`, timeZone }
        : { kind: "date", date: input.dueDate }
      : undefined,
  });
}
