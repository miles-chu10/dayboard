# main/platform

Electron implementation of the small, Glaze-compatible surface the backend was written against.
Business logic in `main/handlers` and `main/services` imports from here instead of
`@glaze/core/backend`, so the port changes import paths, not behavior. Re-implemented from the
API shapes the app uses; no Glaze SDK source is copied.

Status: implemented (`index.ts` + modules below). Callers switch their import specifier from
`@glaze/core/backend` / `@glaze/core/oauth` to a relative path into this directory; named exports
match 1:1. See `HANDOFF.md` for what still needs rewiring outside this directory.

- `ipc.ts` — `ipcMain.handle/handleStream/broadcast`, the bridge's stream start/cancel protocol
  (via `stream-registry.ts`), and the `nativeTheme`/`systemPreferences` bridge handlers.
- `stream-registry.ts` — pure stream bookkeeping, unit-tested directly.
- `safe-storage.ts` — async wrapper over Electron's `safeStorage`.
- `oauth.ts` + `oauth-store.ts` — `OAuthService`; refresh/expiry logic is pure and
  unit-tested, the safeStorage-backed token store loads lazily so tests never touch Electron.
- `reminders.ts` + `reminders-codec.ts` — spawns `native/reminders-helper`; the line-delimited
  JSON wire format is pure and unit-tested.
- `logger.ts` — JSON-lines file logger under `app.getPath("logs")`, mirrored to console.
- `user-data.ts` — applies `DAYBOARD_USER_DATA` / `DAYBOARD_DEMO=1` before `app` is used.
- `system-preferences.ts` — accent color, media access, reminders privacy pane.
- `fs-atomic.ts` — local copy of the atomic-write helpers (kept self-contained; see
  `main/services/file-store.ts` for the other owner's equivalent).

## Intended surface

| Export                                                                      | Shape the app relies on                                                                                                                        | Electron mapping                                                                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                                                                       | `getPath(name)`, `on(event)`, `whenReady()`, `quit()`, `getLoginItemSettings()`, `setLoginItemSettings({ openAtLogin })`                       | `electron.app` (login items: `app.setLoginItemSettings`; macOS 13+ uses SMAppService under the hood)                                                                   |
| `ipcMain.handle(channel, (event, ...args) => result)`                       | request/response handlers                                                                                                                      | `electron.ipcMain.handle`                                                                                                                                              |
| `ipcMain.handleStream(channel, (payload, sendChunk, { signal }) => result)` | streamed handlers (`ai:run`, `ai:assistant`)                                                                                                   | bridge protocol below                                                                                                                                                  |
| `ipcMain.broadcast(channel, params)`                                        | push one params value to every window                                                                                                          | `webContents.send("dayboard:notification", { channel, params })` for every live `BrowserWindow`                                                                        |
| `safeStorage`                                                               | **async** `encryptString(text): Promise<Buffer>`, `decryptString(buf): Promise<string>`                                                        | wraps sync `electron.safeStorage` (Keychain-backed); throw if `isEncryptionAvailable()` is false                                                                       |
| `shell`                                                                     | `openExternal(url)` (http/https/mailto only)                                                                                                   | `electron.shell`                                                                                                                                                       |
| `dialog`                                                                    | `showOpenDialog`, `showMessageBox`                                                                                                             | `electron.dialog`                                                                                                                                                      |
| `clipboard`                                                                 | `writeText`                                                                                                                                    | `electron.clipboard`                                                                                                                                                   |
| `nativeImage`                                                               | `createFromPath`                                                                                                                               | `electron.nativeImage`                                                                                                                                                 |
| `systemPreferences`                                                         | `openPrivacySettings("reminders")` plus the renderer bridge calls below                                                                        | `shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders")`                                                                      |
| `logger`                                                                    | `debug/info/warn/error(scope, message, data?)`                                                                                                 | JSON lines under `app.getPath("logs")`; never log secrets or tokens                                                                                                    |
| `reminders`                                                                 | `status()`, `requestAccess()`, `getCalendars()`, `getReminders()`, `getReminder()`, `createReminder()`, `updateReminder()`, `deleteReminder()` | bundled Swift EventKit helper (`resources/bin/dayboard-reminders`, JSON over stdio), shipped via electron-builder `extraResources` to `Contents/Resources/bin`         |
| `BrowserWindow` helpers                                                     | create main/settings windows with the secure `webPreferences` below                                                                            | `electron.BrowserWindow`                                                                                                                                               |
| `Menu`                                                                      | `buildFromTemplate`, `setApplicationMenu`                                                                                                      | `electron.Menu`                                                                                                                                                        |
| `OAuthService` (replaces `@glaze/core/oauth`)                               | `new OAuthService(config)`, `setTokens`, `getTokens`, `authorize()` (returns a fresh access token, refreshing when expired), `removeTokens`    | token store encrypted with `safeStorage` under `userData`; refresh via the provider token endpoint; sign-in itself stays in `google-loopback-oauth.ts` (PKCE loopback) |

## Bridge protocol (must match `electron/preload.ts`)

Channel names and payload types live in `shared/bridge-protocol.ts`; import them rather than
repeating strings.

- **invoke**: renderer calls `ipcRenderer.invoke(channel, ...args)`; register with `ipcMain.handle`.
  Throw `Error`s with user-readable messages; the preload strips Electron's
  `Error invoking remote method` prefix.
- **stream**: renderer invokes `dayboard:stream:start` with `{ id, channel, args }`. Look up the
  `handleStream` handler for `channel`, run it with an `AbortSignal`, send each chunk as
  `event.sender.send("dayboard:stream:chunk", { id, chunk })`, and resolve the invoke with the
  handler's final result (reject on error). Key running streams by `(event.sender.id, id)`.
- **cancel**: renderer sends `dayboard:stream:cancel` with the stream id; abort that stream's
  signal. A cancel can arrive before the start is processed, so remember recently cancelled ids
  briefly. Abort all of a sender's streams when its `webContents` is destroyed.
- **notifications**: `ipcMain.broadcast(channel, params)` sends
  `dayboard:notification` `{ channel, params }` to every live window.
- **theme / preferences**: handle `nativeTheme:getInfo` (returns `NativeThemeInfo`),
  `nativeTheme:setThemeSource`, `systemPreferences:getAccentColor` (`#rrggbb`),
  `systemPreferences:getMediaAccessStatus`, `systemPreferences:askForMediaAccess`.
- Channels starting with `dayboard:` are reserved for the bridge; the preload refuses to `invoke`
  them directly.

## Window security defaults

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload
`out/preload/index.cjs`, deny `window.open` and off-origin navigation (open http(s) links with
`shell.openExternal`). Load `process.env.ELECTRON_RENDERER_URL + "/main-window.html"` in dev and
`out/renderer/main-window.html` (`settings-window.html`) when packaged.
