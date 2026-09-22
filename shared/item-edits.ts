/** Provider-scoped edit payloads shared by the renderer and IPC handlers. */
export interface UpdateTaskInput {
  listId: string;
  taskId: string;
  title: string;
  notes: string;
  /** YYYY-MM-DD, or null to clear the due date. */
  due: string | null;
}

export interface UpdateReminderInput {
  /** Current opaque EventKit transport reference. */
  ref: string;
  title: string;
  notes: string;
  /** Only set true when the user changed the date or time. */
  dueChanged: boolean;
  /** YYYY-MM-DD, or null to clear both date and time when `dueChanged` is true. */
  dueDate?: string | null;
  /** HH:mm, or null for a date-only reminder when `dueChanged` is true. */
  dueTime?: string | null;
  /** EventKit priority scale: 0 through 9. */
  priority: number;
}

export interface UpdateEventInput {
  calendarId: string;
  /** Exact event or expanded recurring-instance ID from Google Calendar. */
  eventId: string;
  title: string;
  /** Omit to preserve the provider's exact description formatting; empty clears it. */
  description?: string;
  location: string;
  /** YYYY-MM-DD for all-day events, otherwise RFC 3339 date-time. */
  start: string;
  /** Exclusive YYYY-MM-DD for all-day events, otherwise RFC 3339 date-time. */
  end: string;
  allDay: boolean;
  timeZone: string;
  /** Only set true when the user changed the times; otherwise the event keeps its own time zone. */
  timesChanged: boolean;
}
