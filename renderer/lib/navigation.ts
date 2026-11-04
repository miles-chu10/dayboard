import type { AIFeature, AppSettings, SidebarView, SourceId } from "@main/shared-types";

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

/** Every view that can open, main views in the sidebar's saved order, then the AI views. */
export function navTargets(settings: AppSettings | undefined): NavItem[] {
  const order = settings?.general?.sidebar?.order ?? [];
  const rank = (item: NavItem) => {
    const index = order.indexOf(item.id as SidebarView);
    return item.group === "ai" ? 1_000 : index < 0 ? 500 : index;
  };
  return NAV_ITEMS.filter((item) => navItemVisible(settings, item))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** The sidebar's views in order, without the ones hidden in Settings; ⌃1–9 follow this list. */
export function visibleNav(settings: AppSettings | undefined): NavItem[] {
  const hidden = settings?.general?.sidebar?.hidden ?? [];
  return navTargets(settings).filter((item) => !hidden.includes(item.id as SidebarView));
}
