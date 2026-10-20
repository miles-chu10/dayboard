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
- [ ] Task 16: Full verification, packaged build, manual acceptance and REA check.
  - Done: automated checks, the package, REA and the Codex review fixes.
  - Native panel-only acceptance ran on 2026-10-20 (see `HANDOFF.md`): 10 checks passed and the
    tray placement check failed.
  - Still open: the tray placement fix, then full-screen click-away, the re-enabled tray icon and
    notification delivery (Miles).
- [ ] Reconcile with the merged #42 (order #43, #42, #44).
  - The trial on interim `302d191` passed every check (see `HANDOFF.md`).
  - Main (#43) is already merged in as `be58946`.
  - #42 is not final: `e0c7604` fixed both P2s, and labels are still being added. After it merges:
    - Merge main and apply the `runCompletion` repair.
    - Keep #42's model-identity imports and `clipSnapshot`, and the union of test lists.
    - `renderer/main/assistant-view.tsx` (seen in a trial on `e0c7604`): keep both conflicting
      blocks, with #42's `mentionEvents` line first.
    - Re-evaluate every conflict against the final #42 rather than replaying earlier trials.
    - Rerun both wiring checks and full validation.
    - Build a fresh artifact from the current lock and run REA on it.
- [x] Tray panel placement: use the clicked icon's bounds (`609350d`, `tests/tray-anchor.test.mjs`).
- [x] Esc closes a freshly opened panel (`db10cdb`, e2e regression).
- [ ] First keystrokes lost after the hotkey: the e2e regression (each reopen path) passes, which
      narrows the cause. Native key routing and test-tool injection remain open hypotheses; check
      by hand.
- [ ] Tray click activating DayBoard: cause unresolved. Code inspection found no activation in
      DayBoard or in Electron's tray and panel paths. Needs a by-hand tray click while another app
      is frontmost before choosing a fix.
- [x] Design system check of the panels against v21 (`1791573676-ee86`) and the live revision
      `1792522028-b5ac`: fixes in `ba10a95`, with before and after screenshots (see `HANDOFF.md`).
- [ ] Claude Design project check: blocked until Miles runs `/design-login` in an interactive
      Claude Code session. Then rerun the `/design-sync` read-only inspection (`list_projects`,
      `get_project`, `list_files`) against the existing DayBoard project.
- [ ] After #42 merges, check whether any panel surface shows #42's model or effort presentation,
      and align it with #42's design.
- [ ] Native re-acceptance of the tray placement and Esc fixes on a fresh build.
  - An interim #43+#44 preview (not final, not launched) is built from `029b97d` and the current
    lock at `release/interim-029b97d-not-final/`.
    - DMG sha256: `87e48b05ed558aaa5c042dd9312f2d367472e7f250650d3a3908d07f1e5f2426`
    - ZIP sha256: `482b571e414447fa6351e7b3d04d4e66ef7583f8f09bc5ff3cf7855b28e2a5f4`
    - Ad-hoc signed, zod 4.6.7, both fixes present in `app.asar`.
  - It is valid for panel-only checks: tray placement, Esc, tray activation and first
    keystrokes. It is not the final combined artifact, which needs the merged #42.
  - The `cf890ac` build is kept at `release/cf890ac/`.

## Found along the way

- The session scratchpad was cleared during the 2026-10-20 usage reset. That removed the
  acceptance profile, the stale `c316117` build copy and the files of the trial worktree. The
  `cf890ac` `release/` build and the evidence in the shared notes folder remain. Retained QA output
  now goes in the ignored `.superpowers/sdd/2026-10-20-system-panels/` or the shared notes folder,
  not the scratchpad.
- Acceptance correction (2026-10-20): the stale QA preview launched at 07:19:27 PDT (14:19:27 UTC; shell PID 81215, app PID 81216; `DAYBOARD_DEMO=1`, scratchpad `demo-profile`, built from `c316117`) was reported stopped at about 07:21 but kept running: the stop command matched an absolute path while the app had been launched with a relative one. It ran until it was stopped by PID with SIGTERM at about 07:47 PDT; its launch task exited with code 0, and a check at 14:48:08 UTC found no QA preview processes. While it ran it likely held ⌃⌥Space and showed a menu-bar icon. No canonical or user-launched DayBoard was touched. Use the fresh `cf890ac` preview package and a new empty demo profile for acceptance.

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
