# System panels: Quick Capture, menu-bar Agenda, Meeting-aware Up Next

Design for three DayBoard features in the standalone Electron app (`main` line, 1.3.0-beta.x).
A Glaze-runtime port follows in a separate session; this design keeps that port cheap.

## Intent

Miles wants DayBoard reachable without switching to it. Three moments drive this:

1. A thought arrives while he is in another app, often full-screen ("Call dentist Thursday
   3pm"). He wants it captured in two seconds and to be straight back where he was.
2. He glances at the menu bar to see what's left today and what's next, without bringing the
   whole dashboard forward.
3. Before a meeting he wants the join link and the prep in one place. After it, he wants the
   notes and follow-ups attached without copy-pasting from Granola.

Success: each takes one keystroke or one click, works over full-screen apps and on every
Space, returns focus to where he was, and can be turned off in Settings.

## Goals

- **Quick Capture panel.** A global hotkey (default ⌃⌥Space, changeable) opens a small
  floating panel over any app, including full-screen apps and every Space, on the display under
  the mouse pointer. Enter sends the text through DayBoard's existing AI capture into Google
  Tasks, Apple Reminders or Google Calendar. The panel hides at once on submit, Esc or
  click-away, and focus stays with the previous app. The result is confirmed afterwards with
  Undo.
- **Menu-bar mini Agenda.** A menu-bar icon opens a small panel under it with today's items,
  the Up Next meeting card, recent captures, and a capture box. It shares the panel and hotkey
  infrastructure with Quick Capture.
- **Meeting-aware Up Next.** A card for the next meeting: "starts in 5 min" or "now", a Join
  button, and the existing AI meeting prep. An optional system notification fires shortly
  before start. After the meeting, if a Granola MCP server is configured in DayBoard's MCP
  settings, DayBoard offers to pull that meeting's notes. Notes are kept in DayBoard with the
  event, offered to the Assistant, and their action items become one-click follow-up Tasks or
  Reminders.
- Every feature can be switched off in Settings.

## Non-goals

- Menu-bar-only mode. The Dock icon stays (Miles's choice).
- An offline natural-language date parser. Without AI, the panel shows the small manual form
  (Miles's choice).
- Writing anything into Google Calendar events. Notes stay in DayBoard (Miles's choice).
- A full Assistant chat in the menu-bar panel. Its "Ask" action hands the text to the main
  window's existing `/assistant?prompt=` route.
- Notes providers other than Granola. The adapter interface allows more later.
- Changing release or fuse configuration. The fuse proposal is a separate note for Miles.

## Anti-goals (failure even if it "works")

- The panel leaves DayBoard frontmost, or drags the main window to the current Space.
- A panel window gets the main window's IPC reach. Panels get a narrow allow-list enforced in
  the main process.
- Any Granola path slows startup, launches MCP servers in the background, needs network in
  `npm test`, or breaks when no Granola server is configured.
- A capture lands in the wrong place or fails while looking like success.
- A hotkey that collides silently.

## Constraints

- Electron 44.4.4, electron-builder 26.15.3, React 19, TanStack Query, Tailwind 4 (verified in
  the installed packages).
- Every window keeps `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and
  the one shared preload `electron/preload.ts`.
- New windows go through `hardenWindow` → `registerTrustedWindow` (`main/window.ts:43-54`,
  `main/platform/ipc.ts:39-60`); new HTML entries go in `ENTRIES`
  (`main/platform/window-policy.ts:4`) and `rollupOptions.input` (`electron.vite.config.ts`).
- Creates and `ai:run` are in `PAID_CHANNELS` (`shared/license-policy.ts`); creates call
  `assertNotDemo`. The panel must show license and demo errors legibly.
- New settings keys are dropped by `normalizeSettings` unless added to the schema, defaults and
  normalizer (`main/services/settings-store.ts`, `main/shared-types.ts`).
- AI capture parsing is AI-only today (`renderer/components/capture-dialog.tsx`); `ai:run`
  throws when no provider is chosen.
- DayBoard's MCP client supports stdio and HTTP with static headers only; tool output is capped
  at 12,000 characters (`main/services/ai/mcp-client.ts`).
- No `Notification`, `Tray` or `globalShortcut` use exists yet.
- AGENTS.md: no push, PR, release or signing without Miles's approval; no stubs or mock data in
  place of behaviour; renderer libraries are `devDependencies`.
- No reverse engineering of Claude.app or Granola. Design comes from Electron's documented APIs
  and Granola's public MCP tool descriptions and output.

## Decisions made by Miles

| Question                      | Answer                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Where pulled Granola notes go | Kept in DayBoard with the event, plus one-click follow-up Tasks/Reminders from action items |
| Capture without AI            | Small manual form in the panel; no new dependency                                           |
| Menu-bar-only mode            | No; keep the Dock icon                                                                      |
| Default hotkey                | ⌃⌥Space, changeable in Settings                                                             |
| After Enter in Quick Capture  | Hide now; parse and create in the background; confirm afterwards with Undo                  |
| Granola output sample         | One read-only `list_meetings` + `get_meetings` call allowed; only the structure is kept     |
| Probe before UI               | Yes (done; results below)                                                                   |

## Probe results (2026-10-20, Electron 44.4.4, this Mac)

A throwaway scratchpad app, not committed:

- `BrowserWindow({ type: "panel", frame: false, … })` with `setAlwaysOnTop(true, "floating")`
  appeared over full-screen TextEdit on its Space. `isVisibleOnAllWorkspaces()` was already
  true without calling `setVisibleOnAllWorkspaces`, matching Electron's docs for the `panel`
  type. No process-type transform, so the Dock icon never blinked.
- `show()` focused the panel and it received every keystroke while TextEdit stayed the
  frontmost app. After Esc → `hide()`, TextEdit had the keyboard again. Click-away (`blur`)
  hid it the same way. The probe's ordinary window on another Space was not pulled across.
- A `Tray` click gave `getBounds()` in screen coordinates; a panel placed under it opened
  focused, with TextEdit still frontmost.
- `localStorage` is shared between different `file://` window entries.
- `globalShortcut.register("Command+Space")` returned `true` although Spotlight owns it:
  registration success does not prove the shortcut reaches DayBoard.
- `Notification.show()` from the unsigned dev binary failed with `UNErrorDomain error 1`.
- On this Mac the macOS input-source shortcuts (⌃Space, ⌃⌥Space) are turned off, so ⌃⌥Space is
  free here. On a default macOS install ⌃⌥Space is "Select next source in Input menu".

## Design

### 1. Shared panel layer (lands first)

**One renderer entry, two panel windows.** `panel-window.html` → `renderer/panel/index.tsx`.
The hash selects the surface (`#capture`, `#menubar`). Each is a React root with
`QueryClientProvider`, `TooltipProvider` and `Toaster`, like the settings window.

**Panel window factory** (`main/system-panels/panel-window.ts`, Electron-specific). Panels are
created lazily on first use, never at startup, so e2e `firstWindow()` is unchanged. The `activate`
handler (`main/index.ts`) currently returns when any window is visible; it changes to look at the
main window only, so clicking the Dock icon while a panel is open still brings the dashboard
back. Options proven by the probe: `type: "panel"`, `frame: false`,
`resizable: false`, `skipTaskbar: true`, `hiddenInMissionControl: true`,
`fullscreenable: false`, `show: false`, `setAlwaysOnTop(true, "floating")`, vibrancy
`popover` dropped under Reduce Transparency or Increase Contrast (as `createMainWindow` does).
Hide on `blur`, on Esc (`panel:hide`) and on submit. Placement is a pure function in
`shared/panel-placement.ts`: capture panel centred in the upper third of the display nearest
`screen.getCursorScreenPoint()`; menu-bar panel under `tray.getBounds()`, clamped to that
display's work area.

**IPC allow-list.** `registerTrustedWindow(contents, entryUrl, options?: { channels:
ReadonlySet<string> })`. With a set, the `ipcMain.handle` wrapper and `streamStart` reject any
other channel ("This DayBoard window can't use <channel>"). Main and Settings windows pass no
set and are unchanged. The panel set lives in `main/system-panels/panel-channels.ts`:

- Reads: `settings:get`, `app:isDemo`, `accounts:getStatus`, `agenda:getScope`,
  `agenda:getState`, `tasks:list`, `reminders:list`, `calendar:list`, `calendar:listRange`,
  `ai:availability`, `license:status`, `nativeTheme:getInfo`, `systemPreferences:getAccentColor`
  (plus whatever theme/appearance reads the shared hooks need, found by the builder).
- Capture: `capture:submit`, `capture:undo`, `capture:recent`.
- Meeting prep: `ai:run` (stream), `mail:related`.
- Meetings: `meetings:notesStatus`, `meetings:findNotes`, `meetings:importNotes`,
  `meetings:getNotes`, `tasks:create`, `reminders:create` (follow-ups).
- Panel control: `panel:hide`, `panel:openMain` (focus main window at a route),
  `window:openSettings`, `app:openExternal`.

A unit test asserts the exact set. Broadcasts (`settings:changed`, `data:changed`) still reach
panels.

**Settings.** A new top-level `system` section, not under `ai.features` (the AI tab hides
feature switches when AI is off, and Quick Capture must work without AI):

```ts
system: {
  quickCapture: {
    enabled: boolean;
    hotkey: string;
  } // true, "Control+Alt+Space"
  menuBar: {
    enabled: boolean;
  } // true
  meetings: {
    upNext: boolean; // true
    notify: boolean; // false (opt-in)
    notifyMinutesBefore: 1 | 2 | 5 | 10; // 2
    notesImport: boolean; // true
  }
}
```

UI: "Menu Bar & Shortcuts" and "Meetings" FieldSets in `renderer/settings/general-tab.tsx`.
The hotkey field records a combination, shows macOS symbols, and validates with pure
`shared/accelerator.ts` (needs at least one of ⌃⌥⌘ plus a key; rejects bare keys and common app
shortcuts such as ⌘Q/⌘W/⌘C/⌘V). AI prep text in the card stays gated by
`ai.features.meetingPrep`.

**Hotkey manager** (`main/system-panels/hotkey.ts`). Registers after `whenReady`, re-registers
on settings change, `unregisterAll` on `will-quit`. Conflicts are detected two ways, because
`register` alone is not proof (probe):

1. `globalShortcut.register` returns `false` → "In use by another app."
2. Before registering, DayBoard reads macOS's enabled symbolic hotkeys
   (`defaults export com.apple.symbolichotkeys -` piped through `plutil -convert json`, via
   `execFile`, no shell) and a pure mapper turns each enabled entry's
   `(ascii, keyCode, modifierMask)` into an accelerator. A match → "macOS uses ⌃⌥Space for
   Select next source in Input menu. Turn it off in System Settings → Keyboard → Keyboard
   Shortcuts, or choose another shortcut." Spotlight, input sources, Mission Control and
   screenshot shortcuts are covered by the table. If reading fails, DayBoard skips this check.

Status is exposed as `system:hotkeyStatus` → `{ accelerator, registered, conflict?: string }`.

### 2. Quick Capture panel ("hide now, confirm after")

- The hotkey toggles the capture panel, focused on a one-line input.
- **AI capture on** (`ai.enabled && ai.providerChosen && ai.features.capture`, the existing
  capture opt-out included, enforced in main): Enter sends `capture:submit { text }` and the
  panel hides immediately. Main runs the pipeline:
  1. Record the account scope (`requireAgendaScope()`) and `availableKinds` (shared, from
     Google connection, Reminders access and source switches) at submission.
  2. AI parse with the existing `CAPTURE_SYSTEM`/`buildCapturePrompt`, through the same
     runner `ai:run` uses (refactored into a callable function, not duplicated).
  3. Strict validation (`parseDraftStrict` in `shared/capture.ts`): an unknown or unavailable
     kind, a malformed date or time, or an event without a date is not "fixed up". The capture
     goes to the manual form instead, prefilled with what parsed cleanly, with a short reason.
     The lenient `parseDraft` stays for the ⌘N dialog, where Miles reviews the draft anyway.
  4. Revalidate the account scope inside the existing write guard (`trackProductivityWrite`
     plus the same scope check the edit handlers use), then create via the same service
     functions as `tasks:create`/`reminders:create`/`calendar:create`, which now return the
     created item's identity. Broadcast `data:changed`. If the account changed since
     submission, nothing is created and the capture fails with "Your account changed. Check
     the details and add it again."
  5. Confirm: macOS notification "Added to Reminders · Thu 3:00 PM" with an Undo action, and
     an entry in the menu-bar panel's "Recent captures" (last 5, Undo for 10 minutes).
- **AI off or unavailable:** the panel opens on the small manual form (title, type, date, time,
  end time), reusing the field component extracted from `capture-dialog.tsx`. Enter sends
  `capture:submit { draft }`; the panel hides and the same confirm step runs.
- **Failure** (license, demo, provider, network, unparseable): the capture panel reopens on the
  pointer's display with the original text and the error. If parsing failed, it reopens on the
  manual form with the text as the title. A failure never shows only as a notification.
- **Undo** (`capture:undo { id }`) uses a single-use, 10-minute receipt (account scope +
  container + item identity, kept in memory, never rebuilt from the title). It deletes through
  the existing delete services only if the current account scope still matches, once, and
  updates the recent list. The notification's Undo action calls the same guarded operation.
- **Job lifetime:** `capture:submit` awaits the whole pipeline in main, so the existing
  operation tracking and quit draining cover it; the renderer does not wait for it. Late
  failures are queued in the panel and never replace text Miles is typing.
- `capture:submit` and `capture:undo` are added to `PAID_CHANNELS`; both refuse demo mode.
- The in-window ⌘N dialog keeps its current review flow.

### 3. Menu-bar mini Agenda

- `main/system-panels/tray.ts`: a `Tray` with a monochrome template image
  (`resources/tray/trayTemplate.png` + `@2x`, drawn from the DayBoard mark in `brand/`,
  imported with electron-vite's `?asset` suffix so the files land in `out/` and ship inside
  `app.asar`).
  Left-click toggles the panel under the icon; right-click menu: Open DayBoard, Quick Capture,
  Settings…, Quit DayBoard.
- Panel (about 360 × 520), top to bottom: Up Next card; Today (overdue count, today's timed
  events and due to-dos via `buildTodos` and `buildAgenda`; click opens the item in the main
  window); Recent captures with Undo; a capture box (same `capture:submit`) with an "Ask
  Assistant" action → `panel:openMain` to `/assistant?prompt=…`.
- Same blur/Esc rules; data via the same React Query channels, kept fresh by `data:changed`.

### 4. Meeting-aware Up Next

**Shared logic** (`shared/meetings.ts`, no Electron or DOM imports):

- `extractJoinUrl(event)`: `meetLink` first, then the first Zoom, Microsoft Teams, Webex,
  Whereby or Google Meet https URL in `location`, then `description`.
- `isMine(event, accountEmail)`: the event's calendar has Google's `primary` flag (this also
  covers the legacy `"primary"` fallback calendar), or the account email is the organizer or an
  attendee. Ownership and `selfResponse` are computed in `eventToItem` from the raw attendee
  list, before the self attendee is filtered out and the list is capped. Events on shared or
  subscribed calendars where Miles isn't invited are not his meetings.
- `isMeeting(event)`: timed, mine, not declined (`selfResponse !== "declined"`, taken only
  from the primary calendar's copy), and has a join URL or at least one other attendee.
- Copies of one occurrence across calendars collapse by `iCalUID` plus occurrence start
  (instances of a recurring series share an `iCalUID`, so the start keeps them apart), with
  calendar ID + event ID as the fallback identity. Alerts use the same identity.
- `pickUpNext(events, now)`: the in-progress meeting if any, else the next meeting starting
  within 12 hours; returns `{ event, phase: "now" | "soon" | "later", minutesUntil }`.
- `justEnded(events, now)`: the most recent meeting that ended within the last 3 hours.
- `nextAlert(events, now, minutesBefore, sent)`: the next alert time and event.

**Card** (`renderer/components/meeting-card.tsx`): at the top of the Agenda view (`/`), above
the Priorities card, and in the menu-bar panel, when `system.meetings.upNext` is on. Title,
time, "Starts in 5 min" / "Now · ends in 20 min", Join (via `app:openExternal`), attendee
count, and, with AI and `meetingPrep` on, the cached prep from the existing
`dashboard:prep:v1` storage (shared across windows, per the probe) with a "Prepare" button
reusing the existing generation. After the meeting the card shows "Get notes from Granola"
when a provider is known. The sidebar footer's Up Next is unchanged.

**Notification** (`main/system-panels/meeting-alerts.ts`). When `notify` is on, the Calendar
source is enabled and Google is connected, a main-process scheduler reads events with
`listEventsBetween` (same visibility rules as `calendar:list`), refreshes every
`general.refreshMinutes` and on settings or account changes (in-process events, since those
arrive as separate notifications, not `data:changed`), cancels its timer on any change, and
discards fetch results that finish after a newer refresh started. It keeps one timer for the
next alert.
"Starts in 2 min" with a Join action when a join URL exists; clicking opens the menu-bar panel.
One alert per event id + start time. Demo mode never schedules. If macOS refuses delivery
(`failed` event), Settings → Meetings shows "macOS didn't deliver DayBoard's notification.
Check System Settings → Notifications." The unsigned dev binary cannot deliver notifications
(probe); acceptance runs on the ad-hoc packaged test build and, if that is also refused, waits
for the Developer ID signed beta.

**Notes import** (`main/services/meeting-notes/`):

- **Provider detection without background launches.** When Miles tests an MCP server
  (`mcp:test` connects and lists tools; `mcp:save` only stores the configuration), DayBoard
  records whether its tools include both `list_meetings` and `get_meetings` (Granola's public
  tool names) in `userData/meeting-notes/providers.json`, keyed by server ID plus a hash of the
  server's command/arguments/URL, so editing the server invalidates the record. The card offers "Get notes from Granola" only for an
  enabled server recorded as Granola. A "Check MCP servers for meeting notes" button in Settings
  → Meetings runs detection on demand. Nothing launches an MCP server unless Miles clicks.
- **Granola output** (from the approved sample): text containing
  `<meetings_data …><meeting id="<uuid>" title="…" meeting_at="<ISO-8601 with offset>"
url="https://notes.granola.ai/d/<uuid>" …>` elements with XML-escaped attributes;
  `get_meetings` adds a Markdown `<summary>` with `# Heading` sections. Action items appear under
  a "Next Steps"-style heading as `- **Item**` bullets with an indented description line.
  Granola titles are AI-written and usually differ from the calendar title.
- **Matching:** `list_meetings { time_range: "custom", custom_start, custom_end }` over the
  event's local date. Parse `<meeting>` attributes (decode entities). Primary signal:
  `meeting_at` within [event start − 10 min, event end + 5 min]. Tie-break by title-token
  overlap. Exactly one match → use it; otherwise the card lists up to five candidates
  (title and time) to pick.
- **Fetch:** `get_meetings { meeting_ids: [id] }`, through a call path with a 60,000-character
  cap instead of the assistant's 12,000 that reports the tool's `isError` and truncation
  separately (the assistant formatter folds errors into text). An error or empty result is
  never stored as notes. Store the `<summary>` text, or the whole result if no summary
  element exists.
- **Storage:** `userData/meeting-notes/notes.json` keyed by account scope + calendar ID +
  event ID, written with the existing `file-store` serial queue and atomic writes, like
  assistant history. Record: `{ scope, calendarId, eventId, provider: "granola",
providerMeetingId, providerUrl, title, importedAt, text }`. Reads return only the current
  scope's records; an import that finishes after an account change is discarded. Demo mode
  reads and writes nothing.
- **Display:** a "Meeting notes" section in the event detail (rendered as plain text with
  Markdown headings and bullets only, never HTML) and a collapsed preview on the card.
- **Follow-ups:** action items come from the notes. With AI on, `ai:run` returns a JSON list.
  With AI off, the heuristic takes bullets under headings such as "Next Steps", "Action
  items", "To do" or "Follow-ups", using the bold text as the title. Each item has "Add as
  Task" / "Add as Reminder" via the existing create channels. Nothing is created without a
  click.
- **Assistant:** notes for events already in the Assistant snapshot are appended to that
  event's snapshot line, truncated to about 1,500 characters and passed through `oneLine`.
- **Untrusted content:** notes are source data. They are never rendered as HTML and are fenced
  in prompts the same way snapshot data is.
- **Connecting Granola:** Granola's hosted MCP server needs OAuth, which DayBoard's HTTP
  transport lacks. The Settings → MCP hint suggests a stdio bridge command that proxies the
  hosted server unchanged (tool names preserved). Unverified until Miles configures it.

### 5. Portability

Framework-agnostic (no `electron` import; unit-tested): `shared/meetings.ts`,
`shared/panel-placement.ts`, `shared/accelerator.ts` (including the symbolic-hotkey mapper),
`shared/capture.ts` (`parseDraft`, `availableKinds`, confirmation text),
`main/services/meeting-notes/granola-parse.ts`, `match.ts`, `action-items.ts`, the panel
allow-list, and the React components. Electron-specific: `main/system-panels/*`
(`globalShortcut`, `Tray`, panel `BrowserWindow` options, `screen`, `Notification`), the
`registerTrustedWindow` allow-list hook, and the `defaults`/`plutil` read.
`docs/porting-system-panels.md` lists both sides and the Glaze equivalents to look up.

## Verification plan

- Unit tests (offline `npm test`): join-URL extraction, `isMine`, `isMeeting`, de-duplication,
  `pickUpNext`, `justEnded`, `nextAlert`, placement, accelerator validation and display,
  symbolic-hotkey mapping, `parseDraft`/`availableKinds`, Granola parsing and matching against
  synthetic fixtures shaped like the sample, action-item extraction, settings normalisation,
  panel allow-list (allowed, rejected, stream), capture pipeline with a fake runner and fake
  services (success, parse failure, create failure, undo).
- Existing checks: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run build`, `npm run test:e2e`.
- Manual with screenshots: hotkey from a normal and a full-screen app; display under the
  pointer; Esc, click-away and submit keep focus in the previous app; tray panel under the icon;
  conflict message for a taken shortcut; switches remove hotkey, tray and card; notification
  on the ad-hoc packaged build.
- REA `analyze_javascript_application` (`detail: "summary"`) on the built `app.asar`: shipped
  IPC channels, preload surface and the three window kinds match this design.

## Left to the builder

- Vibrancy material, dimensions and typography within `docs/MACOS-DESIGN.md` tokens.
- Wording of empty states and errors, following existing copy.
- The exact theme/appearance reads the panel needs in its allow-list.

## Calls I made (Miles to check)

1. Notifications are opt-in, 2 minutes before when on.
2. A "meeting" is a timed, not-declined event of Miles's (primary calendar, or he's invited)
   with a join link or another attendee.
3. The Up Next card goes at the top of Agenda above Priorities, and in the menu-bar panel; the
   sidebar footer stays.
4. Meeting notes are stored as local JSON like assistant history, not Keychain-encrypted.
5. Settings live in a new General-tab section, not the AI tab.
6. Granola detection happens only when Miles saves or tests an MCP server, or clicks "Check".
7. Undo is available for 10 minutes from the notification and the menu-bar panel.
