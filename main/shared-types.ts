// Types shared by the backend handlers and the renderer (renderer imports these type-only).

export type RemindersAccess = "not-determined" | "denied" | "restricted" | "full-access" | "unknown";

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
  | { state: "no-access"; access: RemindersAccess };

export interface TaskItem {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD */
  due: string | null;
  completed: boolean;
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
  htmlLink: string | null;
  meetLink: string | null;
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
