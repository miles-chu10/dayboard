// Apple Reminders via the bundled Swift EventKit helper (native/reminders-helper), matching the
// `reminders` surface documented in main/platform/README.md. Re-implemented from the operations
// main/services/apple-reminders.ts uses; no Glaze SDK source was copied.

import { app } from "electron";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  decodeResponse,
  encodeRequest,
  LineBuffer,
  type HelperResponse,
} from "./reminders-codec.js";

export type RemindersAuthorizationStatus =
  | "not-determined"
  | "denied"
  | "restricted"
  | "full-access"
  | "unknown";

export interface ReminderRef {
  value: string;
}

export type EventTime =
  | { kind: "date"; date: string }
  | { kind: "date-time"; dateTime: string; timeZone: string | null };

export interface RecurrenceRule {
  calendarIdentifier: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  firstDayOfWeek: number | null;
  daysOfTheWeek: unknown[];
  daysOfTheMonth: number[];
  daysOfTheYear: number[];
  weeksOfTheYear: number[];
  monthsOfTheYear: number[];
  setPositions: number[];
  end: unknown | null;
}

export interface CalendarInfo {
  id: string;
  title: string;
  color: string | null;
  type: "local" | "caldav" | "exchange" | "subscription" | "birthday" | "unknown";
  source: string | null;
  sourceId: string;
  entityTypes: Array<"event" | "reminder">;
  supportedAvailabilities: string[];
  allowsContentModifications: boolean;
  isSubscribed: boolean;
  isImmutable: boolean;
}

export interface Reminder {
  ref: ReminderRef;
  externalId: string | null;
  calendarId: string;
  title: string;
  location: string | null;
  notes: string | null;
  url: string | null;
  creationDate: string | null;
  lastModifiedDate: string | null;
  start: EventTime | null;
  due: EventTime | null;
  isCompleted: boolean;
  completionDate: string | null;
  priority: number;
  alarms: unknown[];
  recurrenceRules: RecurrenceRule[];
}

export interface GetRemindersOptions {
  completed?: boolean;
  limit?: number;
}

export interface GetRemindersResult {
  reminders: Reminder[];
  truncated: boolean;
}

export interface CreateReminderInput {
  title: string;
  calendarId?: string;
  notes?: string;
  due?: EventTime;
}

export type ClearableReminderField =
  | "notes"
  | "url"
  | "location"
  | "start"
  | "due"
  | "completionDate";

export interface UpdateReminderPatch {
  title?: string;
  calendarId?: string;
  notes?: string;
  priority?: number;
  isCompleted?: boolean;
  due?: EventTime;
  clearFields?: ClearableReminderField[];
}

const REQUEST_TIMEOUT_MS = 15_000;
const PERMISSION_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", "reminders-helper");
  return path.join(app.getAppPath(), "resources", "bin", "reminders-helper");
}

class RemindersProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly buffer = new LineBuffer();

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;

    const child = spawn(helperPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // The helper reports failures per-request over stdout; stderr is unstructured diagnostics.
    });
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code) => {
      if (this.child === child) this.child = null;
      this.rejectAll(
        new Error(`Reminders helper exited unexpectedly (code ${code ?? "unknown"}).`),
      );
    });

    return child;
  }

  private handleData(chunk: string): void {
    for (const line of this.buffer.push(chunk)) this.handleLine(line);
  }

  private handleLine(line: string): void {
    let response: HelperResponse;
    try {
      response = decodeResponse(line);
    } catch {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error));
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const child = this.ensureStarted();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`Reminders helper timed out waiting for "${op}".`));
        },
        op === "requestAccess" ? PERMISSION_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
      );
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      child.stdin.write(encodeRequest({ id, op, params }), (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }
}

const process_ = new RemindersProcess();

export const reminders = {
  status(): Promise<RemindersAuthorizationStatus> {
    return process_.request("status");
  },
  requestAccess(): Promise<RemindersAuthorizationStatus> {
    return process_.request("requestAccess");
  },
  getCalendars(): Promise<CalendarInfo[]> {
    return process_.request("getCalendars");
  },
  getReminders(options: GetRemindersOptions = {}): Promise<GetRemindersResult> {
    return process_.request("getReminders", { ...options });
  },
  getReminder(reference: ReminderRef): Promise<Reminder> {
    return process_.request("getReminder", { reference });
  },
  createReminder(input: CreateReminderInput): Promise<Reminder> {
    return process_.request("createReminder", { input });
  },
  updateReminder(reference: ReminderRef, patch: UpdateReminderPatch): Promise<Reminder> {
    return process_.request("updateReminder", { reference, patch });
  },
  deleteReminder(reference: ReminderRef): Promise<void> {
    return process_.request("deleteReminder", { reference });
  },
};
