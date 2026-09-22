import type {
  CalendarEventItem,
  CalendarListResult,
  CreateEventInput,
  CreateTaskInput,
  GoogleCalendarInfo,
  MailItem,
  SourceCoverage,
  TaskItem,
} from "../shared-types.js";
import type { UpdateEventInput, UpdateTaskInput } from "../../shared/item-edits.js";
import { GoogleAuthError, getGoogleAccessToken } from "./google-auth.js";
import { agendaEventId } from "./agenda-utils.js";

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
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await sleep(delay + Math.random() * 250);
    return googleFetch<T>(url, init, attempt + 1);
  }
  if (response.status === 401) {
    throw new GoogleAuthError("not-connected", "Google session expired. Reconnect your account.");
  }
  if (!response.ok) {
    const detail = describeGoogleError(await response.text());
    throw new GoogleApiError(
      response.status,
      `Google API error ${response.status} (${new URL(url).hostname}): ${detail}`,
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
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

interface GooglePage<T> {
  items?: T[];
  nextPageToken?: string;
}

interface BoundedList<T> {
  items: T[];
  coverage: SourceCoverage;
}

async function collectPages<T>(url: URL, cap: number): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  do {
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleFetch<GooglePage<T>>(url.toString());
    const pageItems = page.items ?? [];
    const remaining = cap - items.length;
    items.push(...pageItems.slice(0, remaining));
    if (pageItems.length > remaining || (items.length === cap && page.nextPageToken)) {
      truncated = true;
      break;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return { items, truncated };
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

function taskToItem(task: GTask, list: GTaskList): TaskItem {
  if (!task.id) throw new GoogleApiError(500, "Google Tasks returned an item without an ID.");
  return {
    id: task.id,
    listId: list.id,
    listTitle: list.title,
    title: task.title?.trim() || "(Untitled)",
    notes: task.notes?.trim() || null,
    due: task.due ? task.due.slice(0, 10) : null,
    completed: task.status === "completed",
    completedAt: task.completed ?? null,
  };
}

const TASK_LIST_CAP = 30;
const TASKS_PER_LIST_CAP = 200;
const GOOGLE_TASK_PAGE_SIZE = 100;
const TASK_FETCH_CONCURRENCY = 4;

async function listTasksWith(query: URLSearchParams): Promise<BoundedList<TaskItem>> {
  const listUrl = new URL(`${TASKS}/users/@me/lists`);
  listUrl.searchParams.set("maxResults", String(GOOGLE_TASK_PAGE_SIZE));
  const lists = await collectPages<GTaskList>(listUrl, TASK_LIST_CAP);
  const perList = await mapWithConcurrency(lists.items, TASK_FETCH_CONCURRENCY, async (list) => {
    const taskUrl = new URL(`${TASKS}/lists/${enc(list.id)}/tasks`);
    for (const [key, value] of query) taskUrl.searchParams.set(key, value);
    taskUrl.searchParams.set("maxResults", String(GOOGLE_TASK_PAGE_SIZE));
    const data = await collectPages<GTask>(taskUrl, TASKS_PER_LIST_CAP);
    return {
      items: data.items
        .filter((task) => task.title?.trim())
        .map<TaskItem>((task) => taskToItem(task, list)),
      truncated: data.truncated,
    };
  });
  const items = perList.flatMap((result) => result.items);
  return {
    items,
    coverage: {
      complete: !lists.truncated && !perList.some((result) => result.truncated),
      reason: lists.truncated
        ? "list-cap"
        : perList.some((result) => result.truncated)
          ? "item-cap"
          : undefined,
      loaded: items.length,
    },
  };
}

export function listTasks(): Promise<TaskItem[]> {
  return listTasksWith(new URLSearchParams({ showCompleted: "false", showHidden: "false" })).then(
    (result) => result.items,
  );
}

export function listTasksWithCoverage(): Promise<BoundedList<TaskItem>> {
  return listTasksWith(new URLSearchParams({ showCompleted: "false", showHidden: "false" }));
}

export async function listCompletedTasks(since: Date): Promise<TaskItem[]> {
  const tasks = await listTasksWith(
    new URLSearchParams({
      showCompleted: "true",
      showHidden: "true",
      completedMin: since.toISOString(),
    }),
  );
  return tasks.items.filter((task) => task.completed);
}

/** Confirms a task still belongs to the declared list before creating a linked calendar block. */
export async function getTaskInList(listId: string, taskId: string): Promise<void> {
  const task = await googleFetch<GTask>(`${TASKS}/lists/${enc(listId)}/tasks/${enc(taskId)}`);
  if (task.id !== taskId)
    throw new GoogleApiError(404, "The selected Google Task no longer exists in that list.");
}

export async function setTaskCompleted(
  listId: string,
  taskId: string,
  completed: boolean,
): Promise<void> {
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

/** Updates only the editable fields on one Google Task and returns Google's canonical item. */
export async function updateTask(input: UpdateTaskInput): Promise<TaskItem> {
  // Resolve presentation metadata first: a post-write lookup failure must not
  // make a successful provider write look like it was never acknowledged.
  const list = await googleFetch<GTaskList>(`${TASKS}/users/@me/lists/${enc(input.listId)}`);
  const task = await googleFetch<GTask>(
    `${TASKS}/lists/${enc(input.listId)}/tasks/${enc(input.taskId)}`,
    {
      method: "PATCH",
      body: {
        title: input.title,
        notes: input.notes || null,
        // Google Tasks stores a date-only due value as RFC 3339. `null` clears it.
        due: input.due ? `${input.due}T00:00:00.000Z` : null,
      },
    },
  );
  return taskToItem(task, list);
}

/** Deletes exactly the selected Google Task; linked DayBoard relationships remain as unavailable history. */
export async function deleteTask(listId: string, taskId: string): Promise<void> {
  await googleFetch(`${TASKS}/lists/${enc(listId)}/tasks/${enc(taskId)}`, { method: "DELETE" });
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
  const people = emails
    .map((email) => email.replace(/["()\s]/g, ""))
    .filter((email) => email.includes("@"));
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
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6000);
}

function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
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
  await googleFetch(`${GMAIL}/messages/${enc(id)}/modify`, {
    method: "POST",
    body: { removeLabelIds },
  });
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
  timeZone?: string;
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
  extendedProperties?: { private?: Record<string, string> };
  recurrence?: string[];
  recurringEventId?: string;
}

const CALENDAR_LIST_CAP = 50;
const CALENDAR_FETCH_CAP = 12;
const EVENTS_PER_CALENDAR_CAP = 250;
const CALENDAR_PAGE_SIZE = 100;
const EVENT_FETCH_CONCURRENCY = 4;

interface CalendarLookup extends CalendarListResult {
  truncated: boolean;
}

async function listCalendarsWithCoverage(): Promise<CalendarLookup> {
  try {
    const url = new URL(`${CALENDAR}/users/me/calendarList`);
    url.searchParams.set("maxResults", String(CALENDAR_PAGE_SIZE));
    const data = await collectPages<GCalendarListEntry>(url, CALENDAR_LIST_CAP);
    const calendars = data.items.map<GoogleCalendarInfo>((entry) => ({
      id: entry.id,
      name: entry.summaryOverride || entry.summary || entry.id,
      color: entry.backgroundColor ?? null,
      primary: Boolean(entry.primary),
      defaultVisible: Boolean(entry.primary || entry.selected),
    }));
    calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
    return { calendars, limited: false, truncated: data.truncated };
  } catch (error) {
    // Sign-ins from before calendar-list access was requested can only read the primary calendar.
    if (error instanceof GoogleApiError && error.status === 403) {
      return {
        calendars: [
          { id: "primary", name: "Calendar", color: null, primary: true, defaultVisible: true },
        ],
        limited: true,
        truncated: false,
      };
    }
    throw error;
  }
}

export async function listCalendars(): Promise<CalendarListResult> {
  const { calendars, limited } = await listCalendarsWithCoverage();
  return { calendars, limited };
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

function eventToItem(
  event: GEvent,
  calendar: GoogleCalendarInfo,
  fullDescription = false,
): CalendarEventItem {
  if (!event.id || (!event.start?.dateTime && !event.start?.date))
    throw new GoogleApiError(500, "Google Calendar returned an event without an ID or start time.");
  return {
    id: event.id,
    title: event.summary?.trim() || "(No title)",
    start: event.start.dateTime ?? event.start.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    allDay: !event.start.dateTime,
    location: event.location?.trim() || null,
    description: event.description
      ? fullDescription
        ? event.description
        : stripHtml(event.description).slice(0, 600) || null
      : null,
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
  };
}

export async function listEventsBetweenWithCoverage(
  start: Date,
  end: Date,
  visibility: Record<string, boolean>,
): Promise<BoundedList<CalendarEventItem>> {
  const calendarLookup = await listCalendarsWithCoverage();
  const visibleCalendars = calendarLookup.calendars.filter(
    (calendar) => visibility[calendar.id] ?? calendar.defaultVisible,
  );
  const visible = visibleCalendars.slice(0, CALENDAR_FETCH_CAP);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(CALENDAR_PAGE_SIZE),
  });

  const perCalendar = await mapWithConcurrency(
    visible,
    EVENT_FETCH_CONCURRENCY,
    async (calendar) => {
      const url = new URL(`${CALENDAR}/calendars/${enc(calendar.id)}/events`);
      for (const [key, value] of params) url.searchParams.set(key, value);
      const data = await collectPages<GEvent>(url, EVENTS_PER_CALENDAR_CAP);
      return {
        items: data.items
          .filter(
            (event) => event.status !== "cancelled" && (event.start?.dateTime || event.start?.date),
          )
          .map<CalendarEventItem>((event) => eventToItem(event, calendar)),
        truncated: data.truncated,
      };
    },
  );

  const seen = new Set<string>();
  const items = perCalendar
    .flatMap((result) => result.items)
    .filter((event) => {
      const key = `${event.calendarId}:${event.id}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => eventStartMs(a) - eventStartMs(b));
  const calendarTruncated = calendarLookup.truncated || visibleCalendars.length > visible.length;
  return {
    items,
    coverage: {
      complete:
        !calendarLookup.limited &&
        !calendarTruncated &&
        !perCalendar.some((result) => result.truncated),
      reason: calendarTruncated
        ? "calendar-cap"
        : perCalendar.some((result) => result.truncated)
          ? "item-cap"
          : undefined,
      loaded: items.length,
    },
  };
}

export function listEventsBetween(
  start: Date,
  end: Date,
  visibility: Record<string, boolean>,
): Promise<CalendarEventItem[]> {
  return listEventsBetweenWithCoverage(start, end, visibility).then((result) => result.items);
}

export function listEvents(
  daysAhead: number,
  visibility: Record<string, boolean>,
): Promise<CalendarEventItem[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);
  return listEventsBetween(start, end, visibility);
}

export function listEventsWithCoverage(
  daysAhead: number,
  visibility: Record<string, boolean>,
): Promise<BoundedList<CalendarEventItem>> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);
  return listEventsBetweenWithCoverage(start, end, visibility);
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

function calendarEventBody(input: CreateEventInput): Record<string, unknown> {
  const timed = Boolean(input.startTime);
  const endTime =
    input.endTime && input.startTime && input.endTime > input.startTime ? input.endTime : null;
  return {
    summary: input.title,
    description: input.notes || undefined,
    start: timed
      ? { dateTime: `${input.date}T${input.startTime}:00`, timeZone: input.timeZone }
      : { date: input.date },
    end: timed
      ? {
          dateTime: `${input.date}T${endTime ?? addMinutes(input.startTime!, 60)}:00`,
          timeZone: input.timeZone,
        }
      : { date: nextDate(input.date) },
  };
}

export async function createEvent(input: CreateEventInput): Promise<void> {
  await googleFetch(`${CALENDAR}/calendars/primary/events`, {
    method: "POST",
    body: calendarEventBody(input),
  });
}

async function editableCalendar(calendarId: string): Promise<GoogleCalendarInfo> {
  const lookup = await listCalendarsWithCoverage();
  const calendar = lookup.calendars.find((candidate) => candidate.id === calendarId);
  if (calendar) return calendar;
  throw new GoogleApiError(404, "The selected calendar is no longer available.");
}

function calendarEditBody(input: UpdateEventInput): Record<string, unknown> {
  return {
    summary: input.title,
    ...(input.description === undefined ? {} : { description: input.description || null }),
    location: input.location || null,
    start: input.allDay
      ? { date: input.start }
      : { dateTime: input.start, timeZone: input.timeZone },
    end: input.allDay ? { date: input.end } : { dateTime: input.end, timeZone: input.timeZone },
  };
}

async function requireEditableEvent(calendarId: string, eventId: string): Promise<GEvent> {
  const event = await googleFetch<GEvent>(
    `${CALENDAR}/calendars/${enc(calendarId)}/events/${enc(eventId)}`,
  );
  // A master recurring event edits the entire series. DayBoard only accepts an expanded instance ID.
  if (event.recurrence?.length) {
    throw new Error(
      "This is a recurring series. Select one occurrence from the agenda to edit or delete that occurrence.",
    );
  }
  return event;
}

/** Patches one ordinary event or one expanded recurring instance without altering attendees or recurrence. */
export async function updateEvent(input: UpdateEventInput): Promise<CalendarEventItem> {
  const [calendar] = await Promise.all([
    editableCalendar(input.calendarId),
    requireEditableEvent(input.calendarId, input.eventId),
  ]);
  const event = await googleFetch<GEvent>(
    `${CALENDAR}/calendars/${enc(input.calendarId)}/events/${enc(input.eventId)}`,
    { method: "PATCH", body: calendarEditBody(input) },
  );
  return eventToItem(event, calendar);
}

/** Loads the exact editable event before a save, retaining its untruncated provider description. */
export async function getEventForEditing(
  calendarId: string,
  eventId: string,
): Promise<CalendarEventItem> {
  const [calendar, event] = await Promise.all([
    editableCalendar(calendarId),
    requireEditableEvent(calendarId, eventId),
  ]);
  return eventToItem(event, calendar, true);
}

/** Deletes one ordinary event or exact recurring occurrence, never a recurring series master. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await requireEditableEvent(calendarId, eventId);
  await googleFetch(`${CALENDAR}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
    method: "DELETE",
  });
}

/** Creates a timed event carrying an idempotency marker that is private to this Google account. */
export async function createAgendaEvent(
  input: CreateEventInput,
  requestId: string,
): Promise<{ id: string }> {
  let event: GEvent;
  try {
    event = await googleFetch<GEvent>(`${CALENDAR}/calendars/primary/events`, {
      method: "POST",
      body: {
        ...calendarEventBody(input),
        id: agendaEventId(requestId),
        extendedProperties: { private: { workDashboardAgendaRequestId: requestId } },
      },
    });
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
    event = await googleFetch<GEvent>(
      `${CALENDAR}/calendars/primary/events/${agendaEventId(requestId)}`,
    );
    if (
      event.extendedProperties?.private?.workDashboardAgendaRequestId !== requestId ||
      event.status === "cancelled"
    )
      throw new Error("The calendar block could not be recovered safely.");
  }
  if (!event.id) throw new Error("Google Calendar created the block without an event ID.");
  return { id: event.id };
}

/** Looks up an event created by a previous `agenda:createBlock` attempt. */
export async function findAgendaEvent(
  requestId: string,
  around: Date,
): Promise<{ id: string } | null> {
  try {
    const event = await googleFetch<GEvent>(
      `${CALENDAR}/calendars/primary/events/${agendaEventId(requestId)}`,
    );
    if (event.status === "cancelled")
      throw new Error("This calendar block was deleted. Choose a new time to create another.");
    if (event.extendedProperties?.private?.workDashboardAgendaRequestId === requestId)
      return { id: event.id };
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
  }
  const start = new Date(around);
  start.setDate(start.getDate() - 1);
  const end = new Date(around);
  end.setDate(end.getDate() + 2);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    maxResults: "2",
    privateExtendedProperty: `workDashboardAgendaRequestId=${requestId}`,
  });
  const response = await googleFetch<{ items?: GEvent[] }>(
    `${CALENDAR}/calendars/primary/events?${params.toString()}`,
  );
  const event = response.items?.find(
    (item) =>
      item.extendedProperties?.private?.workDashboardAgendaRequestId === requestId && item.id,
  );
  return event?.id ? { id: event.id } : null;
}
