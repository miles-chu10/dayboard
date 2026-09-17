import { clipboard, ipcMain, logger, shell } from "@glaze/core/backend";

import {
  createEvent,
  createReplyDraft,
  createTask,
  getMessageBody,
  listEvents,
  listInbox,
  listTasks,
  modifyMessage,
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
  getRemindersAccess,
  listReminders,
  openRemindersPrivacySettings,
  requestRemindersAccess,
  setReminderCompleted,
} from "../services/apple-reminders.js";
import type { AccountsStatus, SourceResult } from "../shared-types.js";

// ── Input validation ────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function asObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, channel: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${channel}: "${key}" is required`);
  return value.trim();
}

function optionalString(obj: Record<string, unknown>, key: string, channel: string, pattern?: RegExp) {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${channel}: "${key}" must be a string`);
  if (pattern && !pattern.test(value)) throw new Error(`${channel}: "${key}" has an invalid format`);
  return value.trim();
}

function requireBoolean(obj: Record<string, unknown>, key: string, channel: string): boolean {
  if (typeof obj[key] !== "boolean") throw new Error(`${channel}: "${key}" must be a boolean`);
  return obj[key] as boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function getAccountsStatus(): Promise<AccountsStatus> {
  const [google, reminders] = await Promise.all([getGoogleStatus(), getRemindersAccess()]);
  return { google, reminders };
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

async function googleMutation<T>(channel: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logger.error("productivity", `${channel} failed`, error);
    throw error;
  }
}

// ── Registration ────────────────────────────────────────────────────────

export function registerProductivityHandlers(): void {
  // Accounts
  ipcMain.handle("accounts:getStatus", () => getAccountsStatus());

  ipcMain.handle("google:saveCredentials", async (_event, payload: unknown) => {
    const channel = "google:saveCredentials";
    const input = asObject(payload, channel);
    const clientId = requireString(input, "clientId", channel);
    const clientSecret = requireString(input, "clientSecret", channel);
    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      throw new Error("That doesn't look like a Google OAuth Client ID (it should end in .apps.googleusercontent.com).");
    }
    await saveGoogleCredentials(clientId, clientSecret);
    return broadcastAccounts();
  });

  ipcMain.handle("google:clearCredentials", async () => {
    await clearGoogleCredentials();
    return broadcastAccounts();
  });

  ipcMain.handle("google:connect", async () => {
    await googleMutation("google:connect", connectGoogle);
    return broadcastAccounts();
  });

  ipcMain.handle("google:disconnect", async () => {
    await disconnectGoogle();
    return broadcastAccounts();
  });

  ipcMain.handle("google:copyRedirectUri", () => {
    clipboard.writeText(GOOGLE_REDIRECT_URI);
    return GOOGLE_REDIRECT_URI;
  });

  // Google Tasks
  ipcMain.handle("tasks:list", () => googleList("tasks:list", listTasks));

  ipcMain.handle("tasks:setCompleted", async (_event, payload: unknown) => {
    const channel = "tasks:setCompleted";
    const input = asObject(payload, channel);
    const listId = requireString(input, "listId", channel);
    const taskId = requireString(input, "taskId", channel);
    const completed = requireBoolean(input, "completed", channel);
    await googleMutation(channel, () => setTaskCompleted(listId, taskId, completed));
  });

  ipcMain.handle("tasks:create", async (_event, payload: unknown) => {
    const channel = "tasks:create";
    const input = asObject(payload, channel);
    const task = {
      title: requireString(input, "title", channel),
      notes: optionalString(input, "notes", channel),
      due: optionalString(input, "due", channel, DATE_RE),
    };
    await googleMutation(channel, () => createTask(task));
  });

  // Apple Reminders
  ipcMain.handle("reminders:list", async (): Promise<SourceResult<unknown>> => {
    const access = await getRemindersAccess();
    if (access !== "full-access") return { state: "no-access", access };
    return { state: "ok", items: await listReminders() };
  });

  ipcMain.handle("reminders:requestAccess", async () => {
    await requestRemindersAccess();
    return broadcastAccounts();
  });

  ipcMain.handle("reminders:openSettings", () => openRemindersPrivacySettings());

  ipcMain.handle("reminders:setCompleted", async (_event, payload: unknown) => {
    const channel = "reminders:setCompleted";
    const input = asObject(payload, channel);
    const ref = requireString(input, "ref", channel);
    const completed = requireBoolean(input, "completed", channel);
    await setReminderCompleted(ref, completed);
  });

  ipcMain.handle("reminders:create", async (_event, payload: unknown) => {
    const channel = "reminders:create";
    const input = asObject(payload, channel);
    await createReminder({
      title: requireString(input, "title", channel),
      notes: optionalString(input, "notes", channel),
      dueDate: optionalString(input, "dueDate", channel, DATE_RE),
      dueTime: optionalString(input, "dueTime", channel, TIME_RE),
    });
  });

  // Gmail
  ipcMain.handle("mail:list", () => googleList("mail:list", listInbox));

  ipcMain.handle("mail:getBody", async (_event, payload: unknown) => {
    const channel = "mail:getBody";
    const id = requireString(asObject(payload, channel), "id", channel);
    return { text: await googleMutation(channel, () => getMessageBody(id)) };
  });

  ipcMain.handle("mail:createDraft", async (_event, payload: unknown) => {
    const channel = "mail:createDraft";
    const input = asObject(payload, channel);
    const id = requireString(input, "id", channel);
    const body = requireString(input, "body", channel);
    return googleMutation(channel, () => createReplyDraft(id, body));
  });

  ipcMain.handle("mail:archive", async (_event, payload: unknown) => {
    const channel = "mail:archive";
    const id = requireString(asObject(payload, channel), "id", channel);
    await googleMutation(channel, () => modifyMessage(id, ["INBOX"]));
  });

  ipcMain.handle("mail:markRead", async (_event, payload: unknown) => {
    const channel = "mail:markRead";
    const id = requireString(asObject(payload, channel), "id", channel);
    await googleMutation(channel, () => modifyMessage(id, ["UNREAD"]));
  });

  // Google Calendar
  ipcMain.handle("calendar:list", () => googleList("calendar:list", listEvents));

  ipcMain.handle("calendar:create", async (_event, payload: unknown) => {
    const channel = "calendar:create";
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
    await googleMutation(channel, () => createEvent(event));
  });

  // Links
  ipcMain.handle("app:openExternal", async (_event, payload: unknown) => {
    const channel = "app:openExternal";
    const url = requireString(asObject(payload, channel), "url", channel);
    if (new URL(url).protocol !== "https:") throw new Error(`${channel}: only https links can be opened`);
    await shell.openExternal(url);
  });
}
