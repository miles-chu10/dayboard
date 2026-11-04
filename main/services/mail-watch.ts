/** Deciding which mail events become macOS notifications. Electron-free. */

import type { MailItem, MailScheduleEntry } from "../shared-types.js";

export interface MailNotice {
  title: string;
  body: string;
  /** The view a click opens. */
  to: "/" | "/mail";
}

/**
 * Unread inbox mail not seen at the last check. The first check (`seen` null) only remembers what
 * is there, so opening DayBoard never replays the whole inbox as notifications.
 */
export function newUnread(
  seen: ReadonlySet<string> | null,
  items: MailItem[],
): { seen: Set<string>; fresh: MailItem[] } {
  const next = new Set(items.map((item) => item.id));
  if (!seen) return { seen: next, fresh: [] };
  return {
    seen: next,
    fresh: items.filter((item) => item.unread && !seen.has(item.id)),
  };
}

/** One notice per email, or a single summary when several arrive at once. */
export function newMailNotices(fresh: MailItem[], max = 3): MailNotice[] {
  if (!fresh.length) return [];
  if (fresh.length <= max)
    return fresh.map((item) => ({
      title: item.from || item.fromEmail,
      body: item.subject,
      to: "/mail",
    }));
  const senders = [...new Set(fresh.map((item) => item.from || item.fromEmail))];
  return [
    {
      title: `${fresh.length} new emails`,
      body: `From ${senders.slice(0, 3).join(", ")}${senders.length > 3 ? " and others" : ""}`,
      to: "/mail",
    },
  ];
}

export function dueNotice(entry: MailScheduleEntry): MailNotice {
  if (entry.kind === "snooze")
    return {
      title: "Back from snooze",
      body: `${entry.from}: ${entry.subject}`,
      to: "/mail",
    };
  const days = Math.max(1, Math.round((entry.dueAt - entry.createdAt) / 86_400_000));
  return {
    title: `No reply from ${entry.from} in ${days} ${days === 1 ? "day" : "days"}`,
    body: entry.subject,
    to: "/",
  };
}

/** The Dock badge text for a count: empty hides it. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}
