import type {
  CalendarEventItem,
  CalendarListResult,
  CreateEventInput,
  CreateTaskInput,
  GoogleCalendarInfo,
  MailItem,
  TaskItem,
} from "../shared-types.js";
import { GoogleAuthError, getGoogleAccessToken } from "./google-auth.js";

const TASKS = "https://tasks.googleapis.com/tasks/v1";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

const enc = encodeURIComponent;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeGoogleError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Non-JSON body
  }
  return body.slice(0, 200);
}

async function googleFetch<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
  attempt = 0,
): Promise<T> {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if ((response.status === 429 || response.status === 503) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await sleep(delay + Math.random() * 250);
    return googleFetch<T>(url, init, attempt + 1);
  }
  if (response.status === 401) {
    throw new GoogleAuthError("not-connected", "Google session expired. Reconnect your account.");
  }
  if (!response.ok) {
    const detail = describeGoogleError(await response.text());
    throw new GoogleApiError(response.status, `Google API error ${response.status} (${new URL(url).hostname}): ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Google Tasks ────────────────────────────────────────────────────────

interface GTaskList {
  id: string;
  title: string;
}

interface GTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
  completed?: string;
}

async function listTasksWith(query: string): Promise<TaskItem[]> {
  const lists = await googleFetch<{ items?: GTaskList[] }>(`${TASKS}/users/@me/lists?maxResults=20`);
  const perList = await mapWithConcurrency(lists.items ?? [], 4, async (list) => {
    const data = await googleFetch<{ items?: GTask[] }>(`${TASKS}/lists/${enc(list.id)}/tasks?${query}`);
    return (data.items ?? [])
      .filter((task) => task.title?.trim())
      .map<TaskItem>((task) => ({
        id: task.id,
        listId: list.id,
        listTitle: list.title,
        title: task.title!.trim(),
        notes: task.notes?.trim() || null,
        due: task.due ? task.due.slice(0, 10) : null,
        completed: task.status === "completed",
        completedAt: task.completed ?? null,
      }));
  });
  return perList.flat();
}

export function listTasks(): Promise<TaskItem[]> {
  return listTasksWith("showCompleted=false&showHidden=false&maxResults=100");
}

export async function listCompletedTasks(since: Date): Promise<TaskItem[]> {
  const tasks = await listTasksWith(
    `showCompleted=true&showHidden=true&completedMin=${enc(since.toISOString())}&maxResults=100`,
  );
  return tasks.filter((task) => task.completed);
}

export async function setTaskCompleted(listId: string, taskId: string, completed: boolean): Promise<void> {
  await googleFetch(`${TASKS}/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "PATCH",
    body: completed ? { status: "completed" } : { status: "needsAction", completed: null },
  });
}

export async function createTask(input: CreateTaskInput): Promise<void> {
  await googleFetch(`${TASKS}/lists/@default/tasks`, {
    method: "POST",
    body: {
      title: input.title,
      notes: input.notes || undefined,
      due: input.due ? `${input.due}T00:00:00.000Z` : undefined,
    },
  });
}

// ── Gmail ───────────────────────────────────────────────────────────────

interface GHeader {
  name: string;
  value: string;
}

interface GMessagePart {
  mimeType?: string;
  headers?: GHeader[];
  body?: { data?: string };
  parts?: GMessagePart[];
}

interface GMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GMessagePart;
}

function header(message: GMessage, name: string): string {
  const lower = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseAddress(value: string): { name: string; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || match[2], email: match[2].trim() };
  return { name: value.trim(), email: value.trim() };
}

async function listMessages(query: string, max: number): Promise<MailItem[]> {
  const list = await googleFetch<{ messages?: { id: string }[] }>(
    `${GMAIL}/messages?maxResults=${max}&q=${enc(query)}`,
  );
  const messages = await mapWithConcurrency(list.messages ?? [], 5, (m) =>
    googleFetch<GMessage>(
      `${GMAIL}/messages/${enc(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    ),
  );
  return messages.map((message) => {
    const from = parseAddress(header(message, "From"));
    return {
      id: message.id,
      threadId: message.threadId,
      from: from.name,
      fromEmail: from.email,
      subject: header(message, "Subject") || "(no subject)",
      snippet: decodeEntities(message.snippet ?? ""),
      date: new Date(Number(message.internalDate ?? Date.now())).toISOString(),
      unread: message.labelIds?.includes("UNREAD") ?? false,
    };
  });
}

export function listInbox(max: number): Promise<MailItem[]> {
  return listMessages("in:inbox", max);
}

/** Recent mail involving any of the given people, or mentioning the keywords when there are none. */
export function searchRelatedMail(emails: string[], keywords: string): Promise<MailItem[]> {
  const people = emails.map((email) => email.replace(/["()\s]/g, "")).filter((email) => email.includes("@"));
  const terms = keywords.replace(/["()]/g, " ").trim();
  const query = people.length
    ? `(${people.map((email) => `from:${email} OR to:${email}`).join(" OR ")}) newer_than:60d`
    : terms
      ? `"${terms}" newer_than:60d`
      : "";
  return query ? listMessages(query, 8) : Promise.resolve([]);
}

function findPart(part: GMessagePart | undefined, mimeType: string): GMessagePart | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

export async function getMessageBody(id: string): Promise<string> {
  const message = await googleFetch<GMessage>(`${GMAIL}/messages/${enc(id)}?format=full`);
  const plain = findPart(message.payload, "text/plain");
  let text: string;
  if (plain?.body?.data) {
    text = Buffer.from(plain.body.data, "base64url").toString("utf8");
  } else {
    const html = findPart(message.payload, "text/html");
    text = html?.body?.data
      ? decodeEntities(
          Buffer.from(html.body.data, "base64url")
            .toString("utf8")
            .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
            .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
            .replace(/<[^>]+>/g, ""),
        )
      : decodeEntities(message.snippet ?? "");
  }
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
}

function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export async function createReplyDraft(id: string, body: string): Promise<{ draftId: string }> {
  const original = await googleFetch<GMessage>(
    `${GMAIL}/messages/${enc(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`,
  );
  const to = (header(original, "Reply-To") || header(original, "From")).replace(/[\r\n]+/g, " ");
  const subject = header(original, "Subject");
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const messageId = header(original, "Message-ID").replace(/[\r\n]+/g, "");
  const references = [header(original, "References").replace(/[\r\n]+/g, " "), messageId]
    .filter(Boolean)
    .join(" ");

  const lines = [
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(replySubject)}`,
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  const draft = await googleFetch<{ id: string }>(`${GMAIL}/drafts`, {
    method: "POST",
    body: { message: { raw, threadId: original.threadId } },
  });
  return { draftId: draft.id };
}

export async function modifyMessage(id: string, removeLabelIds: string[]): Promise<void> {
  await googleFetch(`${GMAIL}/messages/${enc(id)}/modify`, { method: "POST", body: { removeLabelIds } });
}

// ── Google Calendar ─────────────────────────────────────────────────────

interface GCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
}

interface GEventTime {
  date?: string;
  dateTime?: string;
}

interface GEvent {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  start?: GEventTime;
  end?: GEventTime;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: { email?: string; resource?: boolean; self?: boolean }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

export async function listCalendars(): Promise<CalendarListResult> {
  try {
    const data = await googleFetch<{ items?: GCalendarListEntry[] }>(
      `${CALENDAR}/users/me/calendarList?maxResults=50`,
    );
    const calendars = (data.items ?? []).map<GoogleCalendarInfo>((entry) => ({
      id: entry.id,
      name: entry.summaryOverride || entry.summary || entry.id,
      color: entry.backgroundColor ?? null,
      primary: Boolean(entry.primary),
      defaultVisible: Boolean(entry.primary || entry.selected),
    }));
    calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
    return { calendars, limited: false };
  } catch (error) {
    // Sign-ins from before calendar-list access was requested can only read the primary calendar.
    if (error instanceof GoogleApiError && error.status === 403) {
      return {
        calendars: [{ id: "primary", name: "Calendar", color: null, primary: true, defaultVisible: true }],
        limited: true,
      };
    }
    throw error;
  }
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function eventStartMs(event: CalendarEventItem): number {
  if (!event.allDay) return new Date(event.start).getTime();
  const [y, m, d] = event.start.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export async function listEventsBetween(
  start: Date,
  end: Date,
  visibility: Record<string, boolean>,
): Promise<CalendarEventItem[]> {
  const { calendars } = await listCalendars();
  const visible = calendars.filter((calendar) => visibility[calendar.id] ?? calendar.defaultVisible).slice(0, 12);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });

  const perCalendar = await mapWithConcurrency(visible, 4, async (calendar) => {
    const data = await googleFetch<{ items?: GEvent[] }>(
      `${CALENDAR}/calendars/${enc(calendar.id)}/events?${params}`,
    );
    return (data.items ?? [])
      .filter((event) => event.status !== "cancelled" && (event.start?.dateTime || event.start?.date))
      .map<CalendarEventItem>((event) => ({
        id: event.id,
        title: event.summary?.trim() || "(No title)",
        start: event.start?.dateTime ?? event.start?.date ?? "",
        end: event.end?.dateTime ?? event.end?.date ?? "",
        allDay: !event.start?.dateTime,
        location: event.location?.trim() || null,
        description: event.description ? stripHtml(event.description).slice(0, 600) || null : null,
        htmlLink: event.htmlLink ?? null,
        meetLink:
          event.hangoutLink ??
          event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
          null,
        calendarId: calendar.id,
        calendarName: calendar.name,
        calendarColor: calendar.color,
        attendees: (event.attendees ?? [])
          .filter((attendee) => !attendee.resource && !attendee.self && attendee.email)
          .map((attendee) => attendee.email!)
          .slice(0, 20),
      }));
  });

  const seen = new Set<string>();
  return perCalendar
    .flat()
    .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
    .sort((a, b) => eventStartMs(a) - eventStartMs(b));
}

export function listEvents(daysAhead: number, visibility: Record<string, boolean>): Promise<CalendarEventItem[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);
  return listEventsBetween(start, end, visibility);
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

export async function createEvent(input: CreateEventInput): Promise<void> {
  const timed = Boolean(input.startTime);
  const endTime = input.endTime && input.startTime && input.endTime > input.startTime ? input.endTime : null;
  await googleFetch(`${CALENDAR}/calendars/primary/events`, {
    method: "POST",
    body: {
      summary: input.title,
      description: input.notes || undefined,
      start: timed
        ? { dateTime: `${input.date}T${input.startTime}:00`, timeZone: input.timeZone }
        : { date: input.date },
      end: timed
        ? { dateTime: `${input.date}T${endTime ?? addMinutes(input.startTime!, 60)}:00`, timeZone: input.timeZone }
        : { date: nextDate(input.date) },
    },
  });
}
