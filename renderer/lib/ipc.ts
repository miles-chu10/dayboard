export function invoke<T = void>(channel: string, ...args: unknown[]): Promise<T> {
  return window.dayboard.ipc.invoke<T>(channel, ...args);
}

export function openExternal(url: string): Promise<void> {
  return invoke("app:openExternal", { url });
}

export function openSettings(
  tab?: import("@shared/settings-navigation").SettingsTab,
): Promise<void> {
  return tab ? invoke("window:openSettings", { tab }) : invoke("window:openSettings");
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
}
