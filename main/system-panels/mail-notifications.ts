// Mail notifications (new mail, snoozes coming back, unanswered follow-ups) and the Dock badge.

import { app, Notification } from "electron";

import { onMailDue } from "../handlers/mail.js";
import { onAccountsChanged } from "../handlers/productivity.js";
import { ipcMain, logger } from "../platform/index.js";
import { isDemoMode } from "../services/demo-data.js";
import { getGoogleStatus } from "../services/google-auth.js";
import { listInbox } from "../services/google-api.js";
import {
  badgeText,
  dueNotice,
  newMailNotices,
  newUnread,
  type MailNotice,
} from "../services/mail-watch.js";
import { getSettings, onSettingsChanged } from "../services/settings-store.js";
import { focusMainWindow } from "../window.js";
import { recordNotificationResult } from "./notification-status.js";

const MIN_INTERVAL = 5 * 60_000;
// Electron drops a notification's handlers once it is garbage-collected; keep each one alive.
const live = new Set<Notification>();

function notify(notice: MailNotice): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: notice.title,
    body: notice.body,
  });
  live.add(notification);
  const release = () => live.delete(notification);
  setTimeout(release, 30 * 60_000).unref?.();
  notification.on("show", () => recordNotificationResult("delivered"));
  notification.on("failed", (_event, error) => {
    release();
    recordNotificationResult("refused");
    logger.warn("mail", "macOS did not show the mail notification", { error });
  });
  notification.on("click", () => {
    release();
    void focusMainWindow({ to: notice.to });
  });
  notification.on("close", release);
  notification.show();
}

/** Starts mail notifications; they follow Settings → Notifications and the connected account. */
export function startMailNotifications(enabled: boolean): void {
  if (!enabled || isDemoMode()) return;
  let seen: Set<string> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMailDue((entry) => {
    void getSettings().then((settings) => {
      if (settings.system.mailNotifications !== "off") notify(dueNotice(entry));
    });
  });

  async function check() {
    const settings = await getSettings();
    if (settings.system.mailNotifications !== "all" || !settings.sources.mail.enabled) {
      seen = null;
      return;
    }
    if (!(await getGoogleStatus()).connected) return;
    const result = newUnread(seen, await listInbox(settings.mail.maxMessages));
    seen = result.seen;
    for (const notice of newMailNotices(result.fresh)) notify(notice);
  }

  // Only the newest loop reschedules, so a settings change mid-check never leaves two running.
  let generation = 0;
  async function loop(current: number) {
    try {
      await check();
    } catch (error) {
      logger.warn("mail", "Could not check for new mail", error);
    }
    if (current !== generation) return;
    const minutes = (await getSettings().catch(() => null))?.general.refreshMinutes || 5;
    if (current !== generation) return;
    timer = setTimeout(() => void loop(current), Math.max(MIN_INTERVAL, minutes * 60_000));
    timer.unref?.();
  }
  function restart() {
    if (timer) clearTimeout(timer);
    void loop(++generation);
  }

  onAccountsChanged(() => {
    seen = null;
  });
  onSettingsChanged((next, previous) => {
    if (next.system.mailNotifications === previous.system.mailNotifications) return;
    // Turning "All new mail" on starts from what is already there.
    seen = null;
    restart();
  });
  restart();
}

/** `app:setBadge`: the renderer knows what waits on the user (it owns triage), so it reports the count. */
export function registerBadgeHandler(enabled: boolean): void {
  ipcMain.handle("app:setBadge", (_event, payload: unknown) => {
    const count =
      typeof payload === "object" && payload !== null
        ? (payload as { count?: unknown }).count
        : undefined;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 100_000)
      throw new Error("app:setBadge: count must be a whole number");
    if (enabled) app.dock?.setBadge(badgeText(count));
  });
}
