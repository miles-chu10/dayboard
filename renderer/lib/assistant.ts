import { isItemKind } from "./create-items";
import { readStored } from "./storage";
import type { AssistantAction, AssistantMessage } from "../../shared/assistant-history";

export type { AssistantAction, AssistantMessage } from "../../shared/assistant-history";

export const ASSISTANT_SUGGESTIONS = [
  "What should I focus on for the rest of today?",
  "Summarize the emails that need a reply",
  "When am I free tomorrow for an hour of deep work?",
  "What's overdue, and what could I drop?",
];

const STORAGE_KEY = "dashboard:assistant:v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function isMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string" &&
    Array.isArray(v.tools) &&
    Array.isArray(v.actions)
  );
}

function isConversation(value: unknown): value is AssistantMessage[] {
  return Array.isArray(value) && value.every(isMessage);
}

export function loadLegacyConversation(): AssistantMessage[] {
  // Tool calls left "running" by a closed window can never finish.
  return (readStored(STORAGE_KEY, isConversation) ?? []).map((message) => ({
    ...message,
    tools: message.tools.map((tool) =>
      tool.status === "running" ? { ...tool, status: "error" } : tool,
    ),
  }));
}

/** Separates the visible reply from a trailing <actions>[...]</actions> proposal block. */
export function splitActions(text: string): { body: string; actions: AssistantAction[] } {
  const start = text.indexOf("<actions>");
  if (start < 0) return { body: text, actions: [] };
  const body = text.slice(0, start).trimEnd();
  const end = text.indexOf("</actions>", start);
  if (end < 0) return { body, actions: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start + "<actions>".length, end).trim());
  } catch {
    return { body, actions: [] };
  }

  const read = (record: Record<string, unknown>, key: string, pattern?: RegExp) => {
    const value = record[key];
    return typeof value === "string" && (!pattern || pattern.test(value.trim()))
      ? value.trim()
      : "";
  };

  const actions = (Array.isArray(parsed) ? parsed : []).flatMap((entry): AssistantAction[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const title = read(record, "title");
    if (!isItemKind(record.type) || !title) return [];
    return [
      {
        kind: record.type,
        title,
        notes: read(record, "notes"),
        date: read(record, "date", DATE_RE),
        time: read(record, "time", TIME_RE),
        endTime: read(record, "endTime", TIME_RE),
        added: false,
      },
    ];
  });
  return { body, actions: actions.slice(0, 8) };
}
