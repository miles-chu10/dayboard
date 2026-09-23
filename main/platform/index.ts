// Electron implementation of the small, Glaze-compatible surface main/handlers and main/services
// were written against (see README.md's "Intended surface" table). Business logic imports from
// here instead of `@glaze/core/backend` / `@glaze/core/oauth` — the port changes import paths,
// not behavior. Re-implemented from the API shapes the app uses; no Glaze SDK source is copied.

import {
  app as electronApp,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";

import { configureUserData } from "./user-data.js";
import { registerBridgeIpc, ipcMain } from "./ipc.js";

// Must run before anything calls app.getPath("userData") — including the safeStorage-backed
// stores below, which only resolve their paths lazily on first use.
configureUserData();
registerBridgeIpc();

export const app = electronApp;
export { ipcMain };
export { BrowserWindow, Menu, clipboard, dialog, nativeImage, nativeTheme, shell };
export { safeStorage } from "./safe-storage.js";
export { systemPreferences } from "./system-preferences.js";
export { logger } from "./logger.js";
export { reminders } from "./reminders.js";
export { OAuthService, OAuthTokenStateChangedError } from "./oauth.js";
export type { OAuthTokens, OAuthTokensInput } from "./oauth.js";
