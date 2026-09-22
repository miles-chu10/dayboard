import { app } from "@glaze/core/backend";

export interface StartAtLoginState {
  openAtLogin: boolean;
  status?: "not-registered" | "enabled" | "requires-approval" | "not-found";
}

function toState(): StartAtLoginState {
  const settings = app.getLoginItemSettings();
  return {
    openAtLogin: settings.openAtLogin,
    status: settings.status,
  };
}

/** Reads the current OS login-item state instead of a dashboard preference. */
export function getStartAtLogin(): StartAtLoginState {
  return toState();
}

/** Changes the OS login item and returns its readback state. */
export function setStartAtLogin(openAtLogin: boolean): StartAtLoginState {
  app.setLoginItemSettings({ openAtLogin });
  return toState();
}
