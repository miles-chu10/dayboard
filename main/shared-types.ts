// Types shared by the backend handlers and the renderer (renderer imports these type-only).

export type RemindersAccess = "not-determined" | "denied" | "restricted" | "full-access" | "unknown";

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
export type LaunchView = "today" | SourceId | "assistant" | "review";

export interface AppSettings {
  general: {
    launchView: LaunchView;
    /** 0 = manual refresh only */
    refreshMinutes: number;
  };
  sources: Record<SourceId, { enabled: boolean; color: SourceColor }>;
  mail: { maxMessages: number };
  calendar: {
    daysAhead: number;
    /** Per-calendar override; calendars without an entry use Google's own visibility. */
    visibility: Record<string, boolean>;
  };
  ai: {
    enabled: boolean;
    provider: AIProvider;
    claudeModel: "default" | "sonnet" | "opus" | "haiku";
    codexModel: string;
    useMcpInAssistant: boolean;
    features: Record<AIFeature, boolean>;
  };
}

export interface SettingsChangedEvent {
  settings: AppSettings;
  /** True when a change affects which source data is fetched. */
  dataChanged: boolean;
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
  | { ok: false; reason: "missing" | "not-logged-in" | "failed"; message: string };

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

export type SourceResult<T> =
  | { state: "ok"; items: T[] }
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

export interface AssistantMessageInput {
  role: "user" | "assistant";
  content: string;
}

export type ToolCallStatus = "running" | "success" | "error";

export type AIStreamChunk =
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name?: string; status: ToolCallStatus };

export type AssistantResult = { text: string } | { blocked: string };
