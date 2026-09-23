// systemPreferences surface the app relies on: the bridge handlers (accent color, media access)
// plus the `openPrivacySettings("reminders")` helper apple-reminders.ts calls directly.

import { shell, systemPreferences as electronSystemPreferences } from "electron";

import type { MediaAccessStatus, MediaAccessType } from "../../shared/bridge-protocol.js";

const PRIVACY_PANES: Record<string, string> = {
  reminders: "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders",
};

export const systemPreferences = {
  getAccentColor(): string {
    const raw = electronSystemPreferences.getAccentColor?.() ?? "0000ffff";
    return `#${raw.slice(0, 6)}`;
  },
  getMediaAccessStatus(mediaType: MediaAccessType): MediaAccessStatus {
    if (mediaType === "screen") return "unknown";
    const status = electronSystemPreferences.getMediaAccessStatus(mediaType);
    return status as MediaAccessStatus;
  },
  async askForMediaAccess(mediaType: "microphone" | "camera"): Promise<boolean> {
    return electronSystemPreferences.askForMediaAccess(mediaType);
  },
  async openPrivacySettings(pane: string): Promise<void> {
    const url = PRIVACY_PANES[pane];
    if (!url) throw new Error(`Unknown privacy pane "${pane}".`);
    await shell.openExternal(url);
  },
};
