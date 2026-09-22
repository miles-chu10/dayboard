// Types shared by the backend handlers and the renderer (renderer imports these type-only).

export type RemindersAccess =
  | "not-determined"
  | "denied"
  | "restricted"
  | "full-access"
  | "unknown";

export type SourceId = "tasks" | "reminders" | "mail" | "calendar";
export type SourceColor = "blue" | "green" | "orange" | "red" | "purple" | "magenta" | "yellow";
export type AIProvider = "glaze" | "claude" | "codex";
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
    useMcpInAssistant: boolean;
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
      /** Stable Apple Reminder identity: `reminder:${ref}`. */
      key: string;
      source: "reminders";
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
  | { type: "tool"; id: string; name?: string; status: ToolCallStatus };

export type AssistantResult = { text: string } | { blocked: string };
