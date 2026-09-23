export const SETTINGS_TABS = ["general", "sources", "ai", "mcp", "license", "updates"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && SETTINGS_TABS.includes(value as SettingsTab);
}
