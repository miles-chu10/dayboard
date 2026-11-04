// Browser-style tabs: each tab remembers one view (route and its search) and the strip switches
// between them. Pure state; the shell persists it and drives the router.

export interface Tab {
  id: string;
  route: string;
  search: Record<string, string>;
}

export interface TabsState {
  tabs: Tab[];
  active: string;
}

export const MAX_TABS = 12;
/** One-shot hand-offs (a question for the Assistant) are not worth reopening. */
const TRANSIENT_SEARCH = new Set(["prompt"]);

export function cleanSearch(search: unknown): Record<string, string> {
  if (typeof search !== "object" || search === null) return {};
  return Object.fromEntries(
    Object.entries(search).filter(
      ([key, value]) => typeof value === "string" && value && !TRANSIENT_SEARCH.has(key),
    ),
  ) as Record<string, string>;
}

export function activeTab(state: TabsState): Tab {
  return state.tabs.find((tab) => tab.id === state.active) ?? state.tabs[0];
}

/** A new tab right after the active one, which it replaces as active; the oldest drop past the cap. */
export function openTab(state: TabsState, tab: Tab): TabsState {
  const index = state.tabs.findIndex((item) => item.id === state.active);
  const tabs = [...state.tabs.slice(0, index + 1), tab, ...state.tabs.slice(index + 1)];
  while (tabs.length > MAX_TABS) tabs.splice(tabs[0].id === tab.id ? 1 : 0, 1);
  return { tabs, active: tab.id };
}

/** Closing the active tab moves to its right neighbour, else its left; the last tab stays. */
export function closeTab(state: TabsState, id: string): TabsState {
  if (state.tabs.length <= 1) return state;
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const active = state.active === id ? tabs[Math.min(index, tabs.length - 1)].id : state.active;
  return { tabs, active };
}

export function selectTab(state: TabsState, id: string): TabsState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, active: id } : state;
}

/** ⌃Tab and ⌃⇧Tab, wrapping at either end. */
export function stepTab(state: TabsState, delta: number): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === state.active);
  const next = (index + delta + state.tabs.length) % state.tabs.length;
  return { ...state, active: state.tabs[next].id };
}

/** Records where the active tab navigated; unchanged state when it already shows that view. */
export function updateActive(
  state: TabsState,
  route: string,
  search: Record<string, string>,
): TabsState {
  const current = activeTab(state);
  if (current.route === route && JSON.stringify(current.search) === JSON.stringify(search))
    return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === current.id ? { ...tab, route, search } : tab)),
  };
}

/** Saved tabs, keeping only routes that still exist; a single tab on `fallback` otherwise. */
export function parseTabs(
  value: unknown,
  isRoute: (route: string) => boolean,
  fallback: Tab,
): TabsState {
  const saved = value as { tabs?: unknown; active?: unknown } | null;
  const tabs = Array.isArray(saved?.tabs)
    ? saved.tabs
        .filter(
          (tab): tab is Tab =>
            typeof tab === "object" &&
            tab !== null &&
            typeof (tab as Tab).id === "string" &&
            typeof (tab as Tab).route === "string" &&
            isRoute((tab as Tab).route),
        )
        .map((tab) => ({
          id: tab.id,
          route: tab.route,
          search: cleanSearch(tab.search),
        }))
        .slice(0, MAX_TABS)
    : [];
  if (!tabs.length) return { tabs: [fallback], active: fallback.id };
  const active = tabs.some((tab) => tab.id === saved?.active)
    ? (saved!.active as string)
    : tabs[0].id;
  return { tabs, active };
}
