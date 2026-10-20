# System panels — task checklist

Plan: `docs/superpowers/plans/2026-10-20-system-panels.md` (ExecPlan; its Progress and Decision
Log are the source of truth). Spec: `docs/superpowers/specs/2026-10-20-system-panels-design.md`.

- [x] Task 1: Baseline, plan files and TASKS.md (typecheck, lint pass; 49 renderer + 402 backend tests pass)
- [x] Task 2: Per-window IPC allow-list
- [x] Task 3: Accelerator utilities and macOS shortcut conflict mapping
- [x] Task 4: `system` settings section and in-process settings events
- [x] Task 5: Panel placement
- [x] Task 6: Panel window layer, hotkey manager, menu items and Settings UI
- [x] Task 7: Shared capture logic and AI completion runner
- [x] Task 8: Capture pipeline in main with Undo
- [ ] Task 9: Quick Capture panel UI (in progress: panel not re-shown after a rejected submit)
- [ ] Task 10: Menu-bar icon and menu-bar panel
- [ ] Task 11: Meeting logic and calendar fields
- [ ] Task 12: Up Next card and Meetings settings
- [ ] Task 13: Meeting notifications
- [ ] Task 14: Granola notes import and follow-ups
- [ ] Task 15: Porting doc, fuse proposal, handoff
- [ ] Task 16: Full verification, packaged build, manual acceptance, REA check

## Found along the way

- TextEdit has an empty "Untitled.rtf" left from the panel probe; Miles to close it with Delete.
- The Apple Developer signing answers Miles posted here belong to a different Claude chat.

## Lifecycle changes for release-owner review (updater path unchanged)

- `main/index.ts`: `startSystemPanels()` runs before `createMainWindow()` (registers the hotkey and panel IPC; panels are created lazily).
- `main/index.ts`: new `app.on("will-quit", stopSystemPanels)` — only `globalShortcut.unregisterAll()`.
- `main/index.ts`: `activate` ignores floating panels when deciding whether to show the main window.
- Unchanged: `before-quit` save guard, `window-all-closed` (macOS already stays alive with no window), the updater's `prepareForInstall`/quit-and-install path.
- Planned (Task 10): tray created after startup when enabled and destroyed in `will-quit`; panels are hidden windows that close normally on quit.
