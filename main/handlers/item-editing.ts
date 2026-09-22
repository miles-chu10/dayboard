import { ipcMain } from "@glaze/core/backend";

import type { CalendarEventItem, ReminderItem, TaskItem } from "../shared-types.js";
import type {
  UpdateEventInput,
  UpdateReminderInput,
  UpdateTaskInput,
} from "../../shared/item-edits.js";
import {
  GoogleApiError,
  deleteEvent,
  deleteTask,
  getEventForEditing,
  listCalendars,
  updateEvent,
  updateTask,
} from "../services/google-api.js";
import { deleteReminder, updateReminder } from "../services/apple-reminders.js";
import { assertNotDemo, demoEventsForDays, isDemoMode } from "../services/demo-data.js";
import { trackPendingWrite } from "../services/pending-writes.js";
import { removeDeletedAgendaEvent } from "../services/agenda-store.js";
import {
  reconcileReminderAgendaState,
  requireAgendaScope,
  requireExpectedAgendaScope,
} from "./productivity.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function asObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null)
    throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

function requiredText(
  input: Record<string, unknown>,
  key: string,
  channel: string,
  max: number,
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${channel}: "${key}" is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${channel}: "${key}" is too long`);
  return normalized;
}

function editableText(
  input: Record<string, unknown>,
  key: string,
  channel: string,
  max: number,
): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`${channel}: "${key}" must be a string`);
  if (value.length > max) throw new Error(`${channel}: "${key}" is too long`);
  return value.trim();
}

function nullableString(
  input: Record<string, unknown>,
  key: string,
  channel: string,
): string | null {
  const value = input[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${channel}: "${key}" must be a string or null`);
  return value.trim();
}

function requireDate(value: string, channel: string, key: string): string {
  if (!DATE_RE.test(value)) throw new Error(`${channel}: "${key}" has an invalid format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error(`${channel}: "${key}" must be a real date`);
  return value;
}

function requireTime(value: string, channel: string, key: string): string {
  if (!TIME_RE.test(value)) throw new Error(`${channel}: "${key}" has an invalid format`);
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59)
    throw new Error(`${channel}: "${key}" must be a real 24-hour time`);
  return value;
}

function requireDateTime(value: string, channel: string, key: string): string {
  if (!RFC3339_RE.test(value) || !Number.isFinite(new Date(value).getTime()))
    throw new Error(`${channel}: "${key}" must be an RFC 3339 date-time with a UTC offset`);
  return value;
}

function requireTimeZone(value: string, channel: string): string {
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 80) throw new Error(`${channel}: "timeZone" is required`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`${channel}: "timeZone" must be an IANA time zone`);
  }
  return timeZone;
}

function taskEdit(payload: unknown): UpdateTaskInput {
  const channel = "tasks:update";
  const input = asObject(payload, channel);
  const due = nullableString(input, "due", channel);
  return {
    listId: requiredText(input, "listId", channel, 320),
    taskId: requiredText(input, "taskId", channel, 320),
    title: requiredText(input, "title", channel, 300),
    notes: editableText(input, "notes", channel, 8_000),
    due: due === null ? null : requireDate(due, channel, "due"),
  };
}

function reminderEdit(payload: unknown): UpdateReminderInput {
  const channel = "reminders:update";
  const input = asObject(payload, channel);
  if (typeof input.dueChanged !== "boolean")
    throw new Error(`${channel}: "dueChanged" must be a boolean`);
  const dueChanged = input.dueChanged;
  if (dueChanged && !("dueDate" in input && "dueTime" in input))
    throw new Error(`${channel}: changed due values are required`);
  const dueDate = dueChanged ? nullableString(input, "dueDate", channel) : undefined;
  const dueTime = dueChanged ? nullableString(input, "dueTime", channel) : undefined;
  if (dueDate === null && dueTime !== null)
    throw new Error(`${channel}: "dueTime" requires "dueDate"`);
  const priority = input.priority;
  if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 9)
    throw new Error(`${channel}: "priority" must be an integer from 0 through 9`);
  return {
    ref: requiredText(input, "ref", channel, 2_000),
    title: requiredText(input, "title", channel, 300),
    notes: editableText(input, "notes", channel, 8_000),
    dueChanged,
    dueDate:
      dueDate === undefined || dueDate === null
        ? dueDate
        : requireDate(dueDate, channel, "dueDate"),
    dueTime:
      dueTime === undefined || dueTime === null
        ? dueTime
        : requireTime(dueTime, channel, "dueTime"),
    priority: priority as number,
  };
}

function eventEdit(payload: unknown): UpdateEventInput {
  const channel = "calendar:update";
  const input = asObject(payload, channel);
  if (typeof input.allDay !== "boolean") throw new Error(`${channel}: "allDay" must be a boolean`);
  const allDay = input.allDay;
  const start = requiredText(input, "start", channel, 80);
  const end = requiredText(input, "end", channel, 80);
  if (allDay) {
    requireDate(start, channel, "start");
    requireDate(end, channel, "end");
    if (end <= start) throw new Error(`${channel}: "end" must be after "start"`);
  } else {
    requireDateTime(start, channel, "start");
    requireDateTime(end, channel, "end");
    if (new Date(end).getTime() <= new Date(start).getTime())
      throw new Error(`${channel}: "end" must be after "start"`);
  }
  return {
    calendarId: requiredText(input, "calendarId", channel, 320),
    eventId: requiredText(input, "eventId", channel, 320),
    title: requiredText(input, "title", channel, 300),
    description:
      input.description === undefined
        ? undefined
        : editableText(input, "description", channel, 8_000),
    location: editableText(input, "location", channel, 1_000),
    start,
    end,
    allDay,
    timeZone: requireTimeZone(requiredText(input, "timeZone", channel, 80), channel),
  };
}

function identifier(
  payload: unknown,
  channel: string,
  keys: readonly string[],
): Record<string, string> {
  const input = asObject(payload, channel);
  return Object.fromEntries(keys.map((key) => [key, requiredText(input, key, channel, 2_000)]));
}

async function withScope<T>(
  payload: unknown,
  channel: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertNotDemo(channel);
  const input = asObject(payload, channel);
  const scope = await requireAgendaScope();
  requireExpectedAgendaScope(input, scope, channel);
  return trackPendingWrite(operation);
}

async function calendarWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 403)
      throw new Error(
        "This Google Calendar is read-only or you do not have permission to change it.",
      );
    throw error;
  }
}

/** Registers mutations for editing one provider record at a time. */
export function registerItemEditingHandlers(): void {
  ipcMain.handle("tasks:update", async (_event, payload: unknown): Promise<TaskItem> => {
    const input = taskEdit(payload);
    const updated = await withScope(payload, "tasks:update", () => updateTask(input));
    ipcMain.broadcast("data:changed", { source: "tasks" });
    return updated;
  });

  ipcMain.handle("tasks:delete", async (_event, payload: unknown): Promise<void> => {
    const input = identifier(payload, "tasks:delete", ["listId", "taskId"]);
    await withScope(payload, "tasks:delete", () => deleteTask(input.listId, input.taskId));
    ipcMain.broadcast("data:changed", { source: "tasks" });
  });

  ipcMain.handle("reminders:update", async (_event, payload: unknown): Promise<ReminderItem> => {
    const input = reminderEdit(payload);
    assertNotDemo("reminders:update");
    const raw = asObject(payload, "reminders:update");
    const scope = await requireAgendaScope();
    requireExpectedAgendaScope(raw, scope, "reminders:update");
    const updated = await trackPendingWrite(() => updateReminder(input));
    try {
      await reconcileReminderAgendaState([updated], [input.ref], scope);
    } catch {
      const result = {
        ...updated,
        agendaSaveError:
          "Apple Reminders saved this change, but DayBoard could not save its updated item link. Keep the app open and refresh before editing this item again.",
      };
      ipcMain.broadcast("data:changed", { source: "reminders" });
      return result;
    }
    ipcMain.broadcast("data:changed", { source: "reminders" });
    return updated;
  });

  ipcMain.handle("reminders:delete", async (_event, payload: unknown): Promise<void> => {
    const input = identifier(payload, "reminders:delete", ["ref"]);
    await withScope(payload, "reminders:delete", () => deleteReminder(input.ref));
    ipcMain.broadcast("data:changed", { source: "reminders" });
  });

  ipcMain.handle(
    "calendar:update",
    async (_event, payload: unknown): Promise<CalendarEventItem> => {
      const input = eventEdit(payload);
      const updated = await withScope(payload, "calendar:update", () =>
        calendarWrite(() => updateEvent(input)),
      );
      ipcMain.broadcast("data:changed", { source: "calendar" });
      return updated;
    },
  );

  ipcMain.handle(
    "calendar:getForEditing",
    async (_event, payload: unknown): Promise<CalendarEventItem> => {
      const channel = "calendar:getForEditing";
      const input = identifier(payload, channel, ["calendarId", "eventId"]);
      const raw = asObject(payload, channel);
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(raw, scope, channel);
      if (isDemoMode()) {
        const result = demoEventsForDays(31);
        if (result.state !== "ok") throw new Error("Demo calendar is unavailable.");
        const event = result.items.find(
          (candidate) =>
            candidate.calendarId === input.calendarId && candidate.id === input.eventId,
        );
        if (!event) throw new Error("This demo calendar event is no longer available.");
        return event;
      }
      const event = await calendarWrite(() => getEventForEditing(input.calendarId, input.eventId));
      requireExpectedAgendaScope(raw, await requireAgendaScope(), channel);
      return event;
    },
  );

  ipcMain.handle(
    "calendar:delete",
    async (_event, payload: unknown): Promise<{ agendaSaveError?: string }> => {
      const input = identifier(payload, "calendar:delete", ["calendarId", "eventId"]);
      const raw = asObject(payload, "calendar:delete");
      const scope = await requireAgendaScope();
      return withScope(payload, "calendar:delete", async () => {
        const calendars = await listCalendars();
        const primary =
          input.calendarId === "primary" ||
          calendars.calendars.some(
            (calendar) => calendar.id === input.calendarId && calendar.primary,
          );
        requireExpectedAgendaScope(raw, await requireAgendaScope(), "calendar:delete");
        await calendarWrite(() => deleteEvent(input.calendarId, input.eventId));
        ipcMain.broadcast("data:changed", { source: "calendar" });
        if (primary) {
          try {
            const state = await removeDeletedAgendaEvent(scope, input.eventId);
            ipcMain.broadcast("agenda:changed", { scope, state });
          } catch {
            return {
              agendaSaveError:
                "Google Calendar deleted the event, but DayBoard could not remove its saved planning link. Keep the app open and refresh before planning it again.",
            };
          }
        }
        return {};
      });
    },
  );
}
