import type { CalendarEventItem, MailItem, SourceResult } from "@main/shared-types";
import { SNAPSHOT_END, SNAPSHOT_START, oneLine } from "../../shared/ai-snapshot";
import type { AssistantMention } from "../../shared/assistant-history";

import {
  addDays,
  dayHeading,
  eventDayKey,
  eventTimeRange,
  formatClock,
  formatDue,
  formatMailDate,
  todayISO,
} from "./dates";
import { SOURCE_LABEL } from "./source-labels";
import { compareByDue, type Todo } from "./todos";

export type MentionKind = AssistantMention["kind"];

/** A candidate for an @ mention, carrying the loaded item so its details can be sent. */
export interface MentionItem {
  /** Finds the item again at send time. */
  key: string;
  kind: MentionKind;
  label: string;
  /** Menu detail: when, list or sender. */
  detail: string;
  event?: CalendarEventItem;
  todo?: Todo;
  mail?: MailItem;
}

/** A chip checked against the data loaded when the message is sent. */
export interface ResolvedMention {
  item: MentionItem;
  missing: boolean;
}

export const MAX_MENTION_RESULTS = 20;
export const MAX_MENTIONS = 10;
/** Cap for an email body or a notes field inside the section. */
export const MAX_MENTION_TEXT = 20_000;
const MAX_LABEL = 200;

const KIND_NAME: Record<MentionKind, string> = {
  event: "Event",
  task: "Task",
  reminder: "Reminder",
  email: "Email",
};

function label(text: string, fallback: string): string {
  return oneLine(text).slice(0, MAX_LABEL) || fallback;
}

function clip(text: string): string {
  return text.length > MAX_MENTION_TEXT ? `${text.slice(0, MAX_MENTION_TEXT)}…` : text;
}

/**
 * Multi-line untrusted text, indented so none of its lines can pose as a snapshot marker. Every
 * character some reader treats as a line break starts an indented line, and the cap applies after
 * indenting so short lines can't inflate the request.
 */
function indented(text: string): string {
  return clip(
    text
      .split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/)
      .map((line) => `    ${line}`)
      .join("\n"),
  );
}

function eventStart(event: CalendarEventItem): number {
  return event.allDay
    ? new Date(`${event.start.slice(0, 10)}T00:00:00`).getTime()
    : new Date(event.start).getTime();
}

function dueText(todo: Todo): string {
  if (!todo.dueDate) return "no due date";
  return `${todo.dueDate}${todo.dueTime ? ` ${formatClock(todo.dueTime)}` : ""}`;
}

/**
 * The `@` token the caret is in: `@` at the start or after whitespace, up to the caret, on one line
 * and not followed by a space ("lunch @ 12" is not a mention).
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  return /^\s/.test(query) || query.includes("\n") || query.length > 80 ? null : { start, query };
}

/** Days of events the `@` list offers, today and the next 7, whatever the Calendar setting shows. */
export const MENTION_EVENT_DAYS = 8;

/**
 * What can be mentioned: today's and the next 7 days' events by start time, open tasks and
 * reminders by due date, then loaded emails, newest first.
 */
export function mentionCandidates(input: {
  calendar: SourceResult<CalendarEventItem> | undefined;
  todos: Todo[];
  mail: SourceResult<MailItem> | undefined;
}): MentionItem[] {
  const last = addDays(todayISO(), MENTION_EVENT_DAYS - 1);
  const events = (input.calendar?.state === "ok" ? input.calendar.items : [])
    .filter((event) => eventDayKey(event) <= last)
    .sort((a, b) => eventStart(a) - eventStart(b))
    .map((event): MentionItem => ({
      key: `event:${event.calendarId}:${event.id}:${event.start}`,
      kind: "event",
      label: label(event.title, "(untitled event)"),
      detail: `${dayHeading(eventDayKey(event))}, ${eventTimeRange(event)}`,
      event,
    }));
  const todos = input.todos
    .filter((todo) => !todo.completed)
    .sort(compareByDue)
    .map((todo): MentionItem => ({
      key: todo.key,
      kind: todo.source === "tasks" ? "task" : "reminder",
      label: label(todo.title, "(untitled)"),
      detail: `${todo.listTitle} · ${todo.dueDate ? formatDue(todo.dueDate, todo.dueTime).label : "No due date"}`,
      todo,
    }));
  const mail = (input.mail?.state === "ok" ? input.mail.items : [])
    .slice()
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .map((message): MentionItem => ({
      key: `mail:${message.id}`,
      kind: "email",
      label: label(message.subject, "(no subject)"),
      detail: `${oneLine(message.from)} · ${formatMailDate(message.date)}`,
      mail: message,
    }));
  return [...events, ...todos, ...mail];
}

/** Candidates for the text after `@`: titles that start with it first, then other matches, at most 20. */
export function filterMentions(candidates: MentionItem[], query: string): MentionItem[] {
  const needle = query.trim().toLowerCase();
  const starts: MentionItem[] = [];
  const contains: MentionItem[] = [];
  for (const item of candidates) {
    const title = item.label.toLowerCase();
    if (title.startsWith(needle)) starts.push(item);
    else if (`${title} ${item.detail.toLowerCase()}`.includes(needle)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, MAX_MENTION_RESULTS);
}

/** Checks chips against the data loaded at send time; an item that disappeared is marked missing. */
export function resolveMentions(
  mentions: MentionItem[],
  current: MentionItem[],
): ResolvedMention[] {
  const byKey = new Map(current.map((item) => [item.key, item]));
  return mentions.map((item) => {
    const fresh = byKey.get(item.key);
    return fresh ? { item: fresh, missing: false } : { item, missing: true };
  });
}

/** What the user message saves: each chip's kind and label, never the item's content. */
export function savedMentions(resolved: ResolvedMention[]): AssistantMention[] {
  return resolved.map(({ item, missing }) => ({
    kind: item.kind,
    label: missing ? `${item.label} (unavailable)` : item.label,
  }));
}

/** Loads each mentioned email's body once; a body that can't load is recorded as null. */
export async function loadMentionBodies(
  resolved: ResolvedMention[],
  load: (id: string) => Promise<string>,
): Promise<Map<string, string | null>> {
  const ids = new Set<string>();
  for (const { item, missing } of resolved) if (!missing && item.mail) ids.add(item.mail.id);
  const entries = await Promise.all(
    [...ids].map(async (id): Promise<[string, string | null]> => [
      id,
      await load(id).catch(() => null),
    ]),
  );
  return new Map(entries);
}

function itemLines(item: MentionItem, bodies: Map<string, string | null>): string[] {
  if (item.event) {
    const event = item.event;
    return [
      `- Event: ${oneLine(event.title)}`,
      `  When: ${dayHeading(eventDayKey(event))}, ${eventTimeRange(event)}`,
      ...(event.location ? [`  Location: ${oneLine(event.location)}`] : []),
      ...(event.attendees.length
        ? [`  Attendees: ${event.attendees.map(oneLine).join(", ")}`]
        : []),
      ...(event.description ? ["  Notes:", indented(event.description)] : []),
    ];
  }
  if (item.todo) {
    const todo = item.todo;
    return [
      `- ${KIND_NAME[item.kind]}: ${oneLine(todo.title)}`,
      `  List: ${SOURCE_LABEL[todo.source]} / ${oneLine(todo.listTitle)}`,
      `  Due: ${dueText(todo)}`,
      ...(todo.notes ? ["  Notes:", indented(todo.notes)] : []),
    ];
  }
  if (!item.mail) return [];
  const mail = item.mail;
  const body = bodies.get(mail.id);
  return [
    `- Email: ${oneLine(mail.subject)}`,
    `  From: ${oneLine(mail.from)} <${oneLine(mail.fromEmail)}>`,
    `  Date: ${mail.date}`,
    ...(typeof body === "string"
      ? ["  Body:", indented(body)]
      : [`  Body: unavailable (it couldn't be loaded). Preview: ${oneLine(mail.snippet)}`]),
  ];
}

/** The "Mentioned items" section, or "" when nothing was mentioned. */
export function mentionSection(
  resolved: ResolvedMention[],
  bodies: Map<string, string | null>,
): string {
  if (!resolved.length) return "";
  const lines = resolved.flatMap(({ item, missing }) =>
    missing
      ? [
          `- ${KIND_NAME[item.kind]}: ${oneLine(item.label)} (no longer available, so its details aren't included)`,
        ]
      : itemLines(item, bodies),
  );
  return `## Mentioned items\n${lines.join("\n")}`;
}

/**
 * Chips saved on the earlier user messages being sent, so a follow-up such as "move it to
 * tomorrow" can be tied to the item. Labels are quoted source text, so this goes inside the
 * snapshot block like the full section.
 */
export function earlierMentionSection(
  messages: { role: string; mentions?: AssistantMention[] }[],
): string {
  const lines: string[] = [];
  let index = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    index += 1;
    if (!message.mentions?.length) continue;
    const items = message.mentions.map(
      (mention) => `${KIND_NAME[mention.kind]} "${oneLine(mention.label)}"`,
    );
    lines.push(`- User message ${index}: ${items.join(", ")}`);
  }
  return lines.length
    ? `## Items mentioned earlier in this chat (by user message, oldest first)\n${lines.join("\n")}`
    : "";
}

/**
 * Puts the section inside the current snapshot block, just before its end marker, so the rule
 * that snapshot content is untrusted data covers it.
 */
export function withMentions(snapshot: string, section: string): string {
  if (!section) return snapshot;
  const end = `\n${SNAPSHOT_END}`;
  return snapshot.endsWith(end)
    ? `${snapshot.slice(0, -end.length)}\n\n${section}${end}`
    : `${snapshot}\n\n${SNAPSHOT_START}\n${section}${end}`;
}
