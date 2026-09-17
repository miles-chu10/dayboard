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

export async function listReminders(): Promise<ReminderItem[]> {
  const [calendars, page] = await Promise.all([
    reminders.getCalendars(),
    reminders.getReminders({ completed: false, limit: 200 }),
  ]);
  const titles = new Map(calendars.map((calendar) => [calendar.id, calendar.title]));
  return page.reminders.map((reminder) => toItem(reminder, titles));
}

export async function setReminderCompleted(ref: string, completed: boolean): Promise<void> {
  await reminders.updateReminder({ value: ref }, { isCompleted: completed });
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
