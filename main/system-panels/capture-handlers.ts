// IPC and native confirmations for Quick Capture. The pipeline itself is capture-service.ts.

import { randomUUID } from "node:crypto";
import { Notification } from "electron";

import { describeCapture, type ItemDraft } from "../../shared/capture.js";
import { getAccountsStatus, requireAgendaScope } from "../handlers/productivity.js";
import { ipcMain, logger } from "../platform/index.js";
import { runGuardedCommand } from "../platform/ipc.js";
import { runCompletion } from "../services/ai/completion.js";
import { createReminder, deleteReminder } from "../services/apple-reminders.js";
import {
  createCaptureService,
  type CaptureRecord,
  type CaptureSubmit,
} from "../services/capture/capture-service.js";
import { isDemoMode } from "../services/demo-data.js";
import { createEvent, createTask, deleteEvent, deleteTask } from "../services/google-api.js";
import { trackPendingWrite } from "../services/pending-writes.js";
import { getSettings } from "../services/settings-store.js";
import { recordNotificationResult } from "./notification-status.js";
import { isPanelVisible, showPanel } from "./panel-window.js";

const ACCOUNT_CHANGED = "Your account changed. Check the details and add it again.";
const SOURCE = { task: "tasks", reminder: "reminders", event: "calendar" } as const;
// Electron drops a notification's handlers once it is garbage-collected; keep each one alive.
const liveNotifications = new Set<Notification>();

function draftInput(draft: ItemDraft) {
  return {
    title: draft.title,
    notes: draft.notes || undefined,
  };
}

const service = createCaptureService({
  isDemoMode,
  currentScope: requireAgendaScope,
  guardedWrite: (scope, write) =>
    trackPendingWrite(async () => {
      if ((await requireAgendaScope()) !== scope) throw new Error(ACCOUNT_CHANGED);
      return write();
    }),
  getSettings,
  getAccounts: getAccountsStatus,
  complete: async (system, prompt) => {
    const controller = new AbortController();
    return (await runCompletion({ system, prompt, signal: controller.signal })).text;
  },
  create: {
    task: (draft) => createTask({ ...draftInput(draft), due: draft.date || undefined }),
    reminder: (draft) =>
      createReminder({
        ...draftInput(draft),
        dueDate: draft.date || undefined,
        dueTime: draft.date && draft.time ? draft.time : undefined,
      }),
    event: (draft) =>
      createEvent({
        ...draftInput(draft),
        date: draft.date,
        startTime: draft.time || undefined,
        endTime: draft.time && draft.endTime ? draft.endTime : undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
  },
  remove: {
    task: (ref) => deleteTask(ref.listId, ref.taskId),
    reminder: (ref) => deleteReminder(ref),
    event: (ref) => deleteEvent(ref.calendarId, ref.eventId),
  },
  onChange: (records) => ipcMain.broadcast("capture:changed", { records }),
  onCreated: (record) => {
    if (record.draft) ipcMain.broadcast("data:changed", { source: SOURCE[record.draft.kind] });
    confirm(record);
  },
  onFailed: () => {
    if (!isPanelVisible("capture"))
      void showPanel("capture").catch((error) =>
        logger.warn("capture", "Could not reopen Quick Capture after a failure", error),
      );
  },
  now: () => new Date(),
  newId: randomUUID,
});

/** One Undo command for IPC and notification buttons: admission, license and receipt checks. */
function undo(id: string): Promise<CaptureRecord> {
  return service.undo(id).then((record) => {
    if (record.draft) ipcMain.broadcast("data:changed", { source: SOURCE[record.draft.kind] });
    return record;
  });
}

function confirm(record: CaptureRecord): void {
  if (!record.draft || !Notification.isSupported()) return;
  const { title, body } = describeCapture(record.draft);
  const notification = new Notification({
    title,
    body,
    silent: true,
    actions: [{ type: "button", text: "Undo" }],
  });
  liveNotifications.add(notification);
  const release = () => liveNotifications.delete(notification);
  setTimeout(release, 10 * 60_000).unref?.();
  notification.on("show", () => recordNotificationResult("delivered"));
  notification.on("failed", (_event, error) => {
    release();
    recordNotificationResult("refused");
    logger.warn("capture", "macOS did not show the capture confirmation", { error });
  });
  notification.on("action", (_event, index) => {
    if (index !== 0) return;
    release();
    void runGuardedCommand("capture:undo", () => undo(record.id)).catch((error) =>
      logger.warn("capture", "Undo from the notification failed", error),
    );
  });
  notification.on("close", release);
  notification.show();
}

function submitInput(value: unknown): CaptureSubmit {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("capture:submit: expected an object");
  const input = value as Record<string, unknown>;
  if (typeof input.text === "string") return { text: input.text };
  if (typeof input.draft === "object" && input.draft !== null) return { draft: input.draft };
  throw new Error("capture:submit: send text or a draft");
}

export function registerCaptureHandlers(): void {
  ipcMain.handle("capture:submit", (_event, value: unknown) => service.submit(submitInput(value)));
  ipcMain.handle("capture:undo", (_event, value: unknown) => {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) throw new Error("capture:undo: id is required");
    return undo(id);
  });
  ipcMain.handle("capture:recent", () => service.recent());
}
