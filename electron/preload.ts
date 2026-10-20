import { contextBridge, ipcRenderer } from "electron";
import {
  BRIDGE_PREFIX,
  BridgeChannel,
  type DayboardBridge,
  type NotificationMessage,
  type StreamMessage,
} from "../shared/bridge-protocol";
import { createStreamClient } from "../shared/stream-client";

// Electron prefixes rejected invokes with "Error invoking remote method '<channel>': Error: ".
// Strip it so the renderer shows the handler's own message.
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(REMOTE_ERROR_PREFIX, ""));
  }
}

function assertAppChannel(channel: string): void {
  if (typeof channel !== "string" || !channel || channel.startsWith(BRIDGE_PREFIX))
    throw new Error(`Invalid IPC channel: ${String(channel)}`);
}

let streamSeq = 0;
const streams = createStreamClient();
ipcRenderer.on(BridgeChannel.streamChunk, (_event, message: StreamMessage) => {
  streams.receive(message);
});

const notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
ipcRenderer.on(BridgeChannel.notification, (_event, message: NotificationMessage) => {
  for (const callback of notificationHandlers.get(message.channel) ?? []) {
    try {
      callback(message.params);
    } catch (error) {
      console.error(`[dayboard] notification handler for ${message.channel} failed`, error);
    }
  }
});

const bridge: DayboardBridge = {
  ipc: {
    invoke(channel, ...args) {
      assertAppChannel(channel);
      return invoke(channel, ...args);
    },
    async stream<TChunk, TResult>(
      channel: string,
      args: unknown,
      onChunk: (chunk: TChunk) => void,
      options?: { cancellationId?: string },
    ) {
      assertAppChannel(channel);
      const id = options?.cancellationId ?? `stream-${++streamSeq}`;
      // Main rejects an empty ID before it can send an end marker, so refuse it here, not wait.
      if (typeof id !== "string" || !id) throw new Error("Invalid stream ID");
      return streams.run(id, onChunk as (chunk: unknown) => void, () =>
        invoke<TResult>(BridgeChannel.streamStart, { id, channel, args }),
      );
    },
    cancelStream(cancellationId) {
      ipcRenderer.send(BridgeChannel.streamCancel, cancellationId);
    },
    onNotification(channel, callback) {
      const callbacks = notificationHandlers.get(channel) ?? new Set();
      notificationHandlers.set(channel, callbacks);
      // Wrap so subscribing the same function twice yields two independent subscriptions.
      const handler = (params: unknown) => callback(params);
      callbacks.add(handler);
      return () => {
        callbacks.delete(handler);
        if (callbacks.size === 0 && notificationHandlers.get(channel) === callbacks)
          notificationHandlers.delete(channel);
      };
    },
  },
  nativeTheme: {
    getInfo: () => invoke(BridgeChannel.nativeThemeGetInfo),
    setThemeSource: (source) => invoke(BridgeChannel.nativeThemeSetSource, source),
  },
  systemPreferences: {
    getAccentColor: () => invoke(BridgeChannel.getAccentColor),
    getMediaAccessStatus: (mediaType) => invoke(BridgeChannel.getMediaAccessStatus, mediaType),
    askForMediaAccess: (mediaType) => invoke(BridgeChannel.askForMediaAccess, mediaType),
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld("dayboard", bridge);
