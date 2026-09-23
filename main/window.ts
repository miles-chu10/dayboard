// Window management for the standalone Electron app: single-instance lock, the main and settings
// windows, and the standard macOS app menu. Loads electron-vite's `out/` layout: dev uses
// `ELECTRON_RENDERER_URL` (electron-vite dev server), packaged/built runs load `out/renderer/*`.

import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  Menu,
  shell,
} from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ipcMain, logger } from "./platform/index.js";
import type { SettingsTab } from "../shared/settings-navigation.js";
import { registerTrustedWindow } from "./platform/ipc.js";
import {
  isAllowedWindowNavigation,
  isExternalWebUrl,
  windowEntryUrl,
} from "./platform/window-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built output is out/main/window.js; renderer HTML lives at out/renderer/*.
const RENDERER_ROOT = path.join(__dirname, "..", "renderer");
const PRELOAD_PATH = path.join(__dirname, "..", "preload", "index.cjs");

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

function secureWebPreferences(): BrowserWindowConstructorOptions["webPreferences"] {
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

function hardenWindow(window: BrowserWindow, entryUrl: string): void {
  registerTrustedWindow(window.webContents, entryUrl);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedWindowNavigation(url, entryUrl)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  });
}

function entryUrl(htmlFileName: string): string {
  return windowEntryUrl(htmlFileName, RENDERER_ROOT, process.env.ELECTRON_RENDERER_URL);
}

export async function createMainWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    return mainWindow;
  }

  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "DayBoard",
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: "sidebar",
    webPreferences: secureWebPreferences(),
  });
  mainWindow = window;
  const url = entryUrl("main-window.html");
  hardenWindow(window, url);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  await window.loadURL(url);
  return window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export async function openSettingsWindow(tab?: SettingsTab): Promise<BrowserWindow> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (tab) ipcMain.broadcast("settings:selectTab", { tab });
    settingsWindow.show();
    return settingsWindow;
  }

  const window = new BrowserWindow({
    width: 660,
    height: 740,
    minWidth: 460,
    minHeight: 420,
    title: "Settings",
    show: false,
    center: true,
    webPreferences: secureWebPreferences(),
  });
  settingsWindow = window;
  const url = entryUrl("settings-window.html");
  hardenWindow(window, url);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (settingsWindow === window) settingsWindow = null;
  });

  await window.loadURL(tab ? `${url}#${tab}` : url);
  return window;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}

export function setupApplicationMenu(options: { checkForUpdates: () => Promise<unknown> }): void {
  const menu = Menu.buildFromTemplate([
    {
      label: "DayBoard",
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          id: "check-updates",
          click: () => {
            void openSettingsWindow("updates")
              .then(() => options.checkForUpdates())
              .catch((error) => logger.warn("updates", "Could not open updates", error));
          },
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "Command+,",
          click: () => void openSettingsWindow(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open Source Licenses…",
          click: () => {
            const file = app.isPackaged
              ? path.join(process.resourcesPath, "third-party-notices.txt")
              : path.join(app.getAppPath(), "out", "third-party-notices.txt");
            void shell
              .openPath(file)
              .then((error) => {
                if (error)
                  dialog.showErrorBox(
                    "Could not open licenses",
                    "The bundled license file could not be opened.",
                  );
              })
              .catch((error) => logger.warn("licenses", "Could not open licenses", error));
          },
        },
        {
          label: "DayBoard on GitHub",
          click: () => void shell.openExternal("https://github.com/miles-chu10/dayboard"),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

/**
 * Acquires the macOS single-instance lock. Returns false (and quits the app) when another
 * instance already holds it; the caller should stop its startup sequence in that case.
 */
export function acquireSingleInstanceLock(): boolean {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    logger.info("window", "Another DayBoard instance is already running; quitting.");
    app.quit();
    return false;
  }
  app.on("second-instance", () => {
    const window = mainWindow;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else {
      void createMainWindow();
    }
  });
  return true;
}
