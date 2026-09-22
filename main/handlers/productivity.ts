import { createHash } from "node:crypto";

import { clipboard, ipcMain, logger, shell } from "@glaze/core/backend";

import {
  createEvent,
  createAgendaEvent,
  createReplyDraft,
  findAgendaEvent,
  getTaskInList,
  createTask,
  getMessageBody,
  listCalendars,
  listCompletedTasks,
  listEventsBetween,
  listInbox,
  listTasksWithCoverage,
  listEventsWithCoverage,
  listEventsBetweenWithCoverage,
  modifyMessage,
  searchRelatedMail,
  setTaskCompleted,
} from "../services/google-api.js";
import {
  GOOGLE_REDIRECT_URI,
  GoogleAuthError,
  clearGoogleCredentials,
  connectGoogle,
  disconnectGoogle,
  getGoogleStatus,
  saveGoogleCredentials,
} from "../services/google-auth.js";
import {
  createReminder,
  getReminder,
  getRemindersAccess,
  listCompletedReminders,
  listReminders,
  openRemindersPrivacySettings,
  requestRemindersAccess,
  setReminderCompleted,
} from "../services/apple-reminders.js";
import { calendarRangeDays } from "../services/calendar-range.js";
import {
  trackPendingWrite as trackProductivityWrite,
  drainPendingWrites,
  hasPendingWrites,
} from "../services/pending-writes.js";
import { getSettings } from "../services/settings-store.js";
import {
  completeAgendaBlock,
  abandonAgendaBlock,
  reconcileAgendaKeys,
  getAgendaState,
  prepareAgendaBlock,
  removeAgendaDuplicateLink,
  removeAgendaScheduledBlock,
  setAgendaDuplicateLink,
  setAgendaFocus,
} from "../services/agenda-store.js";
import { replacementAgendaKey } from "../../shared/agenda-identities.js";
import { localDateRange } from "../services/agenda-utils.js";
import {
  assertNotDemo,
  demoAccounts,
  demoCalendars,
  demoEventsBetween,
  demoEventsForDays,
  demoMail,
  demoMailBody,
  demoRelatedMail,
  demoReminders,
  demoReview,
  demoTasks,
  isDemoMode,
} from "../services/demo-data.js";
import type {
  AgendaCreateBlockInput,
  AgendaDuplicateLink,
  AgendaScheduledBlock,
  AgendaScopedState,
  AgendaState,
  AccountsStatus,
  CalendarListResult,
  ReminderItem,
  ReviewData,
  SourceResult,
} from "../shared-types.js";

// ── Input validation ────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const WEEK_MS = 7 * 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const agendaCreates = new Map<string, Promise<AgendaScheduledBlock>>();
let accountChanging = false;

async function changeAccount(operation: () => Promise<unknown>): Promise<void> {
  if (accountChanging || hasPendingWrites())
    throw new Error("Wait for the current save or account connection to finish, then try again.");
  accountChanging = true;
  try {
    await operation();
  } finally {
    accountChanging = false;
  }
}
/** Used by normal quit to avoid ending an acknowledged provider write mid-flight. */
export const hasPendingProductivityWrites = hasPendingWrites;
export const drainProductivityWrites = drainPendingWrites;

function asObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null)
    throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, channel: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${channel}: "${key}" is required`);
  return value.trim();
}

function requireShortString(
  obj: Record<string, unknown>,
  key: string,
  channel: string,
  max = 320,
): string {
  const value = requireString(obj, key, channel);
  if (value.length > max) throw new Error(`${channel}: "${key}" is too long`);
  return value;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  channel: string,
  pattern?: RegExp,
) {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${channel}: "${key}" must be a string`);
  if (pattern && !pattern.test(value))
    throw new Error(`${channel}: "${key}" has an invalid format`);
  return value.trim();
}

function requireBoolean(obj: Record<string, unknown>, key: string, channel: string): boolean {
  if (typeof obj[key] !== "boolean") throw new Error(`${channel}: "${key}" must be a boolean`);
  return obj[key] as boolean;
}

function requireDate(value: string, channel: string, field = "date"): string {
  if (!DATE_RE.test(value)) throw new Error(`${channel}: "${field}" has an invalid format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${channel}: "${field}" must be a real date`);
  }
  return value;
}

function requireTime(value: string, channel: string, field: string): string {
  if (!TIME_RE.test(value)) throw new Error(`${channel}: "${field}" has an invalid format`);
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59)
    throw new Error(`${channel}: "${field}" must be a real 24-hour time`);
  return value;
}

function requireUUID(value: unknown, channel: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new Error(`${channel}: "requestId" must be a UUID`);
  return value.toLowerCase();
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function getAccountsStatus(): Promise<AccountsStatus> {
  if (isDemoMode()) return demoAccounts;
  const [google, reminders] = await Promise.all([getGoogleStatus(), getRemindersAccess()]);
  return { google, reminders };
}

async function agendaScope(): Promise<string | null> {
  if (isDemoMode()) return "demo";
  const { email, connected } = await getGoogleStatus();
  if (accountChanging) return null;
  // A provider can be connected while its account identity is still unavailable.
  // Do not write that state into the anonymous local bucket.
  if (connected && !email) return null;
  if (!email) return "local";
  return `google:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}`;
}

function scopedAgenda(scope: string, state: AgendaState): AgendaScopedState {
  return { scope, state };
}

export async function requireAgendaScope(): Promise<string> {
  const scope = await agendaScope();
  if (!scope)
    throw new Error("Your connected account identity is still loading. Try again shortly.");
  return scope;
}

function broadcastAgenda(scope: string, state: AgendaState): void {
  ipcMain.broadcast("agenda:changed", scopedAgenda(scope, state));
}

export async function reconcileReminderAgendaState(
  items: ReminderItem[],
  previousRefs: readonly string[] = [],
  capturedScope?: string | null,
): Promise<void> {
  if (isDemoMode()) return;
  const scope = capturedScope === undefined ? await agendaScope() : capturedScope;
  if (!scope) return;
  const replacements = items.flatMap((item, index) => {
    const legacy = replacementAgendaKey(previousRefs[index] ?? item.ref, item);
    return legacy ? [legacy] : [];
  });
  if (!replacements.length) return;
  const result = await reconcileAgendaKeys(scope, replacements);
  if (result.changed) broadcastAgenda(scope, result.state);
}

export function requireExpectedAgendaScope(
  input: Record<string, unknown>,
  scope: string,
  channel: string,
): void {
  if (input.expectedScope !== scope) {
    throw new Error(
      `${channel}: account changed before this save could be applied. Refresh and try again.`,
    );
  }
}

async function broadcastAccounts(): Promise<AccountsStatus> {
  const status = await getAccountsStatus();
  ipcMain.broadcast("accounts:changed", status);
  return status;
}

async function googleList<T>(channel: string, load: () => Promise<T[]>): Promise<SourceResult<T>> {
  try {
    return { state: "ok", items: await load() };
  } catch (error) {
    if (error instanceof GoogleAuthError) return { state: error.reason };
    logger.error("productivity", `${channel} failed`, error);
    throw error;
  }
}

async function googleBoundedList<T>(
  channel: string,
  load: () => Promise<{
    items: T[];
    coverage: NonNullable<Extract<SourceResult<T>, { state: "ok" }>["coverage"]>;
  }>,
): Promise<SourceResult<T>> {
  try {
    const result = await load();
    return { state: "ok", ...result };
  } catch (error) {
    if (error instanceof GoogleAuthError) return { state: error.reason };
    logger.error("productivity", `${channel} failed`, error);
    throw error;
  }
}

async function remindersList<T>(load: () => Promise<T[]>): Promise<SourceResult<T>> {
  const access = await getRemindersAccess();
  if (access !== "full-access") return { state: "no-access", access };
  const items = await load();
  return {
    state: "ok",
    items,
    coverage: {
      complete: items.length < 200,
      loaded: items.length,
      ...(items.length >= 200 ? { reason: "item-cap" as const } : {}),
    },
  };
}

async function googleMutation<T>(channel: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.error("productivity", `${channel} failed`, error);
    throw error;
  }
}

function agendaInput(payload: unknown): AgendaCreateBlockInput {
  const channel = "agenda:createBlock";
  const input = asObject(payload, channel);
  const task = asObject(input.task, channel);
  const source = requireShortString(task, "source", channel, 20);
  const key = requireShortString(task, "key", channel);
  const requestId = requireUUID(input.requestId, channel);
  const date = requireDate(requireString(input, "date", channel), channel);
  const startTime = requireTime(requireString(input, "startTime", channel), channel, "startTime");
  const endTime = requireTime(requireString(input, "endTime", channel), channel, "endTime");
  if (endTime <= startTime) throw new Error(`${channel}: "endTime" must be after "startTime"`);
  const base = {
    requestId,
    title: requireString(input, "title", channel).slice(0, 300),
    date,
    startTime,
    endTime,
    timeZone: requireString(input, "timeZone", channel).slice(0, 80),
    notes: optionalString(input, "notes", channel)?.slice(0, 4_000),
  };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: base.timeZone });
  } catch {
    throw new Error(`${channel}: "timeZone" must be an IANA time zone`);
  }
  if (source === "tasks") {
    const listId = requireShortString(task, "listId", channel);
    const taskId = requireShortString(task, "taskId", channel);
    if (key !== `task:${listId}:${taskId}`)
      throw new Error(`${channel}: task key does not match its list and ID`);
    return { ...base, task: { key, source, listId, taskId } };
  }
  if (source === "reminders") {
    const ref = requireShortString(task, "ref", channel);
    const identity = requireShortString(task, "identity", channel);
    if (key !== `reminder:${identity}`)
      throw new Error(`${channel}: reminder key does not match its stable identity`);
    return { ...base, task: { key, source, identity, ref } };
  }
  throw new Error(`${channel}: "task.source" must be "tasks" or "reminders"`);
}

function duplicateLinkInput(payload: unknown, channel: string): AgendaDuplicateLink {
  const input = asObject(payload, channel);
  const leftKey = requireShortString(input, "leftKey", channel);
  const rightKey = requireShortString(input, "rightKey", channel);
  if (leftKey === rightKey) throw new Error(`${channel}: duplicate links need two different items`);
  const status = requireString(input, "status", channel);
  if (status !== "accepted" && status !== "dismissed")
    throw new Error(`${channel}: invalid duplicate-link status`);
  return { leftKey, rightKey, status };
}

async function verifyAgendaTodo(input: AgendaCreateBlockInput): Promise<void> {
  const settings = await getSettings();
  if (!settings.sources.calendar.enabled) throw new Error("Calendar is turned off in Settings.");
  if (input.task.source === "tasks") {
    if (!settings.sources.tasks.enabled) throw new Error("Google Tasks is turned off in Settings.");
    await getTaskInList(input.task.listId, input.task.taskId);
    return;
  }
  if (!settings.sources.reminders.enabled)
    throw new Error("Apple Reminders is turned off in Settings.");
  if ((await getRemindersAccess()) !== "full-access")
    throw new Error("Apple Reminders access is required.");
  await getReminder(input.task.ref);
}

async function verifyAgendaAvailability(input: AgendaCreateBlockInput): Promise<void> {
  const settings = await getSettings();
  // Include each side of the requested local day so events that cross midnight are checked too.
  const start = new Date(`${input.date}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${input.date}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  const result = await listEventsBetweenWithCoverage(start, end, settings.calendar.visibility);
  if (!result.coverage.complete) {
    throw new Error(
      "Calendar availability is only partially loaded. Refresh the calendar and try again.",
    );
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (value: string) => {
    const record = Object.fromEntries(
      formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
    );
    return {
      date: `${record.year}-${record.month}-${record.day}`,
      time: `${record.hour}:${record.minute}`,
    };
  };
  const current = parts(new Date().toISOString());
  if (input.date < current.date || (input.date === current.date && input.startTime <= current.time))
    throw new Error("Choose a future calendar time.");
  const collision = result.items.find((event) => {
    if (event.allDay) return event.start <= input.date && event.end > input.date;
    const eventStart = parts(event.start);
    const eventEnd = parts(event.end);
    if (eventStart.date > input.date || eventEnd.date < input.date) return false;
    const startTime = eventStart.date === input.date ? eventStart.time : "00:00";
    const endTime = eventEnd.date === input.date ? eventEnd.time : "24:00";
    return startTime < input.endTime && endTime > input.startTime;
  });
  if (collision) throw new Error(`That time overlaps “${collision.title}”. Choose another time.`);
}

async function persistAgendaBlock(scope: string, block: AgendaScheduledBlock): Promise<void> {
  try {
    const state = await completeAgendaBlock(scope, block);
    if (
      !state.scheduledBlocks.some(
        (entry) => entry.taskKey === block.taskKey && entry.eventId === block.eventId,
      )
    ) {
      throw new Error("Agenda link was not present after saving.");
    }
    broadcastAgenda(scope, state);
  } catch {
    throw new Error(
      "The calendar event may exist, but its source link could not be saved. Retry with the same request.",
    );
  }
}

async function createAgendaBlock(
  scope: string,
  input: AgendaCreateBlockInput,
): Promise<AgendaScheduledBlock> {
  await verifyAgendaTodo(input);
  const prepared = await prepareAgendaBlock(scope, {
    requestId: input.requestId,
    taskKey: input.task.key,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if (prepared.block) {
    if (
      prepared.block.taskKey !== input.task.key ||
      prepared.block.date !== input.date ||
      prepared.block.startTime !== input.startTime ||
      prepared.block.endTime !== input.endTime
    )
      throw new Error("This confirmation belongs to a different calendar block.");
    return prepared.block;
  }
  if (prepared.slotTaken) throw new Error("That task already has a calendar block for this time.");
  if (
    prepared.pending.taskKey !== input.task.key ||
    prepared.pending.date !== input.date ||
    prepared.pending.startTime !== input.startTime ||
    prepared.pending.endTime !== input.endTime
  ) {
    throw new Error("This confirmation request ID belongs to a different calendar block.");
  }

  input = { ...input, requestId: prepared.pending.requestId };
  const existing = await findAgendaEvent(input.requestId, new Date(`${input.date}T00:00:00.000Z`));
  if (existing) {
    const block: AgendaScheduledBlock = {
      taskKey: input.task.key,
      eventId: existing.id,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      requestId: input.requestId,
    };
    await persistAgendaBlock(scope, block);
    return block;
  }

  try {
    await verifyAgendaAvailability(input);
  } catch (error) {
    await abandonAgendaBlock(scope, input.requestId);
    throw error;
  }
  const event = await createAgendaEvent(
    {
      title: input.title,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      timeZone: input.timeZone,
      notes: input.notes,
    },
    input.requestId,
  );
  const block: AgendaScheduledBlock = {
    taskKey: input.task.key,
    eventId: event.id,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    requestId: input.requestId,
  };
  await persistAgendaBlock(scope, block);
  ipcMain.broadcast("data:changed", { source: "calendar" });
  return block;
}

// ── Registration ────────────────────────────────────────────────────────

export function registerProductivityHandlers(): void {
  // Accounts
  ipcMain.handle("accounts:getStatus", () => getAccountsStatus());

  ipcMain.handle("google:saveCredentials", async (_event, payload: unknown) => {
    const channel = "google:saveCredentials";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const clientId = requireString(input, "clientId", channel);
    const clientSecret = requireString(input, "clientSecret", channel);
    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      throw new Error(
        "That doesn't look like a Google OAuth Client ID (it should end in .apps.googleusercontent.com).",
      );
    }
    await changeAccount(() => saveGoogleCredentials(clientId, clientSecret));
    return broadcastAccounts();
  });

  ipcMain.handle("google:clearCredentials", async () => {
    assertNotDemo("google:clearCredentials");
    await changeAccount(clearGoogleCredentials);
    return broadcastAccounts();
  });

  ipcMain.handle("google:connect", async () => {
    assertNotDemo("google:connect");
    await changeAccount(() => googleMutation("google:connect", connectGoogle));
    return broadcastAccounts();
  });

  ipcMain.handle("google:disconnect", async () => {
    assertNotDemo("google:disconnect");
    await changeAccount(disconnectGoogle);
    return broadcastAccounts();
  });

  ipcMain.handle("google:copyRedirectUri", () => {
    clipboard.writeText(GOOGLE_REDIRECT_URI);
    return GOOGLE_REDIRECT_URI;
  });

  // Google Tasks
  ipcMain.handle("tasks:list", () =>
    isDemoMode() ? demoTasks() : googleBoundedList("tasks:list", listTasksWithCoverage),
  );

  ipcMain.handle("tasks:setCompleted", async (_event, payload: unknown) => {
    const channel = "tasks:setCompleted";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const listId = requireString(input, "listId", channel);
    const taskId = requireString(input, "taskId", channel);
    const completed = requireBoolean(input, "completed", channel);
    const scope = await requireAgendaScope();
    requireExpectedAgendaScope(input, scope, channel);
    await trackProductivityWrite(() =>
      googleMutation(channel, () => setTaskCompleted(listId, taskId, completed)),
    );
    ipcMain.broadcast("data:changed", { source: "tasks" });
  });

  ipcMain.handle("tasks:create", async (_event, payload: unknown) => {
    const channel = "tasks:create";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const task = {
      title: requireString(input, "title", channel),
      notes: optionalString(input, "notes", channel),
      due: optionalString(input, "due", channel, DATE_RE),
    };
    await trackProductivityWrite(() => googleMutation(channel, () => createTask(task)));
    ipcMain.broadcast("data:changed", { source: "tasks" });
  });

  // Apple Reminders
  ipcMain.handle("reminders:list", async () => {
    if (isDemoMode()) return demoReminders();
    const scope = await agendaScope();
    const result = await remindersList(listReminders);
    if (result.state === "ok") await reconcileReminderAgendaState(result.items, [], scope);
    return result;
  });

  ipcMain.handle("reminders:requestAccess", async () => {
    assertNotDemo("reminders:requestAccess");
    await requestRemindersAccess();
    return broadcastAccounts();
  });

  ipcMain.handle("reminders:openSettings", () => {
    assertNotDemo("reminders:openSettings");
    return openRemindersPrivacySettings();
  });

  ipcMain.handle("reminders:setCompleted", async (_event, payload: unknown) => {
    const channel = "reminders:setCompleted";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const ref = requireString(input, "ref", channel);
    const completed = requireBoolean(input, "completed", channel);
    const scope = await requireAgendaScope();
    requireExpectedAgendaScope(input, scope, channel);
    const updated = await trackProductivityWrite(async () => {
      const item = await setReminderCompleted(ref, completed);
      try {
        await reconcileReminderAgendaState([item], [ref], scope);
      } catch {
        // EventKit has already committed. Returning a rejected mutation would
        // cause the renderer to roll back a change that really happened.
        return {
          ...item,
          agendaSaveError:
            "Apple Reminders saved this change, but DayBoard could not save its updated item link. Keep the app open and retry refreshing.",
        };
      }
      return item;
    });
    ipcMain.broadcast("data:changed", { source: "reminders" });
    return updated;
  });

  ipcMain.handle("reminders:create", async (_event, payload: unknown) => {
    const channel = "reminders:create";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    await trackProductivityWrite(() =>
      createReminder({
        title: requireString(input, "title", channel),
        notes: optionalString(input, "notes", channel),
        dueDate: optionalString(input, "dueDate", channel, DATE_RE),
        dueTime: optionalString(input, "dueTime", channel, TIME_RE),
      }),
    );
    ipcMain.broadcast("data:changed", { source: "reminders" });
  });

  // Gmail
  ipcMain.handle("mail:list", async () => {
    const settings = await getSettings();
    if (isDemoMode()) return demoMail(settings.mail.maxMessages);
    return googleList("mail:list", () => listInbox(settings.mail.maxMessages));
  });

  ipcMain.handle("mail:related", async (_event, payload: unknown) => {
    const channel = "mail:related";
    const input = asObject(payload, channel);
    const emails = Array.isArray(input.emails)
      ? input.emails.filter((email): email is string => typeof email === "string").slice(0, 10)
      : [];
    const keywords = typeof input.keywords === "string" ? input.keywords.slice(0, 120) : "";
    if (isDemoMode()) return demoRelatedMail(emails);
    return googleList(channel, () => searchRelatedMail(emails, keywords));
  });

  ipcMain.handle("mail:getBody", async (_event, payload: unknown) => {
    const channel = "mail:getBody";
    const id = requireString(asObject(payload, channel), "id", channel);
    if (isDemoMode()) return { text: demoMailBody(id) };
    return { text: await googleMutation(channel, () => getMessageBody(id)) };
  });

  ipcMain.handle("mail:createDraft", async (_event, payload: unknown) => {
    const channel = "mail:createDraft";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const id = requireString(input, "id", channel);
    const body = requireString(input, "body", channel);
    const result = await trackProductivityWrite(() =>
      googleMutation(channel, () => createReplyDraft(id, body)),
    );
    ipcMain.broadcast("data:changed", { source: "mail" });
    return result;
  });

  ipcMain.handle("mail:archive", async (_event, payload: unknown) => {
    const channel = "mail:archive";
    assertNotDemo(channel);
    const id = requireString(asObject(payload, channel), "id", channel);
    await trackProductivityWrite(() => googleMutation(channel, () => modifyMessage(id, ["INBOX"])));
    ipcMain.broadcast("data:changed", { source: "mail" });
  });

  ipcMain.handle("mail:markRead", async (_event, payload: unknown) => {
    const channel = "mail:markRead";
    assertNotDemo(channel);
    const id = requireString(asObject(payload, channel), "id", channel);
    await trackProductivityWrite(() =>
      googleMutation(channel, () => modifyMessage(id, ["UNREAD"])),
    );
    ipcMain.broadcast("data:changed", { source: "mail" });
  });

  // Google Calendar
  ipcMain.handle("calendar:list", async () => {
    const settings = await getSettings();
    if (isDemoMode()) return demoEventsForDays(calendarRangeDays(settings.calendar.range));
    return googleBoundedList("calendar:list", () =>
      listEventsWithCoverage(
        calendarRangeDays(settings.calendar.range),
        settings.calendar.visibility,
      ),
    );
  });

  ipcMain.handle("calendar:listRange", async (_event, payload: unknown) => {
    const channel = "calendar:listRange";
    const input = asObject(payload, channel);
    const startDate = requireDate(requireString(input, "startDate", channel), channel, "startDate");
    const days = input.days;
    if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 42) {
      throw new Error(`${channel}: "days" must be an integer from 1 through 42`);
    }
    const settings = await getSettings();
    if (!settings.sources.calendar.enabled) return { state: "disabled" as const };
    const { start, end } = localDateRange(startDate, days as number);
    if (isDemoMode()) return demoEventsBetween(start, end);
    return googleBoundedList(channel, () =>
      listEventsBetweenWithCoverage(start, end, settings.calendar.visibility),
    );
  });

  ipcMain.handle("calendar:listCalendars", async (): Promise<CalendarListResult> => {
    if (isDemoMode()) return demoCalendars();
    try {
      return await listCalendars();
    } catch (error) {
      if (error instanceof GoogleAuthError) return { calendars: [], limited: false };
      logger.error("productivity", "calendar:listCalendars failed", error);
      throw error;
    }
  });

  ipcMain.handle("calendar:create", async (_event, payload: unknown) => {
    const channel = "calendar:create";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const event = {
      title: requireString(input, "title", channel),
      date: optionalString(input, "date", channel, DATE_RE) ?? "",
      startTime: optionalString(input, "startTime", channel, TIME_RE),
      endTime: optionalString(input, "endTime", channel, TIME_RE),
      timeZone: requireString(input, "timeZone", channel),
      notes: optionalString(input, "notes", channel),
    };
    if (!event.date) throw new Error("Events need a date.");
    await trackProductivityWrite(() => googleMutation(channel, () => createEvent(event)));
    ipcMain.broadcast("data:changed", { source: "calendar" });
  });

  // Agenda planning state. Scope selection stays in the backend so account identifiers never cross IPC.
  ipcMain.handle("agenda:getScope", async (): Promise<string> => {
    return requireAgendaScope();
  });

  ipcMain.handle("agenda:getState", async (): Promise<AgendaScopedState> => {
    const scope = await agendaScope();
    return scopedAgenda(
      scope ?? "unavailable",
      scope
        ? await getAgendaState(scope)
        : {
            focusKeys: [],
            duplicateLinks: [],
            scheduledBlocks: [],
          },
    );
  });

  ipcMain.handle(
    "agenda:setFocus",
    async (_event, payload: unknown): Promise<AgendaScopedState> => {
      const channel = "agenda:setFocus";
      const input = asObject(payload, channel);
      if (
        !Array.isArray(input.focusKeys) ||
        input.focusKeys.length > 100 ||
        input.focusKeys.some((key) => typeof key !== "string" || key.length > 320)
      ) {
        throw new Error(`${channel}: "focusKeys" must contain at most 100 short strings`);
      }
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(input, scope, channel);
      const state = await setAgendaFocus(scope, input.focusKeys);
      broadcastAgenda(scope, state);
      return scopedAgenda(scope, state);
    },
  );

  ipcMain.handle(
    "agenda:setDuplicateLink",
    async (_event, payload: unknown): Promise<AgendaScopedState> => {
      const input = asObject(payload, "agenda:setDuplicateLink");
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(input, scope, "agenda:setDuplicateLink");
      const state = await setAgendaDuplicateLink(
        scope,
        duplicateLinkInput(input, "agenda:setDuplicateLink"),
      );
      broadcastAgenda(scope, state);
      return scopedAgenda(scope, state);
    },
  );

  ipcMain.handle(
    "agenda:removeDuplicateLink",
    async (_event, payload: unknown): Promise<AgendaScopedState> => {
      const channel = "agenda:removeDuplicateLink";
      const input = asObject(payload, channel);
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(input, scope, channel);
      const state = await removeAgendaDuplicateLink(
        scope,
        requireShortString(input, "leftKey", channel),
        requireShortString(input, "rightKey", channel),
      );
      broadcastAgenda(scope, state);
      return scopedAgenda(scope, state);
    },
  );

  ipcMain.handle(
    "agenda:removeScheduledBlock",
    async (_event, payload: unknown): Promise<AgendaScopedState> => {
      const channel = "agenda:removeScheduledBlock";
      const input = asObject(payload, channel);
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(input, scope, channel);
      const state = await removeAgendaScheduledBlock(
        scope,
        requireShortString(input, "taskKey", channel),
        requireShortString(input, "eventId", channel),
      );
      broadcastAgenda(scope, state);
      return scopedAgenda(scope, state);
    },
  );

  ipcMain.handle(
    "agenda:createBlock",
    async (_event, payload: unknown): Promise<AgendaScheduledBlock> => {
      assertNotDemo("agenda:createBlock");
      const input = agendaInput(payload);
      const scope = await requireAgendaScope();
      requireExpectedAgendaScope(
        asObject(payload, "agenda:createBlock"),
        scope,
        "agenda:createBlock",
      );
      const key = `${scope}:${input.requestId}`;
      const existing = agendaCreates.get(key);
      if (existing) return existing;
      const operation = trackProductivityWrite(() => createAgendaBlock(scope, input)).finally(() =>
        agendaCreates.delete(key),
      );
      agendaCreates.set(key, operation);
      return operation;
    },
  );

  // Weekly review
  ipcMain.handle("review:data", async (): Promise<ReviewData> => {
    if (isDemoMode()) return demoReview();
    const settings = await getSettings();
    const since = new Date(Date.now() - WEEK_MS);
    const [tasks, reminders, events] = await Promise.all([
      settings.sources.tasks.enabled
        ? googleList("review:tasks", () => listCompletedTasks(since))
        : Promise.resolve({ state: "disabled" as const }),
      settings.sources.reminders.enabled
        ? remindersList(() => listCompletedReminders(since))
        : Promise.resolve({ state: "disabled" as const }),
      settings.sources.calendar.enabled
        ? googleList("review:events", () =>
            listEventsBetween(since, new Date(), settings.calendar.visibility),
          )
        : Promise.resolve({ state: "disabled" as const }),
    ]);
    return { since: since.toISOString(), tasks, reminders, events };
  });

  ipcMain.handle("app:isDemo", () => isDemoMode());

  // Links
  ipcMain.handle("app:openExternal", async (_event, payload: unknown) => {
    const channel = "app:openExternal";
    assertNotDemo(channel);
    const url = requireString(asObject(payload, channel), "url", channel);
    if (new URL(url).protocol !== "https:")
      throw new Error(`${channel}: only https links can be opened`);
    await shell.openExternal(url);
  });
}
