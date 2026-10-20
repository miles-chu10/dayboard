# Porting the system panels to the Glaze runtime

Quick Capture, the menu-bar mini Agenda and the meeting-aware Up Next card were built for the
standalone Electron app (`main` line). This lists what a Glaze port can reuse as is and what is
Electron-specific. Design: `docs/superpowers/specs/2026-10-20-system-panels-design.md`.

## Reuse as is (no `electron` import)

| Module                                                                                                                                                | What it does                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/accelerator.ts`                                                                                                                               | Shortcut normalising, validation (reserved combos incl. ⌘N), key-event recording, ⌃⌥⇧⌘ display, macOS symbolic-hotkey conflict table |
| `shared/panel-placement.ts`                                                                                                                           | Capture panel and menu-bar panel bounds from a work area and tray bounds                                                             |
| `shared/capture.ts`, `shared/json-extract.ts`, `shared/prompt-context.ts`                                                                             | Capture prompt, lenient (⌘N) and strict (Quick Capture) draft parsing, manual draft validation, available kinds, confirmation text   |
| `shared/meetings.ts`                                                                                                                                  | Join links (Meet/Zoom/Teams/Webex/Whereby), "mine" and "meeting" rules, de-duplication, up next, just ended, next alert, labels      |
| `shared/action-items.ts`                                                                                                                              | Follow-ups from notes: heading heuristic, AI prompt, AI JSON parsing                                                                 |
| `main/services/capture/capture-service.ts`                                                                                                            | Capture pipeline with injected AI, providers and write guard; Undo receipts                                                          |
| `main/services/meetings/meeting-alerts.ts`                                                                                                            | One-timer alert scheduler with injected events, notifier and clock                                                                   |
| `main/services/meeting-notes/*`                                                                                                                       | Granola output parsing, matching, provider fingerprints, selection tokens, per-account notes store                                   |
| `main/system-panels/hotkey.ts`, `panel-channels.ts`                                                                                                   | Hotkey manager (injected `globalShortcut` and plist reader); the panel IPC allow-list                                                |
| `renderer/panel/*`, `renderer/components/meeting-card.tsx`, `meeting-notes.tsx`, `draft-fields.tsx`, `renderer/lib/meeting-prep.ts`, `notes-lines.ts` | React UI and pure renderer helpers                                                                                                   |

## Electron-specific (rewrite against `@glaze/core/backend`)

| Electron piece                                                                                                                       | Where                                                                | Look up in Glaze                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| `globalShortcut.register/unregisterAll`                                                                                              | `main/system-panels/index.ts`                                        | global shortcut API                               |
| `Tray` + template `nativeImage` (1×/2×), `popUpContextMenu`                                                                          | `main/system-panels/tray.ts`, `resources/tray/`                      | tray / status item API                            |
| `BrowserWindow({ type: "panel" })`, `setAlwaysOnTop(true, "floating")`, vibrancy `popover`, blur-to-hide with a 300 ms re-show grace | `main/system-panels/panel-window.ts`                                 | floating panel window, level and vibrancy options |
| `screen.getCursorScreenPoint`, `getDisplayNearestPoint`, `getDisplayMatching`                                                        | `main/system-panels/panel-window.ts`                                 | screen / display API                              |
| `Notification` with action buttons, `show`/`failed`/`action`/`click` events                                                          | `main/system-panels/capture-handlers.ts`, `meeting-notifications.ts` | notifications                                     |
| Per-window IPC allow-list in `registerTrustedWindow(…, { channels })`                                                                | `main/platform/ipc.ts`                                               | Glaze's IPC permission model                      |
| `defaults export com.apple.symbolichotkeys` piped to `plutil`                                                                        | `main/system-panels/symbolic-hotkeys.ts`                             | any child-process API (same commands)             |
| `app.on("activate")` ignoring panels; `will-quit` → `stopSystemPanels()`                                                             | `main/index.ts`                                                      | app lifecycle hooks                               |

## Behaviour to keep

- Panels are created lazily and never in test builds' startup path; test builds register no global
  shortcut and create no tray.
- The capture panel hides immediately on Enter; failures come back to the panel without replacing
  newer text. Undo is single-use, 10 minutes, bound to the account active at submit.
- Notes import never launches MCP servers in the background and never stores an MCP error as notes.

## Glaze port (branch `claude/system-panels-glaze`)

Ported from PR #44 onto `glaze` 1.2.5. The shared modules above were copied unchanged except
where noted here.

| Piece                           | Glaze line                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hotkey                          | `globalShortcut.register` is async in Glaze. `hotkey.ts` awaits it, and a newer change waits for a pending registration so it can release it (`tests/hotkey.test.mjs`).                                                                                |
| Panel window                    | Same `BrowserWindow` options on `@glaze/core/backend` (`type: "panel"`, floating level), plus `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`. Glaze's runtime treats full-screen visibility as a separate request, while Electron's panel type does it on its own. No `windowKey`, so frame persistence stays off. Whether it appears over full-screen apps and on other Spaces still has to be checked by hand.                                                                          |
| Tray                            | SF Symbol `calendar.day.timeline.left` with a fixed GUID instead of template PNGs. `getBounds()` anchors the menu-bar panel.                                                                                                                             |
| Per-window IPC allow-list       | `main/ipc.ts` wraps `ipcMain.handle` and `handleStream` with Glaze's `authorize` option. Panels are identified by registered window id (`panel-registry.ts`) or the `panel-window.html` page URL. All app handlers import `ipcMain` from `main/ipc.ts`. |
| Quick Capture AI                | `runCompletion` (`main/services/ai/completion.ts`) now holds the `ai:run` body. Backend callers pass `allowGlaze` to use `glaze("fast")`; `ai:run` still leaves Glaze AI to the app window. Blocked Glaze states become readable errors.               |
| Main window                     | Creation moved to `main/windows/main-window.ts`, together with `focusMainWindow` and pending navigation.                                                                                                                                                |
| Dropped                         | License guard (`license:status`, `runGuardedCommand`), the `providerChosen` check, `nativeTheme:getInfo` in the panel allow-list, tray PNGs and their build script, and the Playwright e2e spec (no e2e on this line).                                   |

### Lifecycle changes for release-owner review

- `startSystemPanels()` runs in `app.whenReady()` after the menu and the MCP server, before the main
  window is created.
- `app.on("will-quit", stopSystemPanels)` unregisters every global shortcut and destroys the tray.
- `activate` ignores floating panels when deciding whether to bring the dashboard back. It counts
  visible windows itself instead of using the event's `hasVisibleWindows`.
- The tray's Quit calls `app.quit()`, so it goes through the existing `before-quit` save guard.
- `before-quit`, `window-all-closed` (still no quit) and the save guard are unchanged. Glaze applies
  app updates itself, so this repo has no updater quit/install path to preserve on this line.
