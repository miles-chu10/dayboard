# System Panels Implementation Plan (ExecPlan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep `Progress`, `Surprises & Discoveries` and `Decision Log` current as you go; this file must let a fresh agent resume from it alone.

**Goal:** Add a global-hotkey Quick Capture panel, a menu-bar mini Agenda, and a meeting-aware Up Next card with optional notifications and Granola notes import to DayBoard's standalone Electron app, each switchable in Settings.

**Architecture:** One shared panel layer (NSPanel-type `BrowserWindow`s created lazily, one renderer entry with two surfaces, a per-window IPC allow-list enforced in `main/platform/ipc.ts`, a `system` settings section, and a hotkey manager) carries all three features. Business logic lives in Electron-free modules under `shared/` and `main/services/` so the Glaze port reuses it; Electron-specific code is confined to `main/system-panels/`. Quick Capture submits to a main-process pipeline that parses with the existing AI runner, creates through the existing services, and confirms afterwards with Undo.

**Tech Stack:** Electron 44.4.4, electron-vite 5, React 19, TanStack Query/Router, Tailwind 4, TypeScript strict ESM, Node test runner + esbuild bundling (`tests/*.test.mjs`), tsx (`renderer/lib/*.test.ts`), Playwright Electron (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-20-system-panels-design.md` (read it first; this plan argues from it).

## Purpose / Big Picture

After this change Miles can press ⌃⌥Space over any app, including a full-screen one, type "Call dentist Thursday 3pm", press Enter and be back in his app immediately; a macOS notification then says where the item landed, with Undo. A menu-bar icon shows today's items, the next meeting with a Join button and prep, recent captures, and a capture box. Before a meeting he can be notified; after it, if a Granola MCP server is configured, DayBoard pulls the meeting's notes and offers its action items as one-click Tasks or Reminders. Every piece can be switched off in Settings → General.

## Progress

- [ ] Task 1: Baseline, plan files and TASKS.md
- [ ] Task 2: Per-window IPC allow-list
- [ ] Task 3: Accelerator utilities and macOS shortcut conflict mapping
- [ ] Task 4: `system` settings section and in-process settings events
- [ ] Task 5: Panel placement
- [ ] Task 6: Panel window layer, hotkey manager, menu items and Settings UI
- [ ] Task 7: Shared capture logic and AI completion runner
- [ ] Task 8: Capture pipeline in main with Undo
- [ ] Task 9: Quick Capture panel UI
- [ ] Task 10: Menu-bar icon and menu-bar panel
- [ ] Task 11: Meeting logic and calendar fields
- [ ] Task 12: Up Next card and Meetings settings
- [ ] Task 13: Meeting notifications
- [ ] Task 14: Granola notes import and follow-ups
- [ ] Task 15: Porting doc, fuse proposal, handoff
- [ ] Task 16: Full verification, packaged build, manual acceptance, REA check

## Surprises & Discoveries

- 2026-10-20 probe (Electron 44.4.4, see spec "Probe results"): `type: "panel"` + `setAlwaysOnTop(true, "floating")` shows over full-screen apps without activating DayBoard; `show()` gives it keyboard focus; hiding returns the keyboard to the previous app. `globalShortcut.register` returns `true` even for ⌘Space. Notifications fail in the unsigned dev binary (`UNErrorDomain error 1`). `localStorage` is shared across `file://` entries.
- Granola output (one approved sample, structure only): `<meeting id title meeting_at url …>` elements with XML-escaped attributes; `get_meetings` adds a Markdown `<summary>`; action items are `- **Item**` bullets under a "Next Steps"-style heading; Granola titles are AI-written and differ from calendar titles.

## Decision Log

- Decision: panels are created lazily and never in test builds' startup path; in test builds (`__DAYBOARD_TEST_BUILD__` or `DAYBOARD_TEST=1`) no global hotkey is registered and no menu-bar icon is created. Demo mode keeps both, so manual acceptance can run on a non-test packaged build with `DAYBOARD_DEMO=1` and a disposable `DAYBOARD_USER_DATA` (no real accounts). Panels stay reachable through File → Quick Capture… and View → Menu Bar Agenda, which also gives keyboard/VoiceOver users a route to the tray-only UI. Rationale: e2e launches many instances and must not grab system shortcuts or clutter the menu bar. Date: 2026-10-20.
- Decision: `capture:submit` awaits the whole pipeline in main (so `runAppOperation` and quit draining cover it) while the renderer fires it without awaiting and hides immediately. Date: 2026-10-20.
- Decision: create services return identifiers (`createTask` → `{ listId: "@default", taskId }`, `createEvent` → `{ calendarId: "primary", eventId }`, `createReminder` → `{ ref }`) so Undo can delete exactly what was created. Existing IPC return values are unchanged. Date: 2026-10-20.
- Decision: macOS shortcut conflicts use a built-in table of macOS default symbolic hotkeys, overridden by entries in `com.apple.symbolichotkeys` (absent entries mean the macOS default is active). Date: 2026-10-20.
- Decision: Granola provider detection is recorded on `mcp:test` results and on an explicit "Check" in Settings, keyed by server ID plus a hash of command/args/URL; no background MCP launches. Date: 2026-10-20.
- Decision (Codex design review, verdict BLOCK, all eight blockers accepted): bind capture and Undo to the account scope captured at submission and revalidated inside the write guard; strict validation for automatic capture (no silent kind substitution or dropped fields; fall back to the manual form); notes keyed by scope + calendar ID + event ID; recurring occurrences de-duplicated by `iCalUID` + start; ownership from Google's `primary` calendar flag computed before attendee filtering; meeting alerts gated on the Calendar source and recomputed on settings/account changes with stale fetches discarded; MCP tool errors never stored as notes; tray images via `?asset`; `activate` looks at the main window, not any window. Date: 2026-10-20.

## Outcomes & Retrospective

(Fill in at each milestone: what shipped, what was verified with which command output, what remains.)

## Context and Orientation

Read `AGENTS.md` (repo rules), `HANDOFF.md`, and the spec. Key existing code:

- `main/window.ts` — `createMainWindow`, `openSettingsWindow`, private `hardenWindow`/`secureWebPreferences`/`entryUrl`, `setupApplicationMenu`.
- `main/platform/ipc.ts` — `registerTrustedWindow`, `assertTrustedSender`, the `ipcMain.handle` wrapper (trusted sender → license guard for `PAID_CHANNELS` → `runAppOperation`), `streamStart`, `ipcMain.broadcast`.
- `main/platform/window-policy.ts` — `ENTRIES` allow-set of HTML entries.
- `electron.vite.config.ts` — renderer `rollupOptions.input` (`main`, `settings`).
- `main/handlers/ai.ts:363-485` — `ai:run` stream handler (demo branch, provider resolution, API and CLI paths); `mcp:test` at ~208.
- `main/handlers/productivity.ts` — `getAccountsStatus` (module-private, ~179), `tasks:create` (~544), `reminders:create` (~604), `calendar:create` (~715), `trackProductivityWrite`.
- `main/handlers/item-editing.ts` — `tasks:delete`, `reminders:delete`, `calendar:delete`.
- `main/services/google-api.ts` — `createTask` (242), `deleteTask` (274), `GEvent` (460), `eventToItem` (533), `listEventsBetween` (629), `createEvent` (690), `deleteEvent` (761).
- `main/services/apple-reminders.ts` — `createReminder` (202), `deleteReminder` (187); platform `reminders.createReminder` already returns the created `Reminder` with `ref.value`.
- `main/services/settings-store.ts` — `DEFAULT_SETTINGS`, `normalizeSettings`, `safeDemoSettings`, `saveSettings`.
- `main/services/ai/mcp-client.ts` — `openMcpSession`, `testMcpServer`, `formatToolResult` (12,000-char cap).
- `renderer/components/capture-dialog.tsx` — `parseDraft`, `CaptureProvider`, the ⌘N dialog and its draft fields; `renderer/lib/create-items.ts`; `renderer/lib/ai-prompts.ts` (`nowContext`, `CAPTURE_SYSTEM`, `buildCapturePrompt`, `buildAssistantSnapshot`, `eventLine`); `renderer/lib/ai.ts` (`useAITask`, `extractJSON`).
- `renderer/components/meeting-prep-dialog.tsx` — prep generation and `dashboard:prep:v1` cache.
- `renderer/main/agenda-view.tsx` — Agenda (`/`); the Priorities card is in the "Suggested focus" area (~794).
- `renderer/settings/general-tab.tsx` — FieldSets; `renderer/lib/settings.ts` — `useSettingsEditor`, `featureOn`, `sourceOn`.
- `renderer/lib/queries.ts` — `queryKeys`, `useBackendSync`, `useTasks`/`useReminders`/`useCalendar`/`useAccounts`.
- Tests: `tests/platform-ipc.test.mjs` shows how to bundle main modules with esbuild and fake `electron`; `tests/ai-settings.test.mjs` shows `loadModule`. Renderer unit tests run under tsx and must be listed in the `test` script in `package.json`.

Install with `npm install --include=dev` (the shell may export `NODE_ENV=production`).

## Global Constraints

- Every `BrowserWindow` keeps `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and the single preload `electron/preload.ts`.
- New HTML entries must be in `ENTRIES` and `rollupOptions.input`; every window goes through `hardenWindow` → `registerTrustedWindow`.
- Panel windows get the allow-list in `main/system-panels/panel-channels.ts`; main and Settings windows pass none.
- `capture:submit` and `capture:undo` are added to `PAID_CHANNELS`; all create/delete paths refuse demo mode.
- New settings keys must round-trip through `normalizeSettings`; defaults: `system.quickCapture = { enabled: true, hotkey: "Control+Alt+Space" }`, `system.menuBar = { enabled: true }`, `system.meetings = { upNext: true, notify: false, notifyMinutesBefore: 2, notesImport: true }`.
- Runtime `dependencies` only for main-process runtime needs; no new dependencies are planned.
- No reverse engineering of Claude.app or Granola; Granola fixtures are synthetic and contain no real notes.
- Copy rules: macOS symbols in UI (⌃⌥⇧⌘), sentence case labels, errors name what failed and what to do.
- No push, PR, release, signing with real identities, or `electron-builder.yml` fuse changes without Miles's approval. Local commits only.
- Formatting: `npm run format` (oxfmt) before each commit; do not hand-format.

## Review Focus

1. **Hotkey pressed again while a capture is still processing** — the new text must not be lost or overwritten, and a late failure from the first capture must appear without clobbering what Miles is typing (Task 9 test `keeps typed text when an earlier capture fails`).
2. **Recording a new shortcut in Settings while the old one is registered** — pressing the old combination in the recorder must record it, not open the panel (Task 6 test `suspends the global hotkey while the recorder has focus`).
3. **Menu-bar icon hidden or bounds unavailable** (menu-bar managers, View → Menu Bar Agenda with zero tray bounds) — the panel must still open on the pointer's display, top-right (Task 5 test `falls back to the top-right of the work area when tray bounds are empty`).
4. **Notes that look like instructions or HTML** (`<script>`, "ignore previous instructions") — rendered as text, fenced in prompts, never executed (Task 14 tests `renders notes as text` and `fences notes in the snapshot`).
5. **Undo after the item was already edited or deleted elsewhere, or Undo pressed twice** — one delete attempt, a clear message on failure, no second delete (Task 8 tests `undo is idempotent` and `undo reports a failed delete`).

---

### Task 1: Baseline, plan files and TASKS.md

**Files:**

- Create: `TASKS.md` (repo root; a checklist mirroring `Progress`, plus a "Found along the way" section)
- Modify: this plan's `Progress` as tasks complete

- [ ] **Step 1:** `npm install --include=dev` — expect exit 0 and `postinstall` rebuilding node-pty.
- [ ] **Step 2:** Record the baseline: `npm run typecheck && npm run lint && npm test` — expect all pass (lint may show the three known React dependency warnings). Paste the summary lines into `Outcomes & Retrospective`.
- [ ] **Step 3:** Create `TASKS.md`; commit `docs: add system panels plan and task checklist`.

### Task 2: Per-window IPC allow-list

**Files:**

- Modify: `main/platform/ipc.ts`
- Modify: `main/window.ts` (export `hardenWindow(window, url, options?)`, `secureWebPreferences()`, `entryUrl()`)
- Test: `tests/platform-ipc.test.mjs`

**Interfaces:**

- Produces: `registerTrustedWindow(contents: WebContents, entryUrl: string, options?: { channels?: ReadonlySet<string> }): void`; `hardenWindow(window: BrowserWindow, entryUrl: string, options?: { channels?: ReadonlySet<string> }): void`. Rejection message: `` `This DayBoard window can't use ${channel}.` ``

- [ ] **Step 1: Write failing tests** in `tests/platform-ipc.test.mjs`, reusing its fixture:
  - `allows listed channels for a restricted window` — register with `channels: new Set(["settings:get"])`; invoking `settings:get` resolves.
  - `rejects unlisted channels for a restricted window` — invoking `tasks:create` rejects with `This DayBoard window can't use tasks:create.` and the handler is never called.
  - `rejects unlisted stream channels for a restricted window` — `dayboard:stream:start` with `channel: "ai:assistant"` rejects with the same message.
  - `leaves unrestricted windows unchanged` — a window registered without options can invoke any registered channel.
- [ ] **Step 2:** `node --test tests/platform-ipc.test.mjs` — expect the four new tests to FAIL.
- [ ] **Step 3:** Store `channels` in `trustedWindows`; have `assertTrustedSender` return the entry; add the channel check to the `ipcMain.handle` wrapper (before the license guard) and to `streamStart` (on `request.channel`). `streamCancel` stays unrestricted.
- [ ] **Step 4:** `node --test tests/platform-ipc.test.mjs` — expect PASS (all tests).
- [ ] **Step 5:** `npm run typecheck`; commit `feat(ipc): per-window channel allow-list`.

### Task 3: Accelerator utilities and macOS shortcut conflict mapping

**Files:**

- Create: `shared/accelerator.ts`
- Test: `tests/accelerator.test.mjs` (esbuild-bundle `shared/accelerator.ts`, like `ai-settings.test.mjs`'s `loadModule`)

**Interfaces:**

- Produces:
  - `normalizeAccelerator(value: unknown): string | null` — canonical `Control+Alt+Shift+Command+<Key>` order; `null` if invalid.
  - `validateAccelerator(accelerator: string): { ok: true } | { ok: false; reason: string }` — needs ≥1 of Control/Alt/Command plus exactly one key (A–Z, 0–9, F1–F20, Space, arrows, `-=[];',./\``); rejects `Command+`Q, W, H, M, C, V, X, Z, A, N (DayBoard's own New Item), O, S, P, F, T, R,`,`, Tab, Space and `Shift+Command+Z`with reason`"That shortcut is reserved by macOS or common app commands."`
  - `acceleratorFromKeyEvent(event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null` — maps `KeyA`→`A`, `Digit1`→`1`, `Space`→`Space`, `ArrowUp`→`Up`, `F5`→`F5` (uses `code`, so ⌥ letters are not mangled); `null` for modifier-only presses.
  - `formatAccelerator(accelerator: string): string` — `"Control+Alt+Space"` → `"⌃⌥Space"`; order ⌃⌥⇧⌘.
  - `MACOS_SYMBOLIC_HOTKEYS: ReadonlyArray<{ id: number; name: string; accelerator: string }>` — macOS defaults: 60 "Select the previous input source" `Control+Space`; 61 "Select next source in Input menu" `Control+Alt+Space`; 64 "Show Spotlight search" `Command+Space`; 65 "Show Finder search window" `Alt+Command+Space`; 28 `Shift+Command+3`; 29 `Control+Shift+Command+3`; 30 `Shift+Command+4`; 31 `Control+Shift+Command+4`; 184 `Shift+Command+5` (screenshots); 32 "Mission Control" `Control+Up`; 33 "Application windows" `Control+Down`; 79 "Move left a space" `Control+Left`; 81 "Move right a space" `Control+Right`.
  - `symbolicHotkeyConflict(plist: unknown, accelerator: string): string | null` — `plist` is the JSON form of `com.apple.symbolichotkeys`; an `AppleSymbolicHotKeys[id]` entry overrides the default (`enabled`, `value.parameters = [ascii, keyCode, modifierMask]`, mask bits Shift 131072, Control 262144, Option 524288, Command 1048576; keyCode table for letters, digits, Space 49, arrows 123–126, F-keys); an absent id means the default is active. Returns the macOS shortcut name or `null`.

- [ ] **Step 1: Write failing tests:** `reserves ⌘N for DayBoard's New Item` (`validateAccelerator("Command+N").ok === false`); `normalizes modifier order` (`"Alt+Control+space"` → `"Control+Alt+Space"`); `rejects bare keys and reserved shortcuts` (`"A"`, `"Shift+A"`, `"Command+Q"`); `maps key events by code` (`{ code: "KeyD", altKey: true, ctrlKey: true }` → `"Control+Alt+D"`); `formats with macOS symbols`; `reports a default macOS conflict when the plist has no entry` (`{}` + `"Control+Alt+Space"` → `"Select next source in Input menu"`); `honours a disabled entry` (`{ AppleSymbolicHotKeys: { "61": { enabled: false, value: { parameters: [32, 49, 786432] } } } }` → `null`); `detects a customized binding` (id 64 rebound to `[100, 2, 1572864]` conflicts with `"Alt+Command+D"`).
- [ ] **Step 2:** `node --test tests/accelerator.test.mjs` — FAIL (module missing).
- [ ] **Step 3:** Implement `shared/accelerator.ts` (no Electron or DOM imports).
- [ ] **Step 4:** `node --test tests/accelerator.test.mjs` — PASS.
- [ ] **Step 5:** Commit `feat: accelerator utilities and macOS shortcut conflict table`.

### Task 4: `system` settings section and in-process settings events

**Files:**

- Modify: `main/shared-types.ts` (`AppSettings.system`, `SystemSettings` type)
- Modify: `main/services/settings-store.ts` (`DEFAULT_SETTINGS.system`, normalization, `onSettingsChanged`)
- Test: `tests/settings-persistence.test.mjs`

**Interfaces:**

- Consumes: `normalizeAccelerator`, `validateAccelerator` (Task 3).
- Produces: `AppSettings["system"]` exactly as in Global Constraints with `notifyMinutesBefore: 1 | 2 | 5 | 10`; `onSettingsChanged(listener: (next: AppSettings, previous: AppSettings) => void): () => void`, called after every successful `saveSettings` write.

- [ ] **Step 1: Write failing tests:** `defaults the system section`; `keeps a valid custom hotkey` (`"Control+Alt+D"`); `falls back to the default hotkey when invalid` (`"Command+Q"`, `42`, `"A"`); `clamps notifyMinutesBefore to 1, 2, 5 or 10`; `notifies in-process listeners after a save` (listener receives next and previous; unsubscribe stops calls).
- [ ] **Step 2:** `node --test tests/settings-persistence.test.mjs` — FAIL.
- [ ] **Step 3:** Implement. Demo settings keep `system` as saved; Task 6 skips native registration only in test builds.
- [ ] **Step 4:** `node --test tests/settings-persistence.test.mjs && npm run typecheck` — PASS (fix any `AppSettings` literals in tests or demo code the type change breaks).
- [ ] **Step 5:** Commit `feat(settings): system section for panels, hotkey and meetings`.

### Task 5: Panel placement

**Files:**

- Create: `shared/panel-placement.ts`
- Test: `tests/panel-placement.test.mjs`

**Interfaces:**

- Produces: `type Rect = { x: number; y: number; width: number; height: number }`; `capturePanelBounds(workArea: Rect, size: { width: number; height: number }): Rect` (centred horizontally, top at `workArea.y + round(workArea.height * 0.2)`, clamped inside the work area); `menuBarPanelBounds(trayBounds: Rect | null, workArea: Rect, size): Rect` (centred under the tray icon, 6 px below the work-area top, kept ≥ 8 px from both edges; empty or null tray bounds → right-aligned 8 px from the work area's right edge).

- [ ] **Step 1: Write failing tests:** `centres the capture panel in the upper part of the display`; `clamps the capture panel on a short display`; `centres the menu-bar panel under the icon`; `keeps the menu-bar panel 8 px inside the right edge`; `falls back to the top-right of the work area when tray bounds are empty` (`{ x: 0, y: 0, width: 0, height: 0 }` and `null`); `works on a secondary display with a negative origin` (`workArea.x = -1920`).
- [ ] **Step 2:** `node --test tests/panel-placement.test.mjs` — FAIL.
- [ ] **Step 3:** Implement (pure).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: panel placement math`.

### Task 6: Panel window layer, hotkey manager, menu items and Settings UI

**Files:**

- Create: `panel-window.html` (copy `main-window.html`'s CSP and theme bootstrap; entry `./renderer/panel/index.tsx`)
- Create: `renderer/panel/index.tsx` (React root: `initializeDemoMode`, `applyCachedAppearance`, `QueryClientProvider` with its own `QueryClient`, `TooltipProvider`, `Toaster`, `useTheme`, `useBackendSync`; renders `CapturePanel` for `#capture` and `MenuBarPanel` for `#menubar` — placeholders that only show the surface name are not allowed; land this task with a minimal real capture input wired to `panel:hide` on Esc, completed in Task 9)
- Create: `main/system-panels/panel-channels.ts` (`PANEL_CHANNELS: ReadonlySet<string>` exactly as the spec's list plus the theme/appearance reads the panel root needs)
- Create: `main/system-panels/panel-window.ts`
- Create: `main/system-panels/hotkey.ts`
- Create: `main/system-panels/index.ts` (`startSystemPanels()`; registers `panel:*` and `system:*` handlers; subscribes to `onSettingsChanged`)
- Modify: `main/platform/window-policy.ts` (`ENTRIES` += `panel-window.html`), `electron.vite.config.ts` (input `panel`), `main/window.ts` (menu items; `focusMainWindow(route?)`), `main/index.ts` (call `startSystemPanels()` after `createMainWindow()`; `globalShortcut.unregisterAll()` on `will-quit`; `activate` shows the main window unless the main window itself is visible, ignoring panels), `renderer/main/root-view.tsx` (handle `app:navigate`)
- Modify: `renderer/settings/general-tab.tsx` ("Menu Bar & Shortcuts" FieldSet: Quick Capture switch, shortcut recorder with conflict message, Menu bar icon switch), `renderer/lib/settings.ts` (`useHotkeyStatus()`)
- Test: `tests/panel-channels.test.mjs`, `tests/hotkey.test.mjs`, `e2e/system-panels.spec.ts`

**Interfaces:**

- Consumes: Tasks 2–5.
- Produces:
  - `type PanelSurface = "capture" | "menubar"`; `showPanel(surface: PanelSurface): Promise<void>`; `hidePanel(surface: PanelSurface): void`; `togglePanel(surface: PanelSurface): Promise<void>`; `isPanelVisible(surface): boolean`; `getPanelContents(surface): WebContents | null`.
  - Window options: `type: "panel"`, `frame: false`, `resizable: false`, `skipTaskbar: true`, `hiddenInMissionControl: true`, `fullscreenable: false`, `show: false`, `setAlwaysOnTop(true, "floating")`, vibrancy `popover` unless Reduce Transparency/Increase Contrast; capture size 560×(content, max 420), menu-bar size 360×520. Hide on `blur`.
  - IPC: `panel:hide { surface }`; `panel:openMain { route: "/" | "/tasks" | "/reminders" | "/calendar" | "/mail" | "/assistant" | "/review"; prompt?: string }` (≤ 4,000 chars; shows and focuses the main window, activates the app, broadcasts `app:navigate { to, prompt }`); `system:hotkeyStatus` → `HotkeyStatus = { accelerator: string; enabled: boolean; registered: boolean; conflict: string | null }`; `system:suspendHotkey { suspended: boolean }` (Settings window only; not in `PANEL_CHANNELS`; main also resumes automatically when the Settings window closes); broadcast `system:hotkeyStatus` on change.
  - Menu: File → "Quick Capture…" (id `quick-capture`, no menu accelerator: on macOS `registerAccelerator: false` is ignored, so a menu key equivalent would fire while the Settings recorder is listening); View → "Menu Bar Agenda" (id `menubar-agenda`). Both open their panel on the pointer's display.
  - Hotkey manager reads the plist with `spawn("/usr/bin/defaults", ["export", "com.apple.symbolichotkeys", "-"])` piped into `spawn("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"])`, 2 s timeout, failures ignored; never registers in test builds.

- [ ] **Step 1: Write failing tests:**
  - `tests/panel-channels.test.mjs`: `panel allow-list is exactly the reviewed set` (deep-equal sorted array literal); `panel allow-list excludes settings, MCP, account and delete channels` (`settings:update`, `mcp:save`, `google:connect`, `tasks:delete`, `system:suspendHotkey` absent).
  - `tests/hotkey.test.mjs` (bundle `hotkey.ts` with fake `electron.globalShortcut` and fake spawn): `registers the configured accelerator`; `reports registration failure as in use by another app`; `reports a macOS conflict from the plist`; `skips the plist check when reading fails`; `re-registers when the hotkey setting changes`; `unregisters when Quick Capture is switched off`; `suspends the global hotkey while the recorder has focus` (suspend → unregistered; resume → registered again); `does not register in test builds`.
  - `e2e/system-panels.spec.ts` (demo profile): `Dock activation shows the main window while a panel is open` (hide the main window, open the capture panel, `app.evaluate(({ app }) => app.emit("activate", {}, true))`, expect the main window visible); `File → Quick Capture opens the capture panel` (click menu item via `app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("quick-capture")?.click())`, then a new window with URL ending `panel-window.html#capture` appears and its input is focused); `Escape hides the capture panel`; `the capture panel cannot call unlisted channels` (from the panel page, `window.dayboard.ipc.invoke("settings:update", {})` rejects with `can't use settings:update`).
- [ ] **Step 2:** Run `node --test tests/panel-channels.test.mjs tests/hotkey.test.mjs` — FAIL.
- [ ] **Step 3:** Implement the main-process modules and wiring.
- [ ] **Step 4:** Implement the Settings FieldSet. The recorder calls `system:suspendHotkey { suspended: true }` on focus and `false` on blur/unmount, shows `formatAccelerator`, validates with `validateAccelerator`, and shows `conflict` from `useHotkeyStatus()` as the field error ("⌃⌥Space is in use by another app. Choose a different shortcut." or "macOS uses ⌃⌥Space for Select next source in Input menu. Turn it off in System Settings → Keyboard → Keyboard Shortcuts, or choose another shortcut.").
- [ ] **Step 5:** `node --test tests/panel-channels.test.mjs tests/hotkey.test.mjs && npm run typecheck && npm run build` — PASS.
- [ ] **Step 6:** `npx playwright test e2e/system-panels.spec.ts` (after `DAYBOARD_TEST=1 npm run build`) — PASS; then the full `npm run test:e2e` to confirm existing specs (menu structure, `firstWindow`) still pass.
- [ ] **Step 7:** Commit `feat: panel window layer, global hotkey and Settings shortcuts`.

### Task 7: Shared capture logic and AI completion runner

**Files:**

- Create: `shared/capture.ts`, `shared/json-extract.ts`, `shared/prompt-context.ts`
- Create: `main/services/ai/completion.ts`
- Modify: `renderer/components/capture-dialog.tsx` (import shared `parseDraft`; extract `DraftFields` to `renderer/components/draft-fields.tsx`), `renderer/lib/create-items.ts` and `renderer/lib/ai.ts` and `renderer/lib/ai-prompts.ts` (re-export moved symbols so other imports keep working), `main/handlers/ai.ts` (`ai:run` delegates to `runCompletion`)
- Test: `tests/capture-shared.test.mjs`

**Interfaces:**

- Produces:
  - `shared/json-extract.ts`: `extractJSON(text: string): unknown` (moved unchanged).
  - `shared/prompt-context.ts`: `nowContext(now?: Date): string` (moved; same output).
  - `shared/capture.ts`: `type ItemKind`, `interface ItemDraft`, `isItemKind`, `KIND_LABEL` (moved); `type AvailableKinds = Record<ItemKind, boolean>`; `availableKinds(input: { googleConnected: boolean; remindersAccess: string; sources: AppSettings["sources"] }): AvailableKinds`; `CAPTURE_SYSTEM`; `buildCapturePrompt(sentence: string, available: AvailableKinds, now?: Date): string`; `parseDraft(text: string, available: AvailableKinds): ItemDraft | null` (moved unchanged, still used by ⌘N); `parseDraftStrict(text: string, available: AvailableKinds): { ok: true; draft: ItemDraft } | { ok: false; partial: Partial<ItemDraft>; reason: string }` (no kind substitution, no dropped fields: an unknown/unavailable kind, a malformed date or time, an end time without a start, or an event without a date fails with the cleanly parsed fields in `partial`); `normalizeDraft(value: unknown, available: AvailableKinds): ItemDraft | { error: string }` (title 1–500 chars, date `YYYY-MM-DD`, times `HH:mm`, kind available, events need a date); `describeCapture(draft: ItemDraft, now?: Date): { title: string; body: string }` → `{ title: "Added to Reminders", body: "Call dentist · Thu, Oct 22, 3:00 PM" }`; `aiCaptureEnabled(settings: AppSettings): boolean` → `ai.enabled && ai.providerChosen && ai.features.capture` (the one check main and both panels use).
  - `main/services/ai/completion.ts`: `runCompletion(input: { system: string; prompt: string; signal: AbortSignal; onDelta?: (text: string) => void; onUsage?: (chunk: AIStreamChunk) => void }): Promise<{ text: string; usage?: RequestUsage }>` — the non-demo body of `ai:run`, throwing the same errors.

- [ ] **Step 1: Write failing tests:** `parseDraftStrict refuses an unavailable kind instead of switching it`; `parseDraftStrict refuses a malformed time instead of dropping it`; `parseDraftStrict keeps cleanly parsed fields in partial`; `aiCaptureEnabled requires the capture feature switch`; `availableKinds follows Google, Reminders access and source switches`; `parseDraft keeps today's behaviour` (copy the dialog's cases: missing title → null, unavailable kind falls back to reminder→task→event order, bad times dropped); `normalizeDraft rejects an event without a date`; `normalizeDraft trims and caps the title`; `describeCapture formats each kind` (task with date, reminder with date+time, event with times, no date → body is the title only); `buildCapturePrompt lists only available kinds`.
- [ ] **Step 2:** `node --test tests/capture-shared.test.mjs` — FAIL.
- [ ] **Step 3:** Move/extract; keep all old import paths working via re-exports.
- [ ] **Step 4:** `node --test tests/capture-shared.test.mjs && npm test && npm run typecheck` — PASS (existing renderer and ai tests unchanged).
- [ ] **Step 5:** Commit `refactor: share capture parsing and the AI completion runner`.

### Task 8: Capture pipeline in main with Undo

**Files:**

- Modify: `main/services/google-api.ts` (`createTask` → `Promise<{ listId: string; taskId: string }>`, `createEvent` → `Promise<{ calendarId: string; eventId: string }>`), `main/services/apple-reminders.ts` (`createReminder` → `Promise<{ ref: string }>`)
- Modify: `main/handlers/productivity.ts` (export `getAccountsStatus`), `shared/license-policy.ts` (`capture:submit`, `capture:undo`)
- Create: `main/services/capture/capture-service.ts` (Electron-free, dependency-injected)
- Create: `main/system-panels/capture-handlers.ts` (IPC + `Notification` + panel reopen)
- Test: `tests/capture-service.test.mjs`

**Interfaces:**

- Consumes: Task 7 (`availableKinds`, `aiCaptureEnabled`, `parseDraftStrict`, `normalizeDraft`, `describeCapture`, `buildCapturePrompt`, `CAPTURE_SYSTEM`, `runCompletion`), Task 6 (`showPanel`), Task 2's `main/platform/ipc.ts` (new `runGuardedCommand`).
- Produces:
  - `type CaptureSubmit = { text: string } | { draft: ItemDraft }` (text ≤ 1,000 chars).
  - `interface CaptureRecord { id: string; text: string; draft: ItemDraft | null; partial: Partial<ItemDraft> | null; state: "processing" | "created" | "undone" | "failed"; error: string | null; createdAt: string; canUndo: boolean }` (no provider identifiers cross IPC; `partial` restores cleanly parsed fields into the manual form).
  - `runGuardedCommand<T>(channel: string, run: () => Promise<T>): Promise<T>` exported from `main/platform/ipc.ts`: the same license guard (for `PAID_CHANNELS`) and `runAppOperation` admission the IPC wrapper applies, for actions that start outside IPC (notification buttons).
  - `createCaptureService(deps: CaptureDeps): { submit(input: CaptureSubmit): Promise<CaptureRecord>; undo(id: string): Promise<CaptureRecord>; recent(): CaptureRecord[] }` where `CaptureDeps = { isDemoMode(): boolean; currentScope(): Promise<string>; guardedWrite<T>(scope: string, write: () => Promise<T>): Promise<T> /* runs inside trackProductivityWrite and throws "Your account changed. Check the details and add it again." when the scope no longer matches */; getSettings(): Promise<AppSettings>; getAccounts(): Promise<AccountsStatus>; complete(system: string, prompt: string): Promise<string>; create: { task(d: ItemDraft): Promise<{ listId: string; taskId: string }>; reminder(d: ItemDraft): Promise<{ ref: string }>; event(d: ItemDraft): Promise<{ calendarId: string; eventId: string }> }; remove: { task(ref): Promise<void>; reminder(ref): Promise<void>; event(ref): Promise<void> }; onChange(records: CaptureRecord[]): void; onCreated(record: CaptureRecord): void; onFailed(record: CaptureRecord): void; now(): Date; newId(): string }`.
  - Rules: AI path only when `aiCaptureEnabled(settings)`; otherwise `{ text }` is rejected with "Fill in the details, then add it." The scope is read at submission; creation and Undo run through `guardedWrite(scope, …)`. Strict-parse failure → `failed` with `partial` kept and error "Check the details, then add it." plus the reason. Receipts (scope + identity) are in memory only, single use, 10 minutes; a receipt problem after a successful create never turns into a "create failed" result. Keep at most 5 records.
  - IPC (`capture-handlers.ts`): `capture:submit` (validates, awaits `submit` inside `trackProductivityWrite`, returns the record), `capture:undo { id }`, `capture:recent`; broadcasts `capture:changed { records }`; `onCreated` → `Notification({ title, body, actions: [{ type: "button", text: "Undo" }], silent: true })`, `action` → `runGuardedCommand("capture:undo", () => service.undo(id))` (one Undo command for IPC and notifications: runtime admission, license, demo, receipt and scope checks), `show`/`failed` events → `recordNotificationResult("delivered" | "refused")` in `main/system-panels/notification-status.ts`, exposed as `system:notificationStatus` → `{ status: "unknown" | "delivered" | "refused" }` and broadcast on change; `onFailed` → `showPanel("capture")` when it is hidden (the panel renders failures from `capture:changed`); `panel:show { surface }` (panel channel) lets a panel re-show itself after a wrapper-level rejection. Demo mode: `submit` rejects with the existing demo message.

- [ ] **Step 1: Write failing tests** (fake deps, fixed clock): `keeps the cleanly parsed fields as partial on an unclear parse`; `refuses to create after an account change during parsing`; `undo refuses after an account change`; `sends an unclear parse to the manual form without creating`; `creates a reminder from AI output and reports it`; `uses the manual draft without calling AI`; `rejects text when AI capture is off`; `marks a parse failure and keeps the text`; `marks a create failure with the provider message`; `refuses demo mode before calling anything`; `undo deletes exactly the created item`; `undo is idempotent` (second call does not call `remove` again and returns the same `undone` record); `undo reports a failed delete` (record stays `created`, error set, `canUndo` stays true); in `tests/platform-ipc.test.mjs`: `runGuardedCommand applies the license guard to paid commands` and `runGuardedCommand waits behind update preparation`; `undo expires after 10 minutes`; `keeps only the five newest records`; `two concurrent submits both complete`.
- [ ] **Step 2:** `node --test tests/capture-service.test.mjs` — FAIL.
- [ ] **Step 3:** Change the three create services to return identifiers (existing IPC handlers ignore them). Implement the service and handlers; register handlers from `startSystemPanels()`.
- [ ] **Step 4:** `node --test tests/capture-service.test.mjs && npm test && npm run typecheck` — PASS.
- [ ] **Step 5:** Commit `feat(capture): background capture pipeline with Undo`.

### Task 9: Quick Capture panel UI

**Files:**

- Create: `renderer/panel/capture-panel.tsx`, `renderer/panel/use-capture.ts`
- Modify: `renderer/panel/index.tsx`
- Test: `renderer/panel/capture-panel-state.test.ts` (tsx; add to the `test` script), `e2e/system-panels.spec.ts`

**Interfaces:**

- Consumes: Task 7 `DraftFields`, Task 8 IPC, Task 6 `panel:hide`.
- Produces: `reduceCapturePanel(state: CapturePanelState, action: CapturePanelAction): CapturePanelState` (pure) with actions `typed`, `submitted`, `recordsChanged`, `editFailure`, `shown`; the panel focuses its input on window `focus`.

- [ ] **Step 1: Write failing tests:** `queues a wrapper-level rejection without losing the text` (submit, then a rejected invocation for that snapshot adds a failure carrying the original text while newer typed text stays); `clears the input after submit`; `keeps typed text when an earlier capture fails` (state has text "Buy milk", a `recordsChanged` with a failed record keeps the text and lists the failure); `editFailure loads the failed text into the manual form`; `uses the manual form when AI capture is unavailable`.
- [ ] **Step 2:** `npx tsx --test renderer/panel/capture-panel-state.test.ts` — FAIL.
- [ ] **Step 3:** Implement: Enter → keep a local snapshot `{ localId, text | draft }`, call `invoke("capture:submit", …)` without awaiting it before `panel:hide`, and attach a rejection handler: a rejection that never reached the service (license, update in progress, demo) adds a local failure with the snapshot and calls `panel:show { surface: "capture" }`, never replacing text typed since; Esc → `panel:hide`; failures above the input with "Edit" and "Dismiss"; "Connect Google or allow Reminders access" callout when nothing is available (button → `window:openSettings`).
- [ ] **Step 4:** Add e2e `submitting in demo mode shows the demo refusal in the panel`. Run the tsx test, `npm run build`, and `npx playwright test e2e/system-panels.spec.ts` — PASS.
- [ ] **Step 5:** Commit `feat(capture): Quick Capture panel`.

### Task 10: Menu-bar icon and menu-bar panel

**Files:**

- Create: `resources/tray/trayTemplate.png` (16×16) and `resources/tray/trayTemplate@2x.png` (32×32), black on transparent from `brand/dayboard-icon-small.svg`; `resources/tray/README.md` with the exact generation command
- Create: `main/system-panels/tray.ts`, `renderer/panel/menubar-panel.tsx`, `renderer/panel/today-items.ts`
- Test: `renderer/panel/today-items.test.ts` (tsx; add to `test` script), `e2e/system-panels.spec.ts`

**Interfaces:**

- Consumes: Task 6 (`togglePanel`, `menuBarPanelBounds`), Task 8 (`capture:recent`, `capture:undo`), existing `buildTodos`/`buildAgenda`.
- Produces: `startTray(): void` / `stopTray(): void` (follows `system.menuBar.enabled`; not in test builds; images imported with electron-vite's `?asset` suffix so they ship in `out/`, combined with `nativeImage` 1× and 2× representations and `setTemplateImage(true)`; right-click menu Open DayBoard, Quick Capture, Settings…, Quit DayBoard); `todayItems(agenda: Agenda, now: Date): { overdueCount: number; items: TodayItem[] }` with `TodayItem = { key: string; kind: "event" | "todo"; title: string; time: string | null; source: SourceId }` (timed events not yet ended, then due-today to-dos, max 8).

- [ ] **Step 1: Write failing tests:** `lists today's remaining events then due to-dos`; `counts overdue to-dos`; `caps the list at eight`; e2e `View → Menu Bar Agenda shows today's demo items`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement tray, panel (no Up Next section until Task 12 adds `MeetingCard`; Recent captures with Undo; capture box using `capture:submit` with the manual form when `aiCaptureEnabled` is false; "Ask Assistant" → `panel:openMain { route: "/assistant", prompt }`, shown only when `featureOn(settings, "assistant")`; item click → `panel:openMain { route: "/" }`).
- [ ] **Step 4:** Tests, `npm run build`, e2e — PASS.
- [ ] **Step 5:** Commit `feat: menu-bar icon and mini Agenda panel`.

### Task 11: Meeting logic and calendar fields

**Files:**

- Create: `shared/meetings.ts`
- Modify: `main/shared-types.ts` (`CalendarEventItem` optional `selfResponse?: "accepted" | "declined" | "tentative" | "needsAction" | null; primaryCalendar?: boolean; selfInvited?: boolean; iCalUID?: string`), `main/services/google-api.ts` (`GEvent` gains `iCalUID`, `organizer`, attendee `responseStatus`; `eventToItem(event, calendar, fullDescription, accountEmail)` fills the new fields from the raw attendee list before the self attendee is removed and the list is capped: `selfInvited` when the account email is the organizer or any attendee, `selfResponse` only when `calendar.primary`; callers pass the connected account's email), `main/services/demo-data.ts` (demo meetings get `primaryCalendar: true`, `selfInvited: true`, `selfResponse: "accepted"`)
- Test: `tests/meetings.test.mjs`

**Interfaces:**

- Produces: `extractJoinUrl(event: Pick<CalendarEventItem, "meetLink" | "location" | "description">): string | null` (https only; `meet.google.com`, `*.zoom.us`, `teams.microsoft.com`, `teams.live.com`, `*.webex.com`, `whereby.com`); `isMine(event): boolean` (`primaryCalendar` — Google's `primary` flag, including the legacy `"primary"` fallback — or `selfInvited`); `isMeeting(event): boolean`; `meetingKey(event): string` (`iCalUID + "@" + start`, else `calendarId + "/" + id + "@" + start`); `dedupeMeetings(events: CalendarEventItem[]): CalendarEventItem[]` (by `meetingKey`, preferring the primary-calendar copy); `pickUpNext(events, now: Date): UpNext | null` with `UpNext = { event: CalendarEventItem; joinUrl: string | null; phase: "now" | "soon" | "later"; minutesUntil: number; minutesLeft: number }` (`soon` ≤ 15 min, `later` ≤ 12 h); `justEnded(events, now): CalendarEventItem | null` (ended ≤ 3 h ago, most recent); `nextAlert(events, now, minutesBefore: number, sent: ReadonlySet<string>): { at: Date; key: string; event: CalendarEventItem } | null` (`key = meetingKey(event)`; an alert time already past but before start fires now); `startLabel(upNext: UpNext): string` ("Starts in 5 min", "Starts in 1 hr 10 min", "Now · ends in 20 min").

- [ ] **Step 1: Write failing tests:** `extracts Meet, Zoom, Teams and Webex links`; `ignores http and lookalike hosts` (`http://zoom.us/…`, `https://zoom.us.evil.example/…`); `treats primary-calendar events and invited events as mine`; `ignores colleagues' meetings on shared calendars`; `skips declined and all-day events`; `dedupes the same meeting across calendars`; `keeps every occurrence of a recurring meeting`; `treats invitations on the legacy primary fallback calendar as mine`; `treats a non-primary invitation as mine even beyond the 20-attendee cap` (in `tests/agenda-google-api.test.mjs`: `eventToItem` with 30 attendees and the account 25th sets `selfInvited`); `picks the in-progress meeting first`; `labels phases and minutes`; `finds the meeting that just ended`; `schedules the next alert once per event start`; `fires immediately when the alert time has passed but the meeting has not started`.
- [ ] **Step 2:** `node --test tests/meetings.test.mjs` — FAIL.
- [ ] **Step 3:** Implement; update `eventToItem` and demo data.
- [ ] **Step 4:** `node --test tests/meetings.test.mjs tests/agenda-google-api.test.mjs && npm test && npm run typecheck` — PASS.
- [ ] **Step 5:** Commit `feat(meetings): next-meeting selection and calendar fields`.

### Task 12: Up Next card and Meetings settings

**Files:**

- Create: `renderer/lib/meeting-prep.ts` (`useMeetingPrep(event)` extracted from `MeetingPrepDialog`: stored prep, related mail/to-dos, `generate()`, `isRunning`)
- Create: `renderer/components/meeting-card.tsx`
- Modify: `renderer/components/meeting-prep-dialog.tsx` (use the hook; behaviour unchanged), `renderer/main/agenda-view.tsx` (card above the Priorities card), `renderer/panel/menubar-panel.tsx` (card at top), `renderer/settings/general-tab.tsx` ("Meetings" FieldSet: Up Next card switch; Notify before meetings switch + minutes select 1/2/5/10; Meeting notes from Granola switch, "Check MCP servers" button and status — the button and status are wired in Task 14)
- Test: `e2e/system-panels.spec.ts` (Settings switches), manual screenshot

**Interfaces:**

- Consumes: Task 11 (`pickUpNext`, `startLabel`, `justEnded`, `extractJoinUrl`), `useAgendaClock`, `useCalendar`, `useAccounts`.
- Produces: `MeetingCard({ surface }: { surface: "agenda" | "menubar" })`; hidden when `system.meetings.upNext` is off or no meeting qualifies.

- [ ] **Step 1:** Write e2e `turning off the Up Next card hides it on Agenda` (demo profile; toggle in Settings; assert the card's `aria-label="Up next meeting"` region disappears). Run — FAIL.
- [ ] **Step 2:** Implement the hook extraction; confirm the existing meeting-prep e2e and `npm test` still pass.
- [ ] **Step 3:** Implement the card (title, time, `startLabel`, Join via `openExternal`, attendee count, prep preview when AI and `meetingPrep` are on, "Prepare" button) and the FieldSet.
- [ ] **Step 4:** `npm run typecheck && npm run build && npx playwright test e2e/system-panels.spec.ts` — PASS.
- [ ] **Step 5:** Commit `feat(meetings): Up Next card and Meetings settings`.

### Task 13: Meeting notifications

**Files:**

- Create: `main/system-panels/meeting-alerts.ts`
- Modify: `main/system-panels/index.ts` (start/stop with `system.meetings.notify`), `renderer/settings/general-tab.tsx` (refused-notification message from `system:notificationStatus`)
- Test: `tests/meeting-alerts.test.mjs`

**Interfaces:**

- Consumes: Task 11 `nextAlert`, `extractJoinUrl`; `listEventsBetween` (now → now + 24 h, Settings visibility); account email from `getAccountsStatus`.
- Consumes also: Task 8 `recordNotificationResult` / `system:notificationStatus`.
- Produces: `createMeetingAlerts(deps: { listEvents(): Promise<CalendarEventItem[]>; accountEmail(): Promise<string | null>; notify(alert: { title: string; body: string; joinUrl: string | null }): void; setTimer(fn: () => void, ms: number): () => void; now(): Date }): { start(settings: AppSettings["system"]["meetings"]): void; stop(): void; refresh(): Promise<void> }`.

- [ ] **Step 1: Write failing tests:** `schedules one timer for the next alert`; `notifies once per meeting start`; `reschedules when a meeting moves`; `does nothing when notify is off`; `does nothing when the Calendar source is off`; `does nothing when Google is not connected`; `recomputes and cancels the timer on an account change`; `discards a fetch that finishes after a newer refresh`; `includes the join URL only when it is https`.
- [ ] **Step 2:** `node --test tests/meeting-alerts.test.mjs` — FAIL.
- [ ] **Step 3:** Implement; add an in-process `onAccountsChanged(listener)` next to `broadcastAccounts` in `main/handlers/productivity.ts`; refresh every `max(5, general.refreshMinutes || 15)` minutes and on settings or account change, gated on `sources.calendar.enabled`, with a generation counter so stale fetches are dropped; Electron `Notification` with a "Join" action (`shell.openExternal` after `isExternalWebUrl`), click → `showPanel("menubar")` (or the main window when the menu-bar icon is off); never in demo mode.
- [ ] **Step 4:** PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(meetings): optional notification before meetings`.

### Task 14: Granola notes import and follow-ups

**Files:**

- Create: `main/services/meeting-notes/granola-parse.ts`, `match.ts`, `action-items.ts`, `providers.ts`, `notes-store.ts`
- Create: `main/handlers/meeting-notes.ts` (registered from `registerHandlers`)
- Modify: `main/services/ai/mcp-client.ts` (`callMcpTool`), `main/handlers/ai.ts` (`mcp:test` records the fingerprint), `renderer/settings/mcp-tab.tsx` (hint: Granola's hosted server needs sign-in that DayBoard's HTTP connection can't do; add it as a command that bridges to it, keeping its tool names), `renderer/components/meeting-card.tsx` (after-meeting state), `renderer/components/event-detail.tsx` ("Meeting notes" section), `renderer/settings/general-tab.tsx` (Check button/status), `renderer/lib/ai-prompts.ts` + `renderer/main/assistant-view.tsx` (notes in the snapshot)
- Test: `tests/meeting-notes.test.mjs`, `renderer/lib/ai-prompts.test.ts`

**Interfaces:**

- Produces:
  - `parseGranolaMeetings(text: string): GranolaMeeting[]` with `GranolaMeeting = { id: string; title: string; meetingAt: string | null; url: string | null }` (attributes of `<meeting …>` tags, XML entities decoded).
  - `parseGranolaNotes(text: string, meetingId: string): { title: string | null; text: string } | null` (the `<summary>` body of that meeting, entity-decoded; else that meeting element's text with tags stripped).
  - `matchMeeting(event: { title: string; start: string; end: string }, candidates: GranolaMeeting[]): { match: GranolaMeeting | null; candidates: GranolaMeeting[] }` (window start − 10 min … end + 5 min; title-token overlap breaks ties; ≤ 5 candidates by time distance).
  - `extractActionItems(markdown: string): ActionItem[]` with `ActionItem = { title: string; detail: string }` (bullets under `Next Steps`/`Action items`/`To do`/`Follow-ups` headings; bold text as title; ≤ 10 items; title ≤ 200 chars); `ACTION_ITEMS_SYSTEM`, `buildActionItemsPrompt(notes: string): string`, `parseActionItems(text: string): ActionItem[] | null`.
  - `callMcpTool(server: McpServerConfig, tool: string, args: Record<string, unknown>, options: { maxOutput: number }): Promise<{ text: string; isError: boolean; truncated: boolean }>` (errors and empty results are never stored as notes).
  - `serverConfigHash(server: McpServerConfig): string` (sha256 of transport, command, args, url — not the server ID, because Test runs on an unsaved form whose ID Save regenerates); `recordToolFingerprint(server: McpServerConfig, tools: string[]): Promise<void>` (records the hash as `granola` or clears it); `findNotesProvider(servers: McpServerConfig[]): Promise<McpServerConfig | null>` (first enabled server whose current hash is recorded as `granola`); stored in `userData/meeting-notes/providers.json`.
  - `NotesRecord = { scope: string; calendarId: string; eventId: string; provider: "granola"; providerMeetingId: string; providerUrl: string | null; title: string | null; importedAt: string; text: string }`; store at `userData/meeting-notes/notes.json` keyed `scope + "/" + calendarId + "/" + eventId` (serial queue, atomic writes, ≤ 200 records, oldest dropped); reads return the current scope only; an import finishing after a scope change is discarded; nothing read or written in demo mode.
  - IPC: `meetings:notesStatus` → `{ provider: { id: string; name: string } | null; enabled: boolean }`; `meetings:checkProviders` (Settings only; runs `testMcpServer` on enabled servers one at a time, records fingerprints) → `{ found: { id: string; name: string }[] }`; `meetings:findNotes { calendarId, eventId, title, start, end }` → `{ selection: string; match: GranolaMeeting | null; candidates: GranolaMeeting[] }` where `selection` is a random, 10-minute, single-use token stored in main with the account scope, calendar/event IDs, provider server config hash and the offered candidate IDs; `meetings:importNotes { selection, providerMeetingId }` → `NotesRecord` (rejects an unknown/expired token, a meeting ID not offered, a changed scope or provider config — checked before the fetch and again before saving); all selections are cleared on account change; `meetings:getNotes { events: { calendarId: string; eventId: string }[] (≤ 100) }` → `Record<string /* calendarId + "/" + eventId */, NotesRecord>`.
- [ ] **Step 1: Write failing tests** with synthetic fixtures shaped like the sample (made-up titles and text): `parses meeting attributes and decodes entities`; `ignores malformed meeting tags`; `extracts the summary of the requested meeting only`; `matches by time window first`; `breaks ties by title overlap`; `returns candidates when nothing matches`; `extracts bold action items under Next Steps`; `extracts plain bullets under Action items`; `returns no items without a matching heading`; `parses AI action items JSON and rejects junk`; `records Granola fingerprints only for list_meetings plus get_meetings`; `ignores a fingerprint after the server's command or URL changes`; `does not store an MCP error or empty result as notes`; `returns only the current account's notes`; `discards an import that finishes after an account change`; `rejects an import with an unknown, expired or reused selection`; `rejects a meeting ID that was not offered`; `rejects an import after the provider's configuration changed`; `records fingerprints by configuration, so Test then Save keeps the provider`; `notes store keeps the newest 200`; `nothing is stored in demo mode`. In `renderer/lib/ai-prompts.test.ts`: `fences notes in the snapshot` (notes containing "ignore previous instructions" stay on one line inside the snapshot block, truncated to 1,500 chars).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement services, handlers and UI. Card after-meeting state: "Get notes from Granola" → `meetings:findNotes` → import directly on a single match, otherwise a picker of candidates (title + time) → preview (first lines, "Show all" in event detail) → action items with "Add as Task" / "Add as Reminder" (existing `createItem`), with AI extraction when AI is on and the heuristic otherwise. Notes render as text with headings and bullets only (`renders notes as text` component test or e2e asserting a `<script>` string appears literally).
- [ ] **Step 4:** `node --test tests/meeting-notes.test.mjs && npm test && npm run typecheck && npm run build` — PASS.
- [ ] **Step 5:** Commit `feat(meetings): Granola notes import with follow-ups`.

### Task 15: Porting doc, fuse proposal, handoff

**Files:**

- Create: `docs/porting-system-panels.md` (framework-agnostic modules with paths; Electron-only pieces: `globalShortcut`, `Tray`, panel `BrowserWindow` options, `screen`, `Notification`, `registerTrustedWindow` allow-list, `defaults`/`plutil` read; what to look up in Glaze's `@glaze/core/backend` for each)
- Create: `docs/proposals/electron-fuses.md` (current fuse state from REA, electron-builder 26's `electronFuses` option, proposed values `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`; risks such as node-pty spawn helpers and the updater; no config change)
- Modify: `HANDOFF.md` (unreleased-on-main summary for this branch), `TASKS.md`
- [ ] **Step 1:** Write the docs; `npm run format:check`.
- [ ] **Step 2:** Commit `docs: porting guide, fuse proposal and handoff`.

### Task 16: Full verification, packaged build, manual acceptance, REA check

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run format:check && npm test` — paste the summary lines.
- [ ] **Step 2:** `npm run test:e2e` — paste the pass count.
- [ ] **Step 3:** `npm run package:test` (automated packaged checks; hotkey and menu-bar icon stay off by design) and `npm run package:preview` (non-test, ad-hoc signed; for manual acceptance) — note both `.app` paths. Never launch either against Miles's real profile.
- [ ] **Step 4:** Manual acceptance with computer use on the `package:preview` app launched with `DAYBOARD_DEMO=1` and a fresh `DAYBOARD_USER_DATA` (not Miles's installed copy or profile), screenshots saved under `docs/screenshots/system-panels/`: hotkey from a normal app; hotkey over a full-screen app; display under the pointer; Esc / click-away / submit keep focus in the previous app; menu-bar panel under the icon; hotkey conflict message (temporarily set ⌘Space via the recorder, which must refuse it, then a free shortcut); switches remove hotkey, icon and card; notification delivered or refused (record which).
- [ ] **Step 5:** REA `analyze_javascript_application` with `detail: "summary"` and `source_paths` on the packaged `app.asar`; confirm IPC channels, preload surface (unchanged `window.dayboard`) and windows (main, settings, panel) match the spec; record in `Artifacts and Notes`.
- [ ] **Step 6:** Request a final whole-branch review (Codex), fix merge-blockers, rerun Step 1–2.
- [ ] **Step 7:** Commit; update `Progress` and `Outcomes & Retrospective`. Do not push.

## Validation and Acceptance

Done when: all unit, e2e and static checks pass with output pasted; the packaged test app shows the three features working behind their switches (screenshots); REA confirms shipped channels and windows; commits are on `claude/system-panels-bb42de`; Miles has the fuse proposal and the list of manual actions (Granola connection, live Google sign-in with `google-oauth.local.json`, signed-build notification check).

## Idempotence and Recovery

Each task ends in a commit; rerunning a task's tests is safe. Disposable e2e profiles are created per test. The settings migration is additive (`system` defaults fill in on read). Notes and provider files live under `userData/meeting-notes/` and can be deleted to reset.

## Artifacts and Notes

(Record command outputs, REA summary and screenshot paths here as they are produced.)

## Interfaces and Dependencies

No new npm dependencies. New IPC channels: `panel:hide`, `panel:show`, `panel:openMain`, `system:hotkeyStatus`, `system:suspendHotkey`, `system:notificationStatus`, `capture:submit`, `capture:undo`, `capture:recent`, `meetings:notesStatus`, `meetings:checkProviders`, `meetings:findNotes`, `meetings:importNotes`, `meetings:getNotes`. New broadcasts: `app:navigate`, `system:hotkeyStatus`, `capture:changed`. New renderer entry: `panel-window.html`.
