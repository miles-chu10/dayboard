import { toast } from "@renderer/ui";

export function invoke<T = void>(channel: string, ...args: unknown[]): Promise<T> {
  return window.dayboard.ipc.invoke<T>(channel, ...args);
}

/** Opens an https link in the browser, or says why it can't (demo mode, a non-https link). */
export function openExternal(url: string): Promise<void> {
  return invoke("app:openExternal", { url }).catch((error: unknown) => {
    const reason = errorMessage(error).replace(/^app:openExternal:\s*/, "");
    toast.error("Couldn’t open the link", {
      description: reason.charAt(0).toUpperCase() + reason.slice(1),
    });
  });
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
