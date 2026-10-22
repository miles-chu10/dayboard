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
  type StreamMessage,
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
let accountGeneration = 0;
interface TrustedWindow {
  contents: WebContents;
  entryUrl: string;
  /** When set, the only app channels this window may invoke or stream. */
  channels?: ReadonlySet<string>;
}

const trustedWindows = new Map<number, TrustedWindow>();
let licenseAccess: () => Promise<void> = async () => {
  throw new Error("License status is not ready. Try again shortly.");
};

export function setLicenseAccessGuard(guard: () => Promise<void>): void {
  licenseAccess = guard;
}

/**
 * The license guard and update admission IPC applies, for actions that start outside IPC, such as
 * a notification's Undo button.
 */
export function runGuardedCommand<T>(channel: string, run: () => Promise<T>): Promise<T> {
  return runAppOperation(async () => {
    if (requiresLicenseAccess(channel)) await licenseAccess();
    return run();
  });
}

export function registerTrustedWindow(
  contents: WebContents,
  entryUrl: string,
  options: { channels?: ReadonlySet<string> } = {},
): void {
  trustedWindows.set(contents.id, { contents, entryUrl, channels: options.channels });
  contents.once("destroyed", () => {
    trustedWindows.delete(contents.id);
    registry.disposeSender(contents.id);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): TrustedWindow {
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
  return trusted;
}

function assertChannelAllowed(trusted: TrustedWindow, channel: string): void {
  if (trusted.channels && !trusted.channels.has(channel))
    throw new Error(`This DayBoard window can't use ${channel}.`);
}

function getNativeThemeInfo(): NativeThemeInfo {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource as ThemeSource,
    accentColor: systemPreferences.getAccentColor(),
    prefersReducedTransparency: Boolean(nativeTheme.prefersReducedTransparency),
    shouldUseHighContrastColors: Boolean(nativeTheme.shouldUseHighContrastColors),
    shouldDifferentiateWithoutColor: Boolean(nativeTheme.shouldDifferentiateWithoutColor),
    prefersReducedMotion: Boolean(systemPreferences.getAnimationSettings?.().prefersReducedMotion),
  };
}

/** Registers the bridge's own channels once. Idempotent so it is safe to call from index.ts. */
export function registerBridgeIpc(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  nativeTheme.on?.("updated", () => {
    ipcMain.broadcast("nativeTheme:updated", getNativeThemeInfo());
  });

  electronIpcMain.handle(BridgeChannel.streamStart, async (event, request: StreamStartRequest) => {
    const trusted = assertTrustedSender(event);
    const id = typeof request?.id === "string" ? request.id : "";
    const emit = (message: StreamMessage) => {
      if (
        !event.sender.isDestroyed() &&
        isAllowedWindowNavigation(
          event.sender.getURL(),
          trustedWindows.get(event.sender.id)?.entryUrl ?? "",
        )
      ) {
        event.sender.send(BridgeChannel.streamChunk, message);
      }
    };
    try {
      // Checks after the sender's own go inside the try, so a refused stream still ends.
      if (
        !id ||
        typeof request.channel !== "string" ||
        !request.channel ||
        request.channel.startsWith("dayboard:")
      )
        throw new Error("Invalid stream request");
      assertChannelAllowed(trusted, request.channel);
      return await runAppOperation(async () => {
        if (requiresLicenseAccess(request.channel)) await licenseAccess();
        return registry.start(request, event.sender.id, (chunk) => emit({ id, chunk }));
      });
    } finally {
      // The invoke reply can reach the renderer before chunks sent ahead of it, so the preload
      // settles the stream on this marker, which follows the last chunk on the same channel.
      if (id) emit({ id, end: true });
    }
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
      assertChannelAllowed(assertTrustedSender(event), channel);
      const submittedAccount = accountGeneration;
      const operation = async () => {
        if (requiresLicenseAccess(channel)) await licenseAccess();
        // Capture's own fence starts inside the listener; cover time spent awaiting admission too.
        if (channel === "capture:submit" && submittedAccount !== accountGeneration)
          throw new Error("Your account changed. Add the item again.");
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
    if (channel === "accounts:changed") accountGeneration += 1;
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
