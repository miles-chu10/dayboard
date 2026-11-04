import type { MentionItem } from "./assistant-mentions";
import type { NavId } from "./navigation";

const VIEW_SUGGESTIONS: Partial<Record<NavId, string[]>> = {
  mail: ["Which emails need a reply from me?", "Turn mail I owe a reply into tasks"],
  calendar: ["When am I free this week for 30 minutes?", "What's my busiest day this week?"],
  tasks: ["What's overdue, and what should I do first?", "Group my tasks by project"],
  reminders: ["What's overdue, and what should I do first?", "What's due this week?"],
  review: ["What did I get done this week?", "What slipped this week?"],
};

const DEFAULT_SUGGESTIONS = [
  "What needs me today?",
  "When am I free this week for 30 minutes?",
  "Turn mail I owe a reply into tasks",
];

function quoted(label: string): string {
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

/** Prompts the docked Assistant offers for what is on screen; the open item comes first. */
export function contextSuggestions(view: NavId | undefined, item?: MentionItem): string[] {
  const itemPrompts = !item
    ? []
    : item.kind === "email"
      ? [`Catch me up on “${quoted(item.label)}”`, "Draft a reply to this email"]
      : item.kind === "event"
        ? [`Prep me for “${quoted(item.label)}”`, "What should I bring to this meeting?"]
        : [`Break “${quoted(item.label)}” into steps`, "When could I fit this in this week?"];
  const viewPrompts = (view && VIEW_SUGGESTIONS[view]) ?? DEFAULT_SUGGESTIONS;
  return [...itemPrompts, ...viewPrompts].slice(0, 4);
}

/** The `@` mention key for an item a view has open (see `mentionCandidates`). */
export function contextItemKey(item: {
  mail?: { id: string };
  todo?: { key: string };
  event?: { calendarId: string; id: string; start: string };
}): string | undefined {
  if (item.mail) return `mail:${item.mail.id}`;
  if (item.todo) return item.todo.key;
  if (item.event) return `event:${item.event.calendarId}:${item.event.id}:${item.event.start}`;
  return undefined;
}

/** One snapshot line naming the view the user asked from, so "this" has a referent. */
export function viewContextLine(title: string | undefined): string {
  return title ? `The user is asking from DayBoard's ${title} view.` : "";
}
