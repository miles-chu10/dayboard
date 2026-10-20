import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { app, BrowserWindow, ipcMain, logger } from "@glaze/core/backend";

import { getPreloadPath, getWindowUrl } from "./window-paths.js";

// The backend is bundled into build/main/index.js, so this resolves to build/main.
const mainWindowDirPath = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export async function createMainWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    logger.debug("main", "Main window already exists, skipping creation");
    return mainWindow;
  }

  // Read display name from package.json (in production it sits at ../../package.json)
  const packageJsonPath = path.join(mainWindowDirPath, "..", "..", "package.json");

  let windowTitle = "Glaze App";
  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf-8"));
      windowTitle = packageJson.productName || packageJson.appConfig?.displayName || windowTitle;
    }
  } catch {
    // Use defaults
  }

  const browserWindowStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] Creating BrowserWindow", {
    timestamp: new Date().toISOString(),
  });

  const window = new BrowserWindow({
    windowKey: "main", // Stable key for frame persistence
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: windowTitle,
    show: false, // Don't show until WebView is ready (prevents flickering)
    webPreferences: {
      preload: getPreloadPath(),
    },
  });
  mainWindow = window;

  logger.info("main", "⏱️ [COLD_START] BrowserWindow constructor completed", {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - browserWindowStartTime,
  });

  // Wait for ready-to-show event before showing window (prevents flickering)
  window.once("ready-to-show", () => {
    const showStartTime = Date.now();
    logger.info("main", "⏱️ [COLD_START] ready-to-show event received, showing window", {
      timestamp: new Date().toISOString(),
    });
    window.show();
    logger.info("main", "⏱️ [COLD_START] Window shown", {
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - showStartTime,
    });
  });

  // Determine URL to load (dev server preferred, fallback to build files)
  const url = await getWindowUrl("main-window.html");
  logger.info("main", "Resolved main window URL", { url });

  const loadURLStartTime = Date.now();
  logger.info("main", "⏱️ [COLD_START] Loading URL in window", {
    timestamp: new Date().toISOString(),
    url,
  });
  await window.loadURL(url);
  logger.info("main", "⏱️ [COLD_START] URL loaded in window (waiting for ready-to-show)", {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - loadURLStartTime,
  });
  return window;
}

const MAIN_ROUTES = ["/", "/tasks", "/reminders", "/calendar", "/mail", "/assistant", "/review"];
export type MainRoute =
  | "/"
  | "/tasks"
  | "/reminders"
  | "/calendar"
  | "/mail"
  | "/assistant"
  | "/review";
export interface MainNavigation {
  to: MainRoute;
  prompt?: string;
}

export function isMainRoute(value: unknown): value is MainRoute {
  return typeof value === "string" && MAIN_ROUTES.includes(value);
}

let pendingNavigation: MainNavigation | null = null;

/** A main window opened for a navigation reads it once its renderer is ready. */
export function takePendingNavigation(): MainNavigation | null {
  const navigation = pendingNavigation;
  pendingNavigation = null;
  return navigation;
}

/** Brings the dashboard forward from a panel or notification, optionally at a view. */
export async function focusMainWindow(navigation?: MainNavigation): Promise<void> {
  const existing = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (navigation && !existing) pendingNavigation = navigation;
  const window = existing ?? (await createMainWindow());
  if (window.isMinimized()) window.restore();
  app.focus({ steal: true });
  window.show();
  window.focus();
  if (navigation && existing) ipcMain.broadcast("app:navigate", navigation);
}
