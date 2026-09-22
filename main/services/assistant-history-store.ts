import * as path from "node:path";

import { app } from "@glaze/core/backend";

import type {
  AssistantAction,
  AssistantChat,
  AssistantHistory,
  AssistantMessage,
  AssistantProvider,
  AssistantToolCall,
} from "../../shared/assistant-history.js";
import { isDemoMode } from "./demo-data.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";
import { trackPendingWrite } from "./pending-writes.js";

const VERSION = 1;
const MAX_CHATS = 10_000;
const MAX_MESSAGES_PER_CHAT = 2_000;
/** Hard safety bound; saves fail without evicting any previously acknowledged chat. */
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;

interface StoredHistory {
  scope: string;
  chats: AssistantChat[];
  activeChatId: string | null;
}

interface HistoryFile {
  version: typeof VERSION;
  legacyImported: boolean;
  histories: Record<string, StoredHistory>;
}

const queue = createSerialQueue();

function statePath(): string {
  return path.join(
    app.getPath("userData"),
    isDemoMode() ? "demo-assistant-history.json" : "assistant-history.json",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string, max = 200_000): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Assistant history contains an invalid ${label}.`);
  if (value.length > max) throw new Error(`Assistant history ${label} is too long.`);
  return value;
}

function requireText(value: unknown, label: string, max = 200_000): string {
  if (typeof value !== "string") throw new Error(`Assistant history contains an invalid ${label}.`);
  if (value.length > max) throw new Error(`Assistant history ${label} is too long.`);
  return value;
}

function optionalString(value: unknown, label: string, max = 200_000): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, label, max);
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label, 80);
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new Error(`Assistant history contains an invalid ${label}.`);
  return timestamp;
}

function normalizeTool(value: unknown): AssistantToolCall {
  if (!isRecord(value)) throw new Error("Assistant history contains an invalid tool record.");
  const status = value.status;
  if (status !== "running" && status !== "success" && status !== "error")
    throw new Error("Assistant history contains an invalid tool status.");
  return {
    id: requireString(value.id, "tool id", 320),
    name: requireString(value.name, "tool name", 1_000),
    // A stream cannot resume after a process restart.
    status: status === "running" ? "error" : status,
  };
}

function normalizeAction(value: unknown): AssistantAction {
  if (!isRecord(value)) throw new Error("Assistant history contains an invalid action record.");
  if (value.kind !== "task" && value.kind !== "reminder" && value.kind !== "event")
    throw new Error("Assistant history contains an invalid action kind.");
  if (typeof value.added !== "boolean")
    throw new Error("Assistant history contains an invalid action state.");
  return {
    kind: value.kind,
    title: requireString(value.title, "action title", 4_000),
    notes: typeof value.notes === "string" ? value.notes : "",
    date: typeof value.date === "string" ? value.date : "",
    time: typeof value.time === "string" ? value.time : "",
    endTime: typeof value.endTime === "string" ? value.endTime : "",
    added: value.added,
  };
}

function normalizeMessage(value: unknown): AssistantMessage {
  if (!isRecord(value)) throw new Error("Assistant history contains an invalid message record.");
  if (value.role !== "user" && value.role !== "assistant")
    throw new Error("Assistant history contains an invalid message role.");
  if (!Array.isArray(value.tools) || !Array.isArray(value.actions))
    throw new Error("Assistant history contains an invalid message payload.");
  const provider = value.provider;
  if (
    provider !== undefined &&
    provider !== "glaze" &&
    provider !== "claude" &&
    provider !== "codex"
  )
    throw new Error("Assistant history contains an invalid message provider.");
  return {
    id: requireString(value.id, "message id", 320),
    role: value.role,
    content: requireText(value.content, "message content", 500_000),
    tools: value.tools.map(normalizeTool),
    actions: value.actions.map(normalizeAction),
    error: optionalString(value.error, "message error", 20_000),
    blocked: optionalString(value.blocked, "message block", 20_000),
    ...(provider ? { provider: provider as AssistantProvider } : {}),
    ...(typeof value.modelLabel === "string" && value.modelLabel
      ? { modelLabel: value.modelLabel.slice(0, 160) }
      : {}),
  };
}

function normalizeChat(value: unknown): AssistantChat {
  if (!isRecord(value)) throw new Error("Assistant history contains an invalid chat record.");
  if (!Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES_PER_CHAT)
    throw new Error("Assistant history exceeds the message limit for one chat.");
  return {
    id: requireString(value.id, "chat id", 320),
    title: requireString(value.title, "chat title", 1_000),
    createdAt: requireTimestamp(value.createdAt, "chat creation time"),
    updatedAt: requireTimestamp(value.updatedAt, "chat update time"),
    messages: value.messages.map(normalizeMessage),
  };
}

function emptyFile(): HistoryFile {
  return { version: VERSION, legacyImported: false, histories: {} };
}

function normalizeFile(value: unknown): HistoryFile {
  if (!isRecord(value) || value.version !== VERSION || !isRecord(value.histories))
    throw new Error("Assistant history has an unsupported schema.");
  if (typeof value.legacyImported !== "boolean")
    throw new Error("Assistant history contains an invalid migration state.");
  const histories: Record<string, StoredHistory> = {};
  for (const [scope, entry] of Object.entries(value.histories)) {
    if (!isRecord(entry) || entry.scope !== scope || !Array.isArray(entry.chats))
      throw new Error("Assistant history contains an invalid scoped record.");
    if (entry.chats.length > MAX_CHATS)
      throw new Error("Assistant history exceeds the chat limit.");
    const chats = entry.chats.map(normalizeChat).sort(newestFirst);
    const ids = new Set<string>();
    for (const chat of chats) {
      if (ids.has(chat.id)) throw new Error("Assistant history contains duplicate chat ids.");
      ids.add(chat.id);
    }
    if (
      entry.activeChatId !== null &&
      (typeof entry.activeChatId !== "string" || !ids.has(entry.activeChatId))
    )
      throw new Error("Assistant history contains an invalid active chat.");
    histories[scope] = { scope, chats, activeChatId: entry.activeChatId };
  }
  return { version: VERSION, legacyImported: value.legacyImported, histories };
}

function newestFirst(left: AssistantChat, right: AssistantChat): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function emptyHistory(scope: string, legacyImported: boolean): AssistantHistory {
  return { scope, chats: [], activeChatId: null, legacyImported };
}

function publicHistory(file: HistoryFile, scope: string): AssistantHistory {
  const stored = file.histories[scope];
  if (!stored) return emptyHistory(scope, isDemoMode() ? false : file.legacyImported);
  return {
    scope,
    chats: structuredClone(stored.chats),
    activeChatId: stored.activeChatId,
    legacyImported: isDemoMode() ? false : file.legacyImported,
  };
}

async function loadFile(): Promise<HistoryFile> {
  const target = statePath();
  const raw = await readFileIfExists(target);
  if (!raw) return emptyFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("Assistant history is not valid JSON.");
  }
  return normalizeFile(parsed);
}

function assertScope(scope: string): void {
  if (!scope.trim() || scope.length > 320)
    throw new Error("Assistant history has an invalid scope.");
  if (isDemoMode() && scope !== "demo") throw new Error("Assistant history demo scope is invalid.");
}

function assertSize(file: HistoryFile): void {
  if (Buffer.byteLength(JSON.stringify(file), "utf8") > MAX_HISTORY_BYTES)
    throw new Error(
      "Chat history has reached its local storage limit. Your saved conversations are unchanged.",
    );
}

async function mutate<T>(scope: string, operation: (file: HistoryFile) => T): Promise<T> {
  assertScope(scope);
  return trackPendingWrite(() =>
    queue(async () => {
      const file = await loadFile();
      const draft = structuredClone(file) as HistoryFile;
      const result = operation(draft);
      assertSize(draft);
      await writeFileAtomic(statePath(), `${JSON.stringify(draft, null, 2)}\n`);
      return result;
    }),
  );
}

/** Returns the last acknowledged state; malformed files are never overwritten. */
export async function getAssistantHistory(scope: string): Promise<AssistantHistory> {
  assertScope(scope);
  return publicHistory(await queue(() => loadFile()), scope);
}

/** Replaces one chat after durable acknowledgement while retaining every other chat. */
export async function saveAssistantChat(scope: string, chat: unknown): Promise<AssistantHistory> {
  const normalized = normalizeChat(chat);
  return mutate(scope, (file) => {
    const current = file.histories[scope] ?? { scope, chats: [], activeChatId: null };
    const chats = [...current.chats.filter((entry) => entry.id !== normalized.id), normalized].sort(
      newestFirst,
    );
    if (chats.length > MAX_CHATS)
      throw new Error(
        "Assistant history has reached its conversation limit. Your saved conversations are unchanged.",
      );
    file.histories[scope] = { scope, chats, activeChatId: normalized.id };
    return publicHistory(file, scope);
  });
}

/** Selects an existing chat, or deliberately persists a blank new-chat selection. */
export async function selectAssistantChat(scope: string, id: unknown): Promise<AssistantHistory> {
  if (id !== null && (typeof id !== "string" || !id.trim() || id.length > 320))
    throw new Error('assistant:selectChat: "id" must be a chat id or null.');
  return mutate(scope, (file) => {
    const current = file.histories[scope];
    // A blank composer is state, not an empty chat record. Keep a never-saved
    // chat out of the scoped file until the first acknowledged save.
    if (!current && id === null) return publicHistory(file, scope);
    if (!current) throw new Error("assistant:selectChat: the selected chat does not exist.");
    if (id !== null && !current.chats.some((chat) => chat.id === id))
      throw new Error("assistant:selectChat: the selected chat does not exist.");
    file.histories[scope] = { ...current, activeChatId: id };
    return publicHistory(file, scope);
  });
}

/**
 * Imports the renderer's unscoped legacy localStorage only after the user asks.
 * A single atomic file-level marker prevents assigning it to more than one real account.
 */
export async function importLegacyAssistantChat(
  scope: string,
  messages: unknown,
): Promise<AssistantHistory> {
  if (!Array.isArray(messages) || !messages.length)
    throw new Error('assistant:importLegacyChat: "messages" must be a non-empty array.');
  const normalized = messages.map(normalizeMessage);
  if (normalized.length > MAX_MESSAGES_PER_CHAT)
    throw new Error("Assistant history exceeds the message limit for one chat.");
  return mutate(scope, (file) => {
    if (!isDemoMode() && file.legacyImported) return publicHistory(file, scope);
    const current = file.histories[scope] ?? { scope, chats: [], activeChatId: null };
    const now = new Date().toISOString();
    const chat: AssistantChat = {
      id: crypto.randomUUID(),
      title: "Previous conversation",
      createdAt: now,
      updatedAt: now,
      messages: normalized,
    };
    if (current.chats.length >= MAX_CHATS)
      throw new Error(
        "Assistant history has reached its conversation limit. Your saved conversations are unchanged.",
      );
    file.histories[scope] = {
      scope,
      chats: [...current.chats, chat].sort(newestFirst),
      activeChatId: chat.id,
    };
    if (!isDemoMode()) file.legacyImported = true;
    return publicHistory(file, scope);
  });
}

export function drainAssistantHistoryStore(): Promise<void> {
  return queue.drain();
}
