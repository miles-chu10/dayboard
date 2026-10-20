import { ipcMain } from "../platform/index.js";

export type NotificationStatus = "unknown" | "delivered" | "refused";

let status: NotificationStatus = "unknown";

/** macOS can refuse DayBoard's notifications (unsigned builds, or turned off in System Settings). */
export function recordNotificationResult(result: Exclude<NotificationStatus, "unknown">): void {
  if (status === result) return;
  status = result;
  ipcMain.broadcast("system:notificationStatus", { status });
}

export function notificationStatus(): { status: NotificationStatus } {
  return { status };
}
