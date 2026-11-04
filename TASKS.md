# HeroSpace-inspired features — merged, Final step open

Plan and checklist: `docs/superpowers/plans/2026-11-04-herospace-features.md` (its Progress list is
the source of truth). `feat/herospace-features` was pushed and merged to main through PR #70
(`368aebc`, 2026-11-04), with PR #71 (`2201392`) merged into it first. It is not released; it is in
the `1.3.0-beta.16` candidate.

- [ ] Final step: full verification, packaged preview, demo-mode visual pass, handoff.
  - Done: CI run 41923026422 and Signed macOS beta dry run 41923039435 passed on `4996f9a`. The
    dry run uploaded the signed `signed-macos-beta-1.3.0-beta.16` package and `beta-test-results`.
  - Open: a recorded demo-mode visual pass, from the `beta-test-results` screenshots or a native
    demo run (an agent or Miles).
  - Open: the HANDOFF.md and TASKS.md refresh on branch `claude/project-thread-44twxh`; merging it
    needs Miles's OK.

# System panels — task checklist

Plan: `docs/superpowers/plans/2026-10-20-system-panels.md` (ExecPlan; its Progress and Decision
Log are the source of truth). Spec: `docs/superpowers/specs/2026-10-20-system-panels-design.md`.
PR #44 merged as `5489bbb` on 2026-10-22 and shipped in beta.12 and later.

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
  - Placement and Esc fixes are in (`609350d`, `db10cdb`). Their native re-check is tracked below.
  - Still open, waiting on Miles (by hand, on a current non-test build with an owned profile):
    full-screen click-away, the re-enabled tray icon, and notification delivery. Delivery now
    covers meeting alerts and #70's mail notifications and Dock badge; the first one raises a
    macOS permission prompt.
- [x] Reconcile with the merged #42 (order #43, #42, #44): reconciliation merge `94783c6`, then #44
      merged as `5489bbb`.
  - #42 merged as `768329f` from its final head `e34b93c`, which includes the label commits
    `cb77c10` and `0859738`.
  - `runCompletion` carries the API effort options and the explicit Codex default model
    (`main/services/ai/completion.ts:66` and `:117-125`).
  - A denied panel stream ends with its end marker (`main/platform/ipc.ts:126-143`), covered by
    `tests/platform-ipc.test.mjs:380-393`.
  - Wiring regressions: `tests/quick-capture-wiring.test.mjs:51` and
    `tests/prompt-cache.test.mjs:1006` and `:1565`.
  - The "run REA on a fresh artifact" sub-step has no record. It is now optional (last item).
- [x] Tray panel placement: use the clicked icon's bounds (`609350d`, `tests/tray-anchor.test.mjs`).
- [x] Esc closes a freshly opened panel (`db10cdb`, e2e regression).
- [ ] First keystrokes lost after the hotkey. PR #48 found and fixed a cause: on the first open
      after launch, the capture input stayed disabled while settings and accounts loaded. It merged
      as `ca29afb` and shipped in beta.13. Before the fix the e2e test failed 1 of 10 runs; after
      it, 30 of 30 passed. Still open: a by-hand native check on a build that contains `ca29afb`
      (Miles).
- [ ] Tray click activating DayBoard: cause unresolved. Code inspection found no activation in
      DayBoard or in Electron's tray and panel paths. Needs a by-hand tray click while another app
      is frontmost before choosing a fix (Miles).
- [x] Design system check of the panels against v21 (`1791573676-ee86`) and the live revision
      `1792522028-b5ac`: fixes in `ba10a95`, with before and after screenshots (see `HANDOFF.md`).
- [ ] Claude Design project check: blocked until Miles runs `/design-login` in an interactive
      Claude Code session. Then rerun the `/design-sync` read-only inspection (`list_projects`,
      `get_project`, `list_files`) against the existing DayBoard project.
- [x] After #42 merges, check whether any panel surface shows #42's model or effort presentation:
      done, nothing to change. No panel surface shows model or effort (`renderer/panel/` and
      `renderer/settings/system-panels-settings.tsx`).
- [ ] Native re-acceptance of the tray placement and Esc fixes on a current build.
  - `docs/CODEX-HANDOFF.md` reports a 14/14 demo QA on the `01bb084` package (2026-10-22), with
    tray anchoring fixed before that run. That evidence is not in the repository. Close this item
    once it turns up; otherwise re-run the check on a current build, such as the signed beta.16
    dry-run package from `4996f9a`. Waits on Miles or whoever ran that QA.
  - Obsolete: the interim #43+#44 preview built from `029b97d` at
    `release/interim-029b97d-not-final/`. The final combined #42+#43+#44 tree has shipped since
    beta.12.
  - The `cf890ac` build was kept at `release/cf890ac/`.
- [ ] Optional: run REA on a fresh combined artifact. Nothing records that it ran after the #42
      merge. Waits on an agent on the Mac, if still wanted.

## Found along the way

- The session scratchpad was cleared during the 2026-10-20 usage reset. That removed the
  acceptance profile, the stale `c316117` build copy and the files of the trial worktree. The
  `cf890ac` `release/` build and the evidence in the shared notes folder remain. Retained QA output
  now goes in the ignored `.superpowers/sdd/2026-10-20-system-panels/` or the shared notes folder,
  not the scratchpad.
- Acceptance correction (2026-10-20): the stale QA preview launched at 07:19:27 PDT (14:19:27 UTC; shell PID 81215, app PID 81216; `DAYBOARD_DEMO=1`, scratchpad `demo-profile`, built from `c316117`) was reported stopped at about 07:21 but kept running: the stop command matched an absolute path while the app had been launched with a relative one. It ran until it was stopped by PID with SIGTERM at about 07:47 PDT; its launch task exited with code 0, and a check at 14:48:08 UTC found no QA preview processes. While it ran it likely held ⌃⌥Space and showed a menu-bar icon. No canonical or user-launched DayBoard was touched. At the time (2026-10-20), acceptance used the fresh `cf890ac` preview package and a new empty demo profile; native checks now run on a current non-test build (see `HANDOFF.md`, "Remaining work", item 4).

- Unverified: TextEdit may still have an empty "Untitled.rtf" left from the panel probe. Nothing
  records whether it was closed; Miles to confirm or remove this line.
- The Apple Developer signing answers Miles posted here belong to a different Claude chat.

## Lifecycle changes for release-owner review (updater path unchanged)

- `main/index.ts`: `startSystemPanels()` runs before `createMainWindow()` (registers the hotkey and panel IPC; panels are created lazily).
- `main/index.ts`: `app.on("will-quit", stopSystemPanels)`. `stopSystemPanels()` calls `globalShortcut.unregisterAll()` and then `stopTray()`, so it also removes the menu-bar icon.
- `main/index.ts`: since #43, `updates.startAutomatic()` runs after the main window opens (`:119-121`).
- `main/index.ts`: `activate` ignores floating panels when deciding whether to show the main window.
- Unchanged: `before-quit` save guard, `window-all-closed` (macOS already stays alive with no window), the updater's `prepareForInstall`/quit-and-install path.
- `main/system-panels/index.ts`: the tray is created after settings load when `system.menuBar.enabled` (never in test builds), recreated/removed when that switch changes, and destroyed in `stopSystemPanels()` on `will-quit`.
- `main/system-panels/index.ts`: since #70, `startSystemPanels()` also starts mail notifications and the Dock badge handler (`:113`), which keep their own timers (`mail-notifications.ts`).
- Tray menu "Quit DayBoard" calls plain `app.quit()`, so the existing `before-quit` save/drain guard and updater install path run unchanged. No hide-on-close was added anywhere; panels are hidden windows that close normally on quit.
- Check for Updates stays in the app menu through the existing updater service; no second timer.
- Meeting alerts (`main/system-panels/meeting-notifications.ts`) keep one `setTimeout` for the next alert and, only while alerts are on, a refresh `setInterval`; neither touches quit, install or window lifecycle.

## Integration with PR #42 (done; final head `e34b93c`, merged as `768329f`)

PR #42 edited the body of `ai:run` in `main/handlers/ai.ts`; #44 had moved that body to `main/services/ai/completion.ts` (`runCompletion`). #44 landed second and carried both of #42's behaviours into `runCompletion` (reconciliation merge `94783c6`):

1. API path: `apiPromptOptions(...)` is wrapped in `withProviderOptions(..., effortProviderOptions(provider, resolveFeatureEffort(settings.ai, provider, model.id)))` (`completion.ts:66`).
2. CLI path: for Codex with no configured model, `listCodexModels()` runs first, its result goes to `describeModel`, and `codexModel` goes to `runCliCompletion` (`completion.ts:117-125`).

Wiring regressions exist: `tests/quick-capture-wiring.test.mjs:51` (Quick Capture's AI parse runs through `runCompletion`, like `ai:run`), and `tests/prompt-cache.test.mjs:1006` and `:1565` (`ai:run` with API effort and with the Codex default).
