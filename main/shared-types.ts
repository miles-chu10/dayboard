// Types shared by the backend handlers and the renderer (renderer imports these type-only).

export type RemindersAccess =
  | "not-determined"
  | "denied"
  | "restricted"
  | "full-access"
  | "unknown";

export type SourceId = "tasks" | "reminders" | "mail" | "calendar";
export type SourceColor = "blue" | "green" | "orange" | "red" | "purple" | "magenta" | "yellow";
/**
 * glaze: Glaze AI · claude/codex/gemini/muse: subscriptions through Claude Code, Codex,
 * Antigravity (agy), and Meta's Muse Code · the rest: pay-per-use API keys.
 */
export type AIProvider = "glaze" | CliProviderId | ApiProviderId;
export type CliProviderId = "claude" | "codex" | "gemini" | "muse";
export type ApiProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "deepseek"
  | "groq"
  | "openrouter";
export type AIFeature =
  | "briefing"
  | "autoBriefing"
  | "prioritize"
  | "triage"
  | "replyDrafts"
  | "capture"
  | "assistant"
  | "meetingPrep"
  | "weeklyReview";
export type AccentColor =
  | "system"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "graphite";
export type Density = "default" | "compact";
export type DetailView = "dialog" | "inline" | "sidebar";
export type LaunchView = "today" | SourceId | "assistant" | "review";
export type CalendarRange =
  | "today"
  | "today-tomorrow"
  | "next-3-days"
  | "this-week"
  | "next-7-days"
  | "next-14-days"
  | "this-month";
export type ClaudeModel =
  | "default"
  | "fable"
  | "opus"
  | "sonnet"
  | "haiku"
  | "opus[1m]"
  | "sonnet[1m]";
export type ClaudeEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AppSettings {
  general: {
    launchView: LaunchView;
    /** Shown in the sidebar and given to the Assistant; empty uses the Google account name. */
    userName: string;
    /** 0 = manual refresh only */
    refreshMinutes: number;
    /** "system" follows the macOS accent color. */
    accent: AccentColor;
    /** Row height and spacing across views. */
    density: Density;
    /** Where item details open: pop-up window, inline under the row, or a right-hand panel. */
    detailView: DetailView;
  };
  sources: Record<SourceId, { enabled: boolean; color: SourceColor }>;
  mail: { maxMessages: number };
  calendar: {
    range: CalendarRange;
    /** Per-calendar override; calendars without an entry use Google's own visibility. */
    visibility: Record<string, boolean>;
  };
  /** Local MCP server for external clients such as Claude Code and Codex. */
  mcpServer: {
    enabled: boolean;
    /** Expose tools that change tasks, reminders, events, or email. */
    allowWrites: boolean;
  };
  ai: {
    enabled: boolean;
    provider: AIProvider;
    claudeModel: ClaudeModel;
    claudeEffort: ClaudeEffort;
    /** Claude Code fast mode (faster output on supported models). */
    claudeFast: boolean;
    /** Codex model slug; empty uses Codex's recommended default. */
    codexModel: string;
    /** Codex reasoning effort; empty uses the model default. */
    codexEffort: string;
    /** Codex catalog service tier id (e.g. "priority" for Fast); empty is standard. */
    codexServiceTier: string;
    /** Antigravity model name; empty uses its default. */
    geminiModel: string;
    /** Muse Code model ID; empty uses Muse's default. */
    museModel: string;
    /** Model ID per API-key provider; empty picks the newest listed model. */
    apiModels: Record<ApiProviderId, string>;
    /** Provider the Assistant uses; empty follows `provider` (the default for all features). */
    assistantProvider: AIProvider | "";
    useMcpInAssistant: boolean;
    assistantPermission: AssistantPermission;
    features: Record<AIFeature, boolean>;
  };
}

export interface CodexModelInfo {
  slug: string;
  name: string;
  description: string;
  defaultEffort: string | null;
  efforts: { effort: string; description: string }[];
  tiers: { id: string; name: string; description: string }[];
  contextWindow: number | null;
}

export interface SettingsChangedEvent {
  settings: AppSettings;
  /** True when a change affects which source data is fetched. */
  dataChanged: boolean;
}

/** Broadcast on `data:changed` when an MCP client changes a source's items. */
export interface DataChangedEvent {
  source: SourceId;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
}

export interface McpTestResult {
  ok: boolean;
  tools: string[];
  error: string | null;
}

export type ProviderStatus =
  | { ok: true; version: string }
  | {
      ok: false;
      reason: "missing" | "not-logged-in" | "failed";
      message: string;
    };

export interface GoogleAccountStatus {
  hasCredentials: boolean;
  connected: boolean;
  email: string | null;
  clientIdHint: string | null;
}

export interface AccountsStatus {
  google: GoogleAccountStatus;
  reminders: RemindersAccess;
}

export interface SourceCoverage {
  /** False only when the bounded fetch reached a documented cap. */
  complete: boolean;
  /** What prevented a complete result when `complete` is false. */
  reason?: "item-cap" | "list-cap" | "calendar-cap";
  /** Number of returned items. */
  loaded: number;
}

export type SourceResult<T> =
  | {
      state: "ok";
      items: T[];
      /** Present for bounded remote-source listings. */
      coverage?: SourceCoverage;
      /** ISO timestamp of the most recent successful renderer fetch. */
      refreshedAt?: string;
      /** A refresh failed after the items above were successfully loaded. */
      refreshError?: string;
    }
  | { state: "needs-setup" }
  | { state: "not-connected" }
  | { state: "no-access"; access: RemindersAccess }
  | { state: "disabled" };

export interface TaskItem {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  completed: boolean;
  completedAt: string | null;
}

export interface ReminderItem {
  /** Provider succeeded, but its local relationship metadata still needs saving. */
  agendaSaveError?: string;
  /** Calendar-qualified provider identity when available; `ref` is a mutable transport reference. */
  identity: string;
  ref: string;
  listTitle: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** HH:mm */
  dueTime: string | null;
  priority: number;
  completed: boolean;
  completedAt: string | null;
  /** EventKit exposes a recurring series as its next incomplete occurrence. */
  recurring: boolean;
}

export interface MailItem {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events */
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  htmlLink: string | null;
  meetLink: string | null;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  attendees: string[];
}

export interface GoogleCalendarInfo {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  defaultVisible: boolean;
}

export interface CalendarListResult {
  calendars: GoogleCalendarInfo[];
  /** True when the saved Google sign-in predates calendar-list access. */
  limited: boolean;
}

export interface ReviewData {
  since: string;
  tasks: SourceResult<TaskItem>;
  reminders: SourceResult<ReminderItem>;
  events: SourceResult<CalendarEventItem>;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  due?: string;
}

export interface CreateReminderInput {
  title: string;
  notes?: string;
  dueDate?: string;
  dueTime?: string;
}

export interface CreateEventInput {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  timeZone: string;
  notes?: string;
}

export type AgendaTodoRef =
  | {
      /** Stable Google Task identity: `task:${listId}:${taskId}`. */
      key: string;
      source: "tasks";
      listId: string;
      taskId: string;
    }
  | {
      /** Stable local identity: `reminder:${identity}`; `ref` can be replaced by EventKit. */
      key: string;
      source: "reminders";
      identity: string;
      ref: string;
    };

export interface AgendaDuplicateLink {
  leftKey: string;
  rightKey: string;
  status: "accepted" | "dismissed";
}

export interface AgendaScheduledBlock {
  taskKey: string;
  eventId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Used only to make a repeated confirmation safe. */
  requestId?: string;
}

export interface AgendaState {
  focusKeys: string[];
  duplicateLinks: AgendaDuplicateLink[];
  scheduledBlocks: AgendaScheduledBlock[];
}

/** The backend owns the opaque scope; renderer cache keys must include it. */
export interface AgendaScopedState {
  scope: string;
  state: AgendaState;
}

export interface AgendaCreateBlockInput {
  /** UUID generated once when the user confirms the preview. */
  requestId: string;
  task: AgendaTodoRef;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  notes?: string;
}

export interface AssistantMessageInput {
  role: "user" | "assistant";
  content: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export type AIStreamChunk =
  | { type: "delta"; text: string }
  /** The exact model serving this reply, as reported by the provider. */
  | { type: "meta"; model: AssistantModelInfo }
  /** Tokens for this turn; `contextWindow` is null when the provider doesn't publish it. */
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      contextWindow: number | null;
    }
  | { type: "tool"; id: string; name?: string; status: ToolCallStatus };

export type AssistantResult = { text: string } | { blocked: string };

export interface AssistantModelInfo {
  provider: AIProvider;
  /** Human name, e.g. "GPT-5.6 Sol" or "Claude Opus". */
  name: string;
  /** Exact model ID when known (e.g. "gpt-5.6-sol", "claude-opus-4-..."). */
  id: string | null;
  fast: boolean;
  effort: string | null;
  contextWindow: number | null;
}

/** read-only: never propose changes · ask: propose, user confirms · auto: add proposals directly. */
export type AssistantPermission = "read-only" | "ask" | "auto";

export interface AssistantAttachment {
  id: string;
  name: string;
  kind: "file" | "folder";
}

export interface OpenAIKeyStatus {
  configured: boolean;
  /** Last four characters, for recognition only. */
  hint: string | null;
}

export type ApiKeyStatuses = Record<ApiProviderId, OpenAIKeyStatus>;

export interface ApiModelInfo {
  id: string;
  name: string;
  contextWindow: number | null;
}

/** Whether each provider can be used right now (CLI installed or API key saved). */
export type ProviderAvailability = Record<AIProvider, boolean>;

export interface AssistantMcpServerInfo {
  id: string;
  name: string;
  builtIn: boolean;
  transport: "stdio" | "http";
  /** Command or URL host, without secrets. */
  target: string;
}

export interface AssistantMcpCheck {
  id: string;
  ok: boolean;
  tools: string[];
  error: string | null;
}
