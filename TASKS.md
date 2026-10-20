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
- [x] Task 9: Quick Capture panel UI
- [x] Task 10: Menu-bar icon and menu-bar panel
- [x] Task 11: Meeting logic and calendar fields
- [x] Task 12: Up Next card and Meetings settings
- [x] Task 13: Meeting notifications
- [x] Task 14: Granola notes import and follow-ups
- [x] Task 15: Porting doc, fuse proposal, handoff
- [ ] Task 16: Full verification, packaged build, manual acceptance, REA check (automated checks, package, REA and the Codex review fix pass done; native manual acceptance pending — computer-use access was declined)

## Found along the way

- TextEdit has an empty "Untitled.rtf" left from the panel probe; Miles to close it with Delete.
- The Apple Developer signing answers Miles posted here belong to a different Claude chat.

## Lifecycle changes for release-owner review (updater path unchanged)

- `main/index.ts`: `startSystemPanels()` runs before `createMainWindow()` (registers the hotkey and panel IPC; panels are created lazily).
- `main/index.ts`: new `app.on("will-quit", stopSystemPanels)` — only `globalShortcut.unregisterAll()`.
- `main/index.ts`: `activate` ignores floating panels when deciding whether to show the main window.
- Unchanged: `before-quit` save guard, `window-all-closed` (macOS already stays alive with no window), the updater's `prepareForInstall`/quit-and-install path.
- `main/system-panels/index.ts`: the tray is created after settings load when `system.menuBar.enabled` (never in test builds), recreated/removed when that switch changes, and destroyed in `stopSystemPanels()` on `will-quit`.
- Tray menu "Quit DayBoard" calls plain `app.quit()`, so the existing `before-quit` save/drain guard and updater install path run unchanged. No hide-on-close was added anywhere; panels are hidden windows that close normally on quit.
- Check for Updates stays in the app menu through the existing updater service; no second timer.
- Meeting alerts (`main/system-panels/meeting-notifications.ts`) keep one `setTimeout` for the next alert and, only while alerts are on, a refresh `setInterval`; neither touches quit, install or window lifecycle.

## Integration with PR #42 (composer effort/default model, head 319b4b0)

PR #42 edits the body of `ai:run` in `main/handlers/ai.ts`; this branch moved that body to `main/services/ai/completion.ts` (`runCompletion`). Whichever lands second must carry PR #42's two behaviours into `runCompletion`, not take one side:

1. API path: wrap `apiPromptOptions(...)` in `withProviderOptions(..., effortProviderOptions(provider, resolveFeatureEffort(settings.ai, provider, model.id)))`.
2. CLI path: for Codex with no configured model, `listCodexModels()` first, pass the result to `describeModel`, and pass `codexModel` to `runCliCompletion`.

Wiring regression to add at reconciliation: a test that `ai:run` (and Quick Capture's `complete`) go through `runCompletion` with the resolved effort options and the explicit Codex default model.
