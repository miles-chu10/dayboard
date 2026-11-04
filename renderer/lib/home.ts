import type { MailItem } from "@main/shared-types";

import { addDays } from "./dates";
import { compareByDue, type Todo } from "./todos";
import type { TriageMap } from "./triage-types";

export type HomeSpan = "today" | "week";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface NeedsYouItem {
  key: string;
  kind: "reply" | "unread" | "follow-up";
  title: string;
  detail: string;
  chip: string;
  /** When it started waiting on the user, in ms since the epoch. */
  since: number;
  mail: MailItem;
}

/** Waiting longer than a day: shown first, oldest first, with a warning on its age. */
export function isStale(since: number, now: number): boolean {
  return now - since >= DAY;
}

/**
 * Mail waiting on the user: what triage marked Needs Reply, plus unread mail triage hasn't seen.
 * Stale items lead (oldest first), then the rest newest first, as on HeroSpace's Up next.
 */
export function needsYou(input: {
  messages: MailItem[];
  triage: TriageMap;
  now: number;
  followUps?: { mail: MailItem; since: number; days: number }[];
}): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  const seen = new Set<string>();
  for (const followUp of input.followUps ?? []) {
    seen.add(followUp.mail.id);
    items.push({
      key: `follow-up:${followUp.mail.id}`,
      kind: "follow-up",
      title: followUp.mail.from,
      detail: followUp.mail.subject,
      chip: `No reply in ${followUp.days} ${followUp.days === 1 ? "day" : "days"}`,
      since: followUp.since,
      mail: followUp.mail,
    });
  }
  for (const message of input.messages) {
    if (seen.has(message.id)) continue;
    const result = input.triage[message.id];
    const since = Date.parse(message.date) || input.now;
    if (result?.category === "needs-reply")
      items.push({
        key: `mail:${message.id}`,
        kind: "reply",
        title: message.from,
        detail: message.subject,
        chip: result.reason.trim() || "Needs reply",
        since,
        mail: message,
      });
    else if (!result && message.unread)
      items.push({
        key: `mail:${message.id}`,
        kind: "unread",
        title: message.from,
        detail: message.subject,
        chip: "Unread",
        since,
        mail: message,
      });
  }
  return items.sort((a, b) => {
    const staleA = isStale(a.since, input.now);
    const staleB = isStale(b.since, input.now);
    if (staleA !== staleB) return staleA ? -1 : 1;
    return staleA ? a.since - b.since : b.since - a.since;
  });
}

/** "Just now", "12m", "3h", "2 days". */
export function ageLabel(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  const days = Math.floor(elapsed / DAY);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export interface SuggestedTask {
  key: string;
  title: string;
  mail: MailItem;
}

/** Tasks triage spotted in mail, minus the ones the user added or dismissed. */
export function suggestedTasks(input: {
  messages: MailItem[];
  triage: TriageMap;
  handled: readonly string[];
}): SuggestedTask[] {
  const handled = new Set(input.handled);
  return input.messages.flatMap((message) => {
    const title = input.triage[message.id]?.task.trim();
    const key = `suggest:${message.id}`;
    return title && !handled.has(key) ? [{ key, title, mail: message }] : [];
  });
}

/** Open tasks and reminders for Home: overdue and due today, or due within the next 7 days. */
export function homeTodos(todos: Todo[], today: string, span: HomeSpan): Todo[] {
  const last = span === "today" ? today : addDays(today, 6);
  return todos
    .filter((todo) => !todo.completed && todo.dueDate !== null && todo.dueDate <= last)
    .sort(compareByDue);
}

export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Good evening";
  if (hour < 12) return "Good morning";
  return "Good afternoon";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** "3 waiting on you, 2 suggested tasks and 6 meetings today." */
export function homeSummary(input: {
  waiting: number;
  suggested: number;
  meetings: number;
  span: HomeSpan;
}): string {
  const parts = [
    `${input.waiting} waiting on you`,
    ...(input.suggested ? [count(input.suggested, "suggested task", "suggested tasks")] : []),
    `${count(input.meetings, "meeting", "meetings")} ${input.span === "today" ? "today" : "this week"}`,
  ];
  const last = parts.pop()!;
  return `${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
}
