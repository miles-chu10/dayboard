// Wire protocol between electron/preload.ts and main/platform. Imported by both sides.

/** Channels reserved for the bridge itself; renderer `invoke` refuses them. */
export const BRIDGE_PREFIX = "dayboard:";

export const BridgeChannel = {
  /** invoke: StreamStartRequest → final result. Chunks arrive on streamChunk meanwhile. */
  streamStart: "dayboard:stream:start",
  /** main → renderer: StreamChunkMessage */
  streamChunk: "dayboard:stream:chunk",
  /** renderer → main (send): stream id to abort */
  streamCancel: "dayboard:stream:cancel",
  /** main → renderer: NotificationMessage (ipcMain.broadcast) */
  notification: "dayboard:notification",
  nativeThemeGetInfo: "nativeTheme:getInfo",
  nativeThemeSetSource: "nativeTheme:setThemeSource",
  getAccentColor: "systemPreferences:getAccentColor",
  getMediaAccessStatus: "systemPreferences:getMediaAccessStatus",
  askForMediaAccess: "systemPreferences:askForMediaAccess",
} as const;

export type ThemeSource = "system" | "light" | "dark";

export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: ThemeSource;
  accentColor?: string;
}

export type MediaAccessType = "microphone" | "camera" | "screen";
export type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export interface StreamStartRequest {
  id: string;
  channel: string;
  args: unknown;
}

export interface StreamChunkMessage {
  id: string;
  chunk: unknown;
}

export interface NotificationMessage {
  channel: string;
  params: unknown;
}

export type Unsubscribe = () => void;

/** Shape of `window.dayboard`, exposed by electron/preload.ts. */
export interface DayboardBridge {
  ipc: {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    /** Resolves with the handler's final result; `onChunk` receives each streamed chunk first. */
    stream<TChunk = unknown, TResult = unknown>(
      channel: string,
      args: unknown,
      onChunk: (chunk: TChunk) => void,
      options?: { cancellationId?: string },
    ): Promise<TResult>;
    cancelStream(cancellationId: string): void;
    onNotification(channel: string, callback: (params: unknown) => void): Unsubscribe;
  };
  nativeTheme: {
    getInfo(): Promise<NativeThemeInfo>;
    setThemeSource(source: ThemeSource): Promise<boolean>;
  };
  systemPreferences: {
    getAccentColor(): Promise<string>;
    getMediaAccessStatus(mediaType: MediaAccessType): Promise<MediaAccessStatus>;
    askForMediaAccess(mediaType: "microphone" | "camera"): Promise<boolean>;
  };
  platform: string;
}
