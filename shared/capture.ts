// Natural-language capture shared by the ⌘N dialog (renderer, with a review step) and Quick
// Capture (main process, no review step, so it parses strictly).

import { extractJSON } from "./json-extract.js";
import { nowContext } from "./prompt-context.js";

export type ItemKind = "task" | "reminder" | "event";

export interface ItemDraft {
  kind: ItemKind;
  title: string;
  notes: string;
  date: string;
  time: string;
  endTime: string;
}

export type AvailableKinds = Record<ItemKind, boolean>;

export const KIND_LABEL: Record<ItemKind, string> = {
  task: "Google Task",
  reminder: "Reminder",
  event: "Event",
};

const DESTINATION: Record<ItemKind, string> = {
  task: "Google Tasks",
  reminder: "Reminders",
  event: "Calendar",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MAX_TITLE = 500;
const MAX_NOTES = 8_000;

export function isItemKind(value: unknown): value is ItemKind {
  return value === "task" || value === "reminder" || value === "event";
}

function realDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function realTime(value: string): boolean {
  if (!TIME_RE.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60;
}

export function availableKinds(input: {
  googleConnected: boolean;
  remindersAccess: string | undefined;
  sources: Record<"tasks" | "reminders" | "calendar", { enabled: boolean }>;
}): AvailableKinds {
  return {
    task: input.googleConnected && input.sources.tasks.enabled,
    reminder: input.remindersAccess === "full-access" && input.sources.reminders.enabled,
    event: input.googleConnected && input.sources.calendar.enabled,
  };
}

/** One switch for main and both panels: AI on, a provider chosen, and AI capture not opted out. */
export function aiCaptureEnabled(settings: {
  ai: { enabled: boolean; providerChosen: boolean; features: { capture: boolean } };
}): boolean {
  return settings.ai.enabled && settings.ai.providerChosen && settings.ai.features.capture;
}

export const CAPTURE_SYSTEM =
  "You turn one short sentence into a single task, reminder, or calendar event. Respond with JSON only, no prose.";

export function buildCapturePrompt(
  sentence: string,
  available: AvailableKinds,
  now = new Date(),
): string {
  const kinds = [
    available.task && '"task" — Google Tasks: to-dos with an optional due date (no time)',
    available.reminder &&
      '"reminder" — Apple Reminders: things to be reminded about, supports a time',
    available.event &&
      '"event" — Google Calendar: meetings, calls, appointments, anything at a set time or place',
  ].filter(Boolean);
  return `Now: ${nowContext(now)}

Available kinds:
- ${kinds.join("\n- ")}

Rules:
- Resolve relative dates ("tomorrow", "Friday", "next week") against now; a weekday means its next upcoming occurrence.
- Use YYYY-MM-DD dates and 24-hour HH:mm times. Leave date, time, and endTime empty when not stated.
- "remind me" phrasing prefers "reminder"; meetings, calls with people, and appointments prefer "event".
- title: short and clear, without the date or time words.

Sentence: ${JSON.stringify(sentence)}

Return {"kind":"task","title":"","notes":"","date":"","time":"","endTime":""}`;
}

function fields(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(record: Record<string, unknown>, key: string): string {
  const field = record[key];
  return typeof field === "string" ? field.trim() : "";
}

/** Lenient: fills gaps and picks an available kind. Only for drafts the user reviews (⌘N). */
export function parseDraft(output: string, available: AvailableKinds): ItemDraft | null {
  const record = fields(extractJSON(output));
  if (!record) return null;
  const read = (key: string, pattern?: RegExp) => {
    const value = text(record, key);
    return !pattern || pattern.test(value) ? value : "";
  };
  const title = read("title");
  if (!title) return null;
  let kind: ItemKind = isItemKind(record.kind) ? record.kind : "task";
  if (!available[kind]) {
    kind =
      (["reminder", "task", "event"] as const).find((candidate) => available[candidate]) ?? kind;
  }
  return {
    kind,
    title,
    notes: read("notes"),
    date: read("date", DATE_RE),
    time: read("time", TIME_RE),
    endTime: read("endTime", TIME_RE),
  };
}

export type StrictDraftResult =
  | { ok: true; draft: ItemDraft }
  | { ok: false; partial: Partial<ItemDraft>; reason: string };

/**
 * Strict: never changes the destination or drops a field. Anything unclear goes back to Miles
 * as a manual form, prefilled with what did parse cleanly.
 */
export function parseDraftStrict(output: string, available: AvailableKinds): StrictDraftResult {
  const record = fields(extractJSON(output));
  if (!record) return { ok: false, partial: {}, reason: "Couldn't read the details." };
  const partial: Partial<ItemDraft> = {};
  const problems: string[] = [];
  const title = text(record, "title").slice(0, MAX_TITLE);
  if (title) partial.title = title;
  else problems.push("No title was found.");
  const notes = text(record, "notes").slice(0, MAX_NOTES);
  if (notes) partial.notes = notes;
  if (!isItemKind(record.kind))
    problems.push("It wasn't clear whether this is a task, reminder or event.");
  else if (!available[record.kind]) problems.push(`${DESTINATION[record.kind]} isn't available.`);
  else partial.kind = record.kind;
  for (const [key, valid, message] of [
    ["date", realDate, "The date wasn't clear."],
    ["time", realTime, "The time wasn't clear."],
    ["endTime", realTime, "The end time wasn't clear."],
  ] as const) {
    const value = text(record, key);
    if (!value) continue;
    if (valid(value)) partial[key] = value;
    else problems.push(message);
  }
  if (!problems.length) {
    if (partial.endTime && !partial.time) problems.push("The end time has no start time.");
    if (partial.kind === "task" && partial.time)
      problems.push("Google Tasks can't hold a time. Choose a reminder or event.");
    if (partial.kind === "reminder" && partial.endTime)
      problems.push("Reminders can't hold an end time.");
    if (partial.kind === "event" && !partial.date) problems.push("Events need a date.");
    if (partial.time && !partial.date && partial.kind !== "event")
      problems.push("A time needs a date.");
  }
  if (problems.length) return { ok: false, partial, reason: problems[0] };
  return {
    ok: true,
    draft: {
      kind: partial.kind!,
      title: partial.title!,
      notes: partial.notes ?? "",
      date: partial.date ?? "",
      time: partial.time ?? "",
      endTime: partial.endTime ?? "",
    },
  };
}

/** Validates a draft Miles filled in himself (Quick Capture's manual form). */
export function normalizeDraft(
  value: unknown,
  available: AvailableKinds,
): ItemDraft | { error: string } {
  const record = fields(value) ?? {};
  if (!isItemKind(record.kind) || !available[record.kind])
    return { error: "Choose where to add it." };
  const kind = record.kind;
  const title = text(record, "title").slice(0, MAX_TITLE);
  if (!title) return { error: "Add a title." };
  const date = text(record, "date");
  if (date && !realDate(date)) return { error: "Check the date." };
  const time = kind === "task" ? "" : text(record, "time");
  if (time && !realTime(time)) return { error: "Check the time." };
  const endTime = kind === "event" && time ? text(record, "endTime") : "";
  if (endTime && !realTime(endTime)) return { error: "Check the end time." };
  if (kind === "event" && !date) return { error: "Events need a date." };
  if (time && !date) return { error: "Add a date for that time." };
  return { kind, title, notes: text(record, "notes").slice(0, MAX_NOTES), date, time, endTime };
}

/** The confirmation shown after a capture, e.g. "Added to Reminders" / "Call dentist · Thu, Oct 22, 3:00 PM". */
export function describeCapture(draft: ItemDraft): { title: string; body: string } {
  const title = `Added to ${DESTINATION[draft.kind]}`;
  if (!draft.date) return { title, body: draft.title };
  const [year, month, day] = draft.date.split("-").map(Number);
  const [hours, minutes] = draft.time ? draft.time.split(":").map(Number) : [0, 0];
  const when = new Date(year, month - 1, day, hours, minutes);
  const label = draft.time
    ? when.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return { title, body: `${draft.title} · ${label}` };
}
