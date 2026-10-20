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
