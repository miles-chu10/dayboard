// Starts Quick Capture's hotkey and the panel IPC. Electron-specific wiring only; the logic
// lives in hotkey.ts, panel-window.ts and the shared modules they use.

import { globalShortcut, type WebContents } from "electron";

import { ipcMain, logger } from "../platform/index.js";
import { getSettings, onSettingsChanged } from "../services/settings-store.js";
import { focusMainWindow, isMainRoute, takePendingNavigation } from "../window.js";
import { createHotkeyManager, type HotkeyStatus } from "./hotkey.js";
import { hidePanel, isPanelSurface, resizePanel, showPanel, togglePanel } from "./panel-window.js";
import { readSymbolicHotkeys } from "./symbolic-hotkeys.js";

declare const __DAYBOARD_TEST_BUILD__: boolean;

const MAX_PROMPT = 4_000;

/** Automated test builds never grab a system-wide shortcut or add a menu-bar icon. */
export function nativeIntegrationsEnabled(): boolean {
  const testBuild = typeof __DAYBOARD_TEST_BUILD__ !== "undefined" && __DAYBOARD_TEST_BUILD__;
  return !testBuild && process.env.DAYBOARD_TEST !== "1";
}

function payload(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${channel}: expected an object`);
  return value as Record<string, unknown>;
}

function surface(value: unknown, channel: string) {
  const input = payload(value, channel);
  if (!isPanelSurface(input.surface)) throw new Error(`${channel}: unknown panel`);
  return { input, surface: input.surface };
}

let started = false;

export function startSystemPanels(): void {
  if (started) return;
  started = true;

  const hotkey = createHotkeyManager({
    nativeEnabled: nativeIntegrationsEnabled(),
    globalShortcut,
    readSymbolicHotkeys,
    onTrigger: () => void togglePanel("capture"),
    onStatus: (status: HotkeyStatus) => ipcMain.broadcast("system:hotkeyStatus", status),
  });

  void getSettings()
    .then((settings) => hotkey.apply(settings.system.quickCapture))
    .catch((error) => logger.warn("panels", "Could not apply the Quick Capture shortcut", error));
  onSettingsChanged((next, previous) => {
    if (JSON.stringify(next.system.quickCapture) !== JSON.stringify(previous.system.quickCapture))
      void hotkey.apply(next.system.quickCapture);
  });

  ipcMain.handle("panel:hide", (_event, value: unknown) => {
    hidePanel(surface(value, "panel:hide").surface);
  });
  ipcMain.handle("panel:show", async (_event, value: unknown) => {
    await showPanel(surface(value, "panel:show").surface);
  });
  ipcMain.handle("panel:resize", (_event, value: unknown) => {
    const { input, surface: target } = surface(value, "panel:resize");
    if (typeof input.height !== "number" || !Number.isFinite(input.height))
      throw new Error("panel:resize: height must be a number");
    resizePanel(target, input.height);
  });
  ipcMain.handle("panel:openMain", async (_event, value: unknown) => {
    const input = payload(value ?? {}, "panel:openMain");
    const route = input.route ?? "/";
    if (!isMainRoute(route)) throw new Error("panel:openMain: unknown view");
    if (input.prompt !== undefined && (typeof input.prompt !== "string" || !input.prompt.trim()))
      throw new Error("panel:openMain: prompt must be text");
    const prompt = typeof input.prompt === "string" ? input.prompt.slice(0, MAX_PROMPT) : undefined;
    hidePanel("capture");
    hidePanel("menubar");
    await focusMainWindow({ to: route, prompt });
  });
  ipcMain.handle("app:takeNavigation", () => takePendingNavigation());

  ipcMain.handle("system:hotkeyStatus", () => hotkey.status());
  const suspendedBy = new Set<WebContents>();
  ipcMain.handle("system:suspendHotkey", async (event, value: unknown) => {
    const input = payload(value, "system:suspendHotkey");
    if (typeof input.suspended !== "boolean")
      throw new Error("system:suspendHotkey: suspended must be true or false");
    const sender = event.sender;
    if (input.suspended && !suspendedBy.has(sender)) {
      suspendedBy.add(sender);
      // A closed Settings window must never leave the shortcut switched off.
      sender.once("destroyed", () => {
        suspendedBy.delete(sender);
        if (!suspendedBy.size) void hotkey.suspend(false);
      });
    } else if (!input.suspended) suspendedBy.delete(sender);
    return hotkey.suspend(suspendedBy.size > 0);
  });
}

export function stopSystemPanels(): void {
  globalShortcut.unregisterAll();
}
