# Agenda implementation and verification

Baseline: `fe4242e`. Current source is the project root, renamed from Work Dashboard during implementation. App ID remains `dashboard-local-25d26qqt`.

## Implemented

- Shared Agenda for the home and existing Calendar route, with Today/Next 7 days, date navigation, source layers, search, compact briefing, home AI composer, and collapsed overdue/undated sections.
- Source-aware rows, accessible row actions, task details, three manual focus choices, completion rollback and undo.
- Independent source failures, stale results, coverage indicators, pagination, foreground/minute date updates, local-day and multi-day handling.
- Detail suggestions for related email/events and duplicate records. Duplicate links are reversible local associations; source records stay separate.
- Confirmed calendar-block preview using date, duration, selected calendars, and 9 AM–6 PM availability. Due dates remain independent of calendar blocks. The backend checks source identity and conflicts, persists a request marker, and uses stable Google event IDs for retry recovery.
- Account-scoped local focus, duplicate links, and calendar links in an atomic user-data store. No source data migration.

## Automated checks

Run `npm test` for disposable, offline tests. The backend harness compiles the real handlers and store while replacing native IPC, provider, and file boundaries with synthetic fixtures. It never loads real credentials or provider data.

- Agenda fixtures: provider identity, overlapping/overnight events, all-day exclusive end, overdue/undated/timed grouping, earlier-today deadlines, source/search filtering, DST/offset ordering, availability, related-item suggestions.
- Backend fixtures: local date ranges in Los Angeles and Tokyo, scoped persistence and restart, repeat confirmations, transient remote errors, conflict cleanup, local save failure after remote creation, malformed input rejection.
- HTTP adapter fixtures: list and task pagination, truthful caps, limited-calendar access, deterministic event IDs and conflict recovery.

Required production validation is `npm run format` followed by `npm run verify`. Glaze verify runs lint, types, and build and publishes the checked build to the managed app runtime. Then `npm run launch`.

## Runtime evidence and remaining gate

Observed in the running app on September 22, 2026: Agenda, source layers, provider composer, collapsed briefing, today's timed reminder and event, anytime tasks, and collapsed backlog fit in the first screen. A generated compact briefing was visible. The rename and concurrent AI/calendar Settings edits were preserved.

The final keyboard/accessibility and retry fixes were built after that visual inspection. Computer Use became unavailable when the task was interrupted. Final native interaction checks remain pending reattachment:

1. Search and clear; Today/Next 7 days and date navigation; expand/collapse backlog and briefing.
2. Keyboard focus/arrow/Enter and independently accessible checkboxes/buttons; narrow-window layout.
3. Open details, verify duplicate source labels, pin/unpin and confirm persistence after relaunch; restore test preference changes.
4. Preview a future calendar block, verify selected date/time/source and cancel without creating an event.
5. Disabled/unavailable Calendar retains healthy tasks/reminders (offline fixtures cover model and range rejection; native Settings flow remains to inspect).

No live tasks were completed, emails sent, or calendar events created by the implementation audit. Provider writes are covered with synthetic fixtures, not claimed as production runtime proof.

## Maintenance boundaries

Keep one shared query cache and invalidate calendar-range queries by the `calendar` prefix. Keep local calendar-date conversion independent of UTC transport timestamps. Never update the committed store cache before an atomic write succeeds. Only discard pending calendar requests before a confirmed absence of remote creation; preserve ambiguous requests for stable-ID recovery. Do not use title equality to merge provider records.
