import type { RequestUsage } from "./ai-usage.js";

/** Durable Assistant chat data shared by the renderer and backend. */

export const ASSISTANT_PROVIDERS = [
  "glaze",
  "claude",
  "codex",
  "gemini",
  "muse",
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
  "openrouter",
] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];
export type AssistantToolStatus = "running" | "success" | "error";
export type AssistantItemKind = "task" | "reminder" | "event";

export interface AssistantToolCall {
  id: string;
  name: string;
  status: AssistantToolStatus;
}

/** A proposed DayBoard item, matching the renderer's ItemDraft fields. */
export interface AssistantAction {
  kind: AssistantItemKind;
  title: string;
  notes: string;
  date: string;
  time: string;
  endTime: string;
  added: boolean;
}

/** An item the user mentioned with @: its chip, never its content. */
export interface AssistantMention {
  kind: "event" | "task" | "reminder" | "email";
  label: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: AssistantToolCall[];
  actions: AssistantAction[];
  error: string | null;
  blocked: string | null;
  /** Older saved replies may not have recorded their provider. */
  provider?: AssistantProvider;
  /** Model that wrote the reply, e.g. "GPT-5.6 Sol · gpt-5.6-sol · Fast". */
  modelLabel?: string;
  usage?: RequestUsage;
  /** Items the user mentioned with @; omitted when there were none. */
  mentions?: AssistantMention[];
}

export interface AssistantChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

export interface AssistantHistory {
  /** An opaque account scope owned and returned by the backend. */
  scope: string;
  chats: AssistantChat[];
  /** null deliberately represents a blank, unsaved new chat. */
  activeChatId: string | null;
  /** Legacy localStorage was unscoped and may be imported once by user action. */
  legacyImported: boolean;
}
