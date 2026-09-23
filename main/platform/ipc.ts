// Electron wiring for the bridge protocol (shared/bridge-protocol.ts, electron/preload.ts):
// invoke passthrough, handleStream + cancel (via StreamRegistry), notification broadcast, and the
// nativeTheme/systemPreferences handlers the preload's bridge expects.

import {
  BrowserWindow,
  ipcMain as electronIpcMain,
  nativeTheme,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import {
  BridgeChannel,
  type MediaAccessType,
  type NativeThemeInfo,
  type StreamStartRequest,
  type ThemeSource,
} from "../../shared/bridge-protocol.js";
import { systemPreferences } from "./system-preferences.js";
import { StreamRegistry, type StreamHandler } from "./stream-registry.js";
import { isAllowedWindowNavigation } from "./window-policy.js";
import { saveNativeTheme } from "./native-theme.js";
import { requiresLicenseAccess } from "../../shared/license-policy.js";
import { runAppOperation } from "../services/runtime-activity.js";

const registry = new StreamRegistry();
let bridgeRegistered = false;
const trustedWindows = new Map<number, { contents: WebContents; entryUrl: string }>();
let licenseAccess: () => Promise<void> = async () => {
  throw new Error("License status is not ready. Try again shortly.");
};

export function setLicenseAccessGuard(guard: () => Promise<void>): void {
  licenseAccess = guard;
}

export function registerTrustedWindow(contents: WebContents, entryUrl: string): void {
  trustedWindows.set(contents.id, { contents, entryUrl });
  contents.once("destroyed", () => {
    trustedWindows.delete(contents.id);
    registry.disposeSender(contents.id);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const trusted = trustedWindows.get(event.sender.id);
  if (
    !trusted ||
    trusted.contents !== event.sender ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !BrowserWindow.fromWebContents(event.sender) ||
    !isAllowedWindowNavigation(event.senderFrame.url, trusted.entryUrl) ||
    !isAllowedWindowNavigation(event.sender.getURL(), trusted.entryUrl)
  ) {
    throw new Error("Untrusted DayBoard IPC sender");
  }
}

function getNativeThemeInfo(): NativeThemeInfo {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource as ThemeSource,
    accentColor: systemPreferences.getAccentColor(),
  };
}

/** Registers the bridge's own channels once. Idempotent so it is safe to call from index.ts. */
export function registerBridgeIpc(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;

  electronIpcMain.handle(BridgeChannel.streamStart, async (event, request: StreamStartRequest) => {
    assertTrustedSender(event);
    if (
      !request ||
      typeof request.id !== "string" ||
      !request.id ||
      typeof request.channel !== "string" ||
      !request.channel ||
      request.channel.startsWith("dayboard:")
    )
      throw new Error("Invalid stream request");
    return runAppOperation(async () => {
      if (requiresLicenseAccess(request.channel)) await licenseAccess();
      return registry.start(request, event.sender.id, (chunk) => {
        if (
          !event.sender.isDestroyed() &&
          isAllowedWindowNavigation(
            event.sender.getURL(),
            trustedWindows.get(event.sender.id)?.entryUrl ?? "",
          )
        ) {
          event.sender.send(BridgeChannel.streamChunk, {
            id: request.id,
            chunk,
          });
        }
      });
    });
  });
  electronIpcMain.on(BridgeChannel.streamCancel, (event, id: string) => {
    try {
      assertTrustedSender(event);
    } catch {
      return;
    }
    if (typeof id !== "string") return;
    registry.cancel(event.sender.id, id);
  });

  ipcMain.handle(BridgeChannel.nativeThemeGetInfo, () => getNativeThemeInfo());
  ipcMain.handle(BridgeChannel.nativeThemeSetSource, async (_event, source: ThemeSource) => {
    if (source !== "system" && source !== "light" && source !== "dark")
      throw new Error("Invalid theme source");
    await saveNativeTheme(source);
    return true;
  });
  ipcMain.handle(BridgeChannel.getAccentColor, () => systemPreferences.getAccentColor());
  ipcMain.handle(BridgeChannel.getMediaAccessStatus, (_event, mediaType: MediaAccessType) => {
    if (mediaType !== "microphone" && mediaType !== "camera" && mediaType !== "screen")
      throw new Error("Invalid media access type");
    return systemPreferences.getMediaAccessStatus(mediaType);
  });
  ipcMain.handle(BridgeChannel.askForMediaAccess, (_event, mediaType: "microphone" | "camera") => {
    if (mediaType !== "microphone" && mediaType !== "camera")
      throw new Error("Invalid media access type");
    return systemPreferences.askForMediaAccess(mediaType);
  });
}

export const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]): void {
    electronIpcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event);
      const operation = async () => {
        if (requiresLicenseAccess(channel)) await licenseAccess();
        return listener(event, ...args);
      };
      // Updater control/status must remain callable while the app is frozen for installation.
      return channel.startsWith("updates:") || channel === "window:closeSettings"
        ? operation()
        : runAppOperation(operation);
    });
  },
  handleStream<TPayload = unknown, TChunk = unknown, TResult = unknown>(
    channel: string,
    handler: StreamHandler<TPayload, TChunk, TResult>,
  ): void {
    registry.registerHandler(channel, handler);
  },
  broadcast(channel: string, params: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      const trusted = trustedWindows.get(window.webContents.id);
      if (
        !window.isDestroyed() &&
        trusted &&
        isAllowedWindowNavigation(window.webContents.getURL(), trusted.entryUrl)
      ) {
        window.webContents.send(BridgeChannel.notification, {
          channel,
          params,
        });
      }
    }
  },
};
