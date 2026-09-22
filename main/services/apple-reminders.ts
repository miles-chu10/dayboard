import { reminders, systemPreferences } from "@glaze/core/backend";

import type { CreateReminderInput, ReminderItem, RemindersAccess } from "../shared-types.js";

type NativeReminder = Awaited<ReturnType<typeof reminders.getReminders>>["reminders"][number];

function toItem(reminder: NativeReminder, listTitles: Map<string, string>): ReminderItem {
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  if (reminder.due?.kind === "date") {
    dueDate = reminder.due.date.slice(0, 10);
  } else if (reminder.due?.kind === "date-time") {
    dueDate = reminder.due.dateTime.slice(0, 10);
    dueTime = reminder.due.dateTime.slice(11, 16) || null;
  }
  return {
    ref: reminder.ref.value,
    listTitle: listTitles.get(reminder.calendarId) ?? "Reminders",
    title: reminder.title.trim() || "(Untitled)",
    notes: reminder.notes?.trim() || null,
    dueDate,
    dueTime,
    priority: reminder.priority,
    completed: reminder.isCompleted,
    completedAt: reminder.completionDate,
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
  return page.reminders.map((reminder) => toItem(reminder, titles));
}

export function listReminders(): Promise<ReminderItem[]> {
  return listWith({ completed: false, limit: 200 });
}

export async function listCompletedReminders(since: Date): Promise<ReminderItem[]> {
  const items = await listWith({ completed: true, limit: 400 });
  return items.filter((item) => item.completedAt && new Date(item.completedAt) >= since);
}

export async function setReminderCompleted(ref: string, completed: boolean): Promise<void> {
  await reminders.updateReminder({ value: ref }, { isCompleted: completed });
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
