# HeroSpace-inspired features (ExecPlan)

**Goal:** Bring the 16 HeroSpace (ai.herospace.desktop 0.3.60) capabilities Miles chose into the
standalone DayBoard app, led by HeroSpace's Home ("Up next") page and its docked "Ask Agent" panel.

**Architecture:** Reuse what DayBoard already has: SplitView's unused `inspector` slot for one
right-hand pane (Ask Agent or Calendar peek), `@`-mention chips for attached context, renderer
triage (`{category, reason, task}`) for chips, summaries and suggestions, `meeting-alerts.ts`-style
generation-guarded timers for snooze, follow-up and undo-send, `file-store.ts` JSON stores keyed by
account scope, and `mcp-http-server.ts` `run()`/`runWrite()` as the single tool-call log point.

**Tech stack:** Electron 44, electron-vite, React 19, TanStack Router/Query, Tailwind 4, the
in-repo UI kit, `cmdk` (already a devDependency). No new runtime dependencies.

**Branch:** `feat/herospace-features` in `.claude/worktrees/herospace-features`, off `origin/main`
`6e3c916` (1.3.0-beta.15). Local commits only; no push, PR or release without Miles.

## Purpose / Big Picture

After this work Miles opens DayBoard to a HeroSpace-style Home: a greeting and one-line summary,
the next meeting, a ranked "Needs you" list with age chips, AI-suggested tasks, his tasks and a
Meetings column, with a Today / This week switch. ⌥⌘J docks an Assistant beside any view that
already knows which email or event he is looking at. ⌘K finds or runs anything. Mail shows an AI
chip on every thread and a summary card with one-key Mark done, and can send (with undo), snooze,
remind when nobody replied, and manage newsletters. DayBoard notifies, badges the Dock, remembers
his preferences, logs every agent tool call, shows AI usage, and keeps Notes agents can use.

## Progress

- [x] Phase 0: worktree, baseline (typecheck, lint, 624/624 unit tests pass at `6e3c916`)
- [x] Phase 1 — Shell (`e099687`)
  - [x] 1.1 Command registry, global shortcuts, `?` sheet, ⌃1–9 view jumps
  - [x] 1.2 Docked Ask Agent panel (⌥⌘J) with context chip and contextual prompts
  - [x] 1.3 ⌘K command menu (Tab hands the query to Ask Agent)
  - [x] 1.4 Calendar side-peek (⌥⌘K) sharing the right pane
- [x] Phase 2 — Home ("Up next") at `/`; the current Agenda moves to `/agenda` (`de38a57`)
- [x] Phase 3 — Mail
  - [x] 3.1 Automatic triage, list chips, thread summary card, single-key mail keys (`de38a57`)
  - [x] 3.2 Send, compose, undo send (`de38a57`)
  - [x] 3.3 Snooze and "remind me if no reply"
  - [x] 3.4 Subscriptions manager and unsubscribe
- [x] Phase 4 — System: mail/follow-up notifications, Dock badge, menu-bar "Waiting on you"
      (`b3fdf30`)
- [x] Phase 5 — Agent platform: Memory, Activity log, Usage, Notes (`3645b6f`)
- [x] Phase 6 — Sidebar reorder/hide/counts settings, then browser-style tabs
- [ ] Final: full verification, packaged preview, demo-mode visual pass, handoff

## Decision Log

- Decision: one right pane (SplitView `inspector`) holds either Ask Agent or Calendar peek, as in
  HeroSpace; per-view `DetailsLayout` keeps its own fallback to inline below 440px of content.
- Decision: `AssistantSession` becomes a shared component with `page` and `panel` variants; only
  one instance is mounted (the panel hides on `/assistant`), so history and streams never race.
- Decision: attached context reuses `MentionItem` chips; views publish their current item through a
  small `ViewContext` provider. No new context protocol.
- Decision: Home replaces the Agenda at `/`; the Agenda stays, at `/agenda`, in the sidebar.
- Decision: mail chips and summaries come from the existing triage (`reason`, `task`), run
  automatically for untriaged mail when AI and the triage feature are on (setting, default on).
- Decision: undo send is a main-process outbox (default 5 s, 0 = immediate); pending sends go out
  on quit through the existing write drain, so nothing is silently dropped.
- Decision: snooze removes INBOX now and adds INBOX + UNREAD when due; follow-ups check the thread
  for a newer message from someone else. Both persist per account scope and catch up at launch.
- Decision: usage shows runs and tokens DayBoard recorded; provider plan-percentage bars are out of
  scope (no provider API exposes them to DayBoard).
- Decision: every new write path calls `assertNotDemo`; every new timer, poller and notification is
  off in demo and test builds; new AI prompts get a `demoCompletion` branch.
- Decision (Phase 5): memory, activity, usage and notes are local JSON stores; demo mode writes its
  own `demo-*` files seeded from `demo-data.ts` (the assistant-history precedent), so Notes and
  Memory are usable and testable in demo without touching real files.
- Decision (Phase 5): the in-app Assistant's MCP stays read-only, so it can't save memories.
  Memory comes from the user, from outside agents through `remember` (only with "Allow changes"),
  and from the user's own edits to reply drafts. This keeps email content from planting a memory.
  Memories go into prompts framed as preferences, never instructions.
- Decision (Phase 5): usage is recorded where every AI request finishes (`runCompletion`,
  `runAssistant`) through a dependency-free event, so Quick Capture and learning are counted too.
- Decision (Phase 6): only the main sidebar views reorder or hide; the AI group follows its
  feature switches. Hidden views stay in ⌘K. Tabs keep a route and search each, the strip appears
  from two tabs, ⌘W closes a tab while there are two or more, and tab state is per-window
  localStorage (not per-tab scroll or selection).

## Validation and Acceptance

Per sub-phase: unit tests for each new pure module and main service (`tests/*.test.mjs` with
`loadTs`, renderer libs under tsx and listed in `package.json`), handler payload-validation tests,
and an e2e spec in demo mode. Per phase: `npm run format:check`, `npm run typecheck`,
`npm run lint`, `npm test`, `npm run test:e2e`, then a demo-mode visual check of the built app.

## Idempotence and Recovery

Each sub-phase is one or more local commits on `feat/herospace-features`. New settings fields are
normalized with defaults, so older settings files load unchanged; new stores start empty.
