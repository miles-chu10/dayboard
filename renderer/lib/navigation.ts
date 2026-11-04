import type { AIFeature, AppSettings, SourceId } from "@main/shared-types";

export type NavRoute =
  | "/"
  | "/agenda"
  | "/calendar"
  | "/mail"
  | "/tasks"
  | "/reminders"
  | "/notes"
  | "/assistant"
  | "/review";

export type NavId = "home" | "agenda" | SourceId | "notes" | "assistant" | "review";

export interface NavItem {
  id: NavId;
  title: string;
  route: NavRoute;
  group: "main" | "ai";
  /** Extra words the command menu matches. */
  keywords: string[];
  source?: SourceId;
  feature?: AIFeature;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "home",
    title: "Home",
    route: "/",
    group: "main",
    keywords: ["up next", "today", "needs you", "start"],
  },
  {
    id: "agenda",
    title: "Agenda",
    route: "/agenda",
    group: "main",
    keywords: ["day", "schedule", "planner"],
  },
  {
    id: "calendar",
    title: "Calendar",
    route: "/calendar",
    group: "main",
    keywords: ["events", "meetings", "schedule"],
    source: "calendar",
  },
  {
    id: "mail",
    title: "Inbox",
    route: "/mail",
    group: "main",
    keywords: ["mail", "gmail", "email"],
    source: "mail",
  },
  {
    id: "tasks",
    title: "Tasks",
    route: "/tasks",
    group: "main",
    keywords: ["google tasks", "todo"],
    source: "tasks",
  },
  {
    id: "reminders",
    title: "Reminders",
    route: "/reminders",
    group: "main",
    keywords: ["apple reminders", "todo"],
    source: "reminders",
  },
  {
    id: "notes",
    title: "Notes",
    route: "/notes",
    group: "main",
    keywords: ["notes", "markdown", "write", "docs"],
  },
  {
    id: "assistant",
    title: "Assistant",
    route: "/assistant",
    group: "ai",
    keywords: ["ai", "chat", "agent"],
    feature: "assistant",
  },
  {
    id: "review",
    title: "Weekly Review",
    route: "/review",
    group: "ai",
    keywords: ["week", "review"],
    feature: "weeklyReview",
  },
];

export function navItemVisible(settings: AppSettings | undefined, item: NavItem): boolean {
  if (item.source) return settings?.sources[item.source].enabled ?? true;
  if (item.feature) return Boolean(settings?.ai.enabled && settings.ai.features[item.feature]);
  return true;
}

/** The sidebar's views in order; ⌃1–9 and the command menu follow the same list. */
export function visibleNav(settings: AppSettings | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => navItemVisible(settings, item));
}
