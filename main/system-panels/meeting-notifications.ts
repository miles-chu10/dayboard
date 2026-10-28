// Glaze wiring for meeting alerts: event source, macOS notification with Join, refresh cadence.

import { Notification, logger, shell } from "@glaze/core/backend";

import { onAccountsChanged } from "../handlers/productivity.js";
import { isDemoMode } from "../services/demo-data.js";
import { getGoogleStatus } from "../services/google-auth.js";
import { listEventsBetween } from "../services/google-api.js";
import { createMeetingAlerts, type MeetingAlert } from "../services/meetings/meeting-alerts.js";
import { getSettings, onSettingsChanged } from "../services/settings-store.js";
import { focusMainWindow } from "../windows/main-window.js";
import { recordNotificationResult } from "./notification-status.js";
import { showPanel } from "./panel-window.js";

const DAY_MS = 24 * 3_600_000;

/** Join links open in the browser only as plain http(s) URLs without embedded credentials. */
function isExternalWebUrl(value: string): boolean {
  try {
    const target = new URL(value);
    return (
      (target.protocol === "http:" || target.protocol === "https:") &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}
const MAX_TIMER_MS = 2 ** 31 - 1;
// Keep each notification referenced so its handlers outlive garbage collection.
const live = new Set<Notification>();

async function upcomingEvents() {
  if (isDemoMode()) return null;
  const settings = await getSettings();
  if (!settings.sources.calendar.enabled) return null;
  const { connected, email } = await getGoogleStatus();
  if (!connected) return null;
  const now = new Date();
  try {
    return await listEventsBetween(
      now,
      new Date(now.getTime() + DAY_MS),
      settings.calendar.visibility,
      email,
    );
  } catch (error) {
    logger.warn("meetings", "Could not read upcoming meetings for alerts", error);
    return null;
  }
}

function notify(alert: MeetingAlert): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: alert.title,
    body: alert.body,
    actions: alert.joinUrl ? [{ type: "button", text: "Join" }] : [],
  });
  live.add(notification);
  const release = () => live.delete(notification);
  setTimeout(release, 30 * 60_000).unref?.();
  notification.on("show", () => recordNotificationResult("delivered"));
  notification.on("failed", (_event, error) => {
    release();
    recordNotificationResult("refused");
    logger.warn("meetings", "macOS did not show the meeting alert", { error });
  });
  notification.on("action", (_event, index) => {
    release();
    if (index === 0 && alert.joinUrl && isExternalWebUrl(alert.joinUrl))
      void shell.openExternal(alert.joinUrl);
  });
  notification.on("click", () => {
    release();
    void getSettings().then((settings) =>
      settings.system.menuBar.enabled ? showPanel("menubar") : focusMainWindow(),
    );
  });
  notification.on("close", release);
  notification.show();
}

/** Starts meeting alerts; they follow Settings → Meetings and the connected account. */
export function startMeetingNotifications(): void {
  if (isDemoMode()) return;
  const alerts = createMeetingAlerts({
    listEvents: upcomingEvents,
    notify,
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, Math.min(ms, MAX_TIMER_MS));
      return () => clearTimeout(timer);
    },
    now: () => new Date(),
  });
  let interval: ReturnType<typeof setInterval> | undefined;
  const apply = async () => {
    const settings = await getSettings();
    clearInterval(interval);
    const minutes = Math.max(5, settings.general.refreshMinutes || 15);
    if (settings.system.meetings.notify)
      interval = setInterval(() => void alerts.refresh(), minutes * 60_000);
    await alerts.configure(settings.system.meetings);
  };
  void apply().catch((error) => logger.warn("meetings", "Could not start meeting alerts", error));
  onSettingsChanged(() => void apply());
  onAccountsChanged(() => void alerts.refresh());
}
