# DayBoard standalone handoff

Read `docs/EXECPLAN.md` for the objective and `docs/RELEASE.md` for build/release gates.
`docs/CODEX-HANDOFF.md` is a 2026-10-28 snapshot; where it differs from this file, this file is
newer.

## Current state

Snapshot of 2026-11-04. It rests on that day's audit of release, features, website and Glaze
(each correction re-checked with `gh`, `git` and `curl`) and on that day's session on Miles's Mac.
Open items, with what each waits on, are under "Remaining work".

### Releases

- **Latest published beta: `1.3.0-beta.15`** (prerelease `v1.3.0-beta.15`). Signed macOS release
  run 41786199314 published it on 2026-11-04 at 07:07 UTC from `67fc534`. Notes:
  `docs/release-notes-1.3.0-beta.15.md`.
- Earlier signed betas: `v1.3.0-beta.13` (2026-10-28 04:49 UTC, run 40633492619, `ca29afb`) and
  `v1.3.0-beta.12` (2026-10-22, run 39745730147, `9e32075`). Beta.12 was the first Developer ID
  signed, notarized and self-updating release. For beta.12, beta.13 and beta.15, every
  `SHA256SUMS.txt` line matches GitHub's asset digest, and each `latest-mac.yml` gives its version
  and the matching ZIP and DMG sizes.
- `v1.3.0-beta.14` was tagged on `a46dcf3` but never published. Release run 40954103723 failed in
  its tests (`e2e/system-panels.spec.ts:225`, "Escape hides a freshly shown menu-bar panel")
  before credentials were loaded. The same content shipped as beta.15 (PR #65). The cause of that
  failure is unproven.
- Beta.13 added #50 (`151ce36`, README launch loop), #51 (`10fef65`, sandboxed Mac App Store
  edition build, phase 1, dormant), #52 (`366e85c`, main brought up to the live site), #53
  (`dc864a6`, README describes beta 12 truthfully), #49 (`4c46d5b`, side-panel Suggested row) and
  #48 (`ca29afb`, the tag commit: Quick Capture keeps the first keystrokes, and release-check
  diagnostics name the failing artifact and command). Beta.15 added #54 to #59 and #62 to #65,
  including Electron 44.10.0 (#57).

### Release and update path

- Since beta.12 every published beta is Developer ID signed (team `LGJS5APK9X`), notarized and
  stapled by the **Signed macOS release** workflow, which runs when a `v` tag is pushed. It builds a
  free release (`DAYBOARD_RELEASE=1` with `DAYBOARD_LICENSE=off`), so every feature, AI included,
  is free in published betas. Official builds check for and download updates in the background and
  install on restart or quit. The manual **Signed macOS beta** workflow is an updates-off signing
  dry run. Local `npm run package:preview` builds are still ad-hoc signed. See `docs/RELEASE.md`.
- Tags are pushed only from Miles's Mac, and each push needs his approval.
- The `macos-release` environment allows `main` and `v*` and has no reviewer rule. It holds the
  secrets `DAYBOARD_GOOGLE_OAUTH_JSON` and `MACOS_NOTARY_KEY_P8` (set 2026-10-20) and
  `MACOS_CERTIFICATE_P12_BASE64` and `MACOS_CERTIFICATE_PASSWORD` (set 2026-10-22), and the
  variables `APPLE_TEAM_ID`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Miles requires approval at
  the time of each credential creation, storage or import step.
- Users on beta.11 or earlier install once by hand from the first-install DMG.
  `website/download.html` and the live getdayboard.com/download link the beta.15 DMG. Later betas
  arrive in the app.
- In-app updates on record, both on Miles's own installed app, not in isolated QA state:
  - beta.12 to beta.13 (A10): reported passed at 05:06 UTC on 2026-10-28 in
    `docs/CODEX-HANDOFF.md`. Not re-verified since.
  - beta.13 to beta.15 on 2026-11-04 (see "Installed app" below).

### main and the beta.16 candidate

- `main` is `4996f9a`, versioned `1.3.0-beta.16`, and **not released** (beta.17 fix below). Merged since beta.15: #60
  (standalone layout matched to the Glaze app), #66 (Codex handoff doc), #67 (DayBoard Pro as a $5
  AI-only unlock with Stripe Managed Payments), #68 (MCP source writes no longer license-gated),
  #70 with #71 (HeroSpace features), #72 (release fixes after the repository rename), and the
  website PRs #69 and #73.
- PR #70 (`368aebc`, 2026-11-04) adds the 16 HeroSpace-inspired features Miles chose: ⌘K, a docked
  Ask Assistant panel with context chips, a calendar peek, a Home ("Up next") page, mail triage
  chips and summaries, send with undo, snooze and "remind me if no reply", a subscriptions manager,
  mail notifications and a Dock badge, a menu-bar "Waiting on you" feed, single-key mail shortcuts
  and a `?` sheet, agent memory, an MCP activity log, a usage dashboard, Notes, sidebar
  order/hide/counts settings and browser-style tabs. PR #71 (`2201392`) merged into its branch
  first: one-click unsubscribe refuses redirects, and DayBoard asks before saving a learned memory.
  Plan, decisions and commits: `docs/superpowers/plans/2026-11-04-herospace-features.md`.
- PR #72 (`4996f9a`): `scripts/macos-release.mjs` compares the repository name without regard to
  letter case (`a381805`; the repository is now `miles-chu10/DayBoard`), and the signed-package
  smoke test opens Home and Notes.
- Checks on `4996f9a`: CI run 41923026422 passed. Signed macOS beta dry run 41923039435 passed
  format, typecheck, lint, unit and e2e tests, built, signed and notarized the package, checked
  Gatekeeper and ran the signed-package smoke tests. It uploaded `signed-macos-beta-1.3.0-beta.16`
  and `beta-test-results` (screenshots with fictional data). Both expire on 2026-11-18.
- **Beta.16 failed and is not published.** Miles pushed `v1.3.0-beta.16` (tag object `a90c688…`,
  pointing at `4996f9a`) on 2026-11-04. Signed macOS release run 41932746810 stopped at "Test
  before loading release credentials": in `e2e/ui-audit.spec.ts`, the Assistant's @ menu showed
  item dates squeezed to 25–27px. The menu is as wide as the composer, the audit ran at whatever
  window size the runner's display allowed, and the dry run's runner had passed it. Nothing was
  signed or published. The tag stays, and the fix ships as `1.3.0-beta.17` from branch
  `fix/beta16-release-audit`: the @ menu uses ⌘K's row layout, and the audit checks the composer
  menus at 800 and 1440 px windows.

### Installed app on Miles's Mac

- `/Applications/DayBoard.app` updated itself from `1.3.0-beta.13` to `1.3.0-beta.15` through its
  own in-app updater on 2026-11-04. It was launched, the updater staged beta.15 about 30 s later,
  the app quit normally, and ShipIt logged "Installation completed successfully" at 22:33:17 UTC.
- The staged bundle (before install) and the installed app (after) both passed
  `codesign --verify --deep --strict`, `spctl` ("accepted, source=Notarized Developer ID", origin
  "Developer ID Application: Miles Chu (LGJS5APK9X)") and `stapler validate`.
- Before the update, a hash-verified private backup of the beta.13 app and its userData,
  preferences, caches and logs was taken at `~/.dayboard-backups/2026-11-04-pre-update-beta13/`,
  and a restore rehearsal matched byte for byte. Keychain items are not in the backup. No hash
  manifest is stored with it.
- Google continuity: just before the update, beta.13 rewrote the encrypted `oauth-tokens.json` (a
  successful refresh, no warnings). Beta.15 started with no Google or Keychain warnings and wrote
  `agenda-state.json`. Beta.15's own first token refresh is not yet observed, and Miles has not yet
  confirmed his accounts visually.
- On that launch the installed app's MCP server could not bind `127.0.0.1:54809` (`EADDRINUSE`). A
  separate electron-vite dev instance from `~/code/dayboard-license-test` (profile "DayBoard
  License Test", started at 13:14 local time by another session) held the port.

### Website

- getdayboard.com matches `website/` on main at `4996f9a`. The last website change is `df36586`
  (PR #73, merged 2026-11-04 21:55 UTC), so the `dayboard-website` Worker was deployed after it.
  That is inferred from the live content. The deploy time and Worker version were not checked
  (`npx wrangler deployments list` in `website-worker/`).
- The Road Map (PR #36) is live as the homepage's `#roadmap` section. There is no `/roadmap` page;
  it returns 404.
- `/download` links the beta.15 DMG, `SHA256SUMS.txt` and the release notes. The purchase URL is
  unset (`buyUrl: ""` in `website/assets/site.js`), so the Get DayBoard Pro button stays hidden
  and `/pricing` says checkout isn't open yet.
- Waitlist: `billing/migrations/` holds 0001 to 0005. `0005_email_suppressions.sql`, reconstructed
  from the live schema, was added in `e692432` on 2026-10-20. No repository code writes
  `email_suppressions` or mails the list; the only email is the optional owner notice for each new
  signup (`SIGNUP_EMAIL`). The live forms post to `https://api.getdayboard.com/v1/waitlist`.
  Production D1 and that endpoint were not checked in the 2026-11-04 audit.

### Payments

- On 2026-11-04 Miles set the model (`docs/EXECPLAN.md` line 13): DayBoard Pro is $5 once and
  unlocks AI only, with a 7-day AI trial from the first AI use, a 30-day offline grace, Stripe
  Managed Payments, 3 devices and 14-day refunds. Stripe account setup, deploy and public launch
  remain gated.
- On main, PR #67 (`a48d205`) made DayBoard Pro a $5 AI-only unlock with Stripe Managed Payments,
  and `main/services/license/config.ts` sets `TRIAL_DAYS = 7`. No published build contains #67.
- A separate project thread, "Get DayBoard ready to take payments", owns the payment flow.

### Glaze

- `glaze` is at `8645628`, version 1.2.6: PR #61 merged on 2026-11-04 at 03:40 UTC on top of the
  1.2.5 baseline `5bc351e`. 1.2.6 adds an About note in Settings → General that points to
  getdayboard.com, the dependency versions that passed Glaze's 1.2.5 publish review, Glaze SDK
  0.14.4.0 metadata, a version bump and release notes. It still pins zod 4.6.6.
- PR #61's description says 1.2.6 was applied on the Mac from `a3e3f37` and published to the Glaze
  Public Store on 2026-11-04 as Published Version 14.0.0. Git and `gh` cannot confirm the Mac or
  Store state.
- Glaze is frozen at 1.2.6. It is not getting the composer or the system panels: their port is only
  in draft PR #45 (head `2d106e0`, 13 commits ahead of `glaze`), parked on 2026-10-28 and never
  applied on the Mac. GitHub reports #45 as conflicting with `glaze`, because both set version
  1.2.6. The `glaze-1.2.6-composer-15/16` patch packets are retired.

### Earlier history

- Glaze 1.2.5 was rebuilt from the 2026-10-14 recovery packet: remote `glaze` `df4d574` plus
  patches 01, 02 and 03. This file once recorded that all 53 files matched the packet's hashes; the
  packet is outside this repo, so that cannot be re-checked here. Its shared fixes were ported into
  PR #37: Glaze's three-way Google refresh classification, one-line snapshot fields with MCP errors
  kept inside the snapshot, the pinned Anthropic base URL, usage accounting, the mid-stream error
  message, and queued settings reads. The original owner then pushed the preserved history to
  `glaze` as `5bc351e` (1.2.5), the Glaze baseline until 2026-11-04. Standalone's `accentColors`
  theming and `useId` field labels are not ported: Glaze's SDK components read only
  `--accent-contrast`, which Glaze already computes to 3:1, and its inputs already carry
  `aria-label`s.
- Beta.9 (`beta-1.3.0-beta.9`, 2026-10-09) was the credential-free, ad-hoc community UI beta, with
  the reviewed Agenda/sidebar UI and updated D icon: Google sign-in unconfigured, licensing and
  automatic updates off, AI opt-in, Apple Silicon and macOS 14+. Beta.10 pinned MCP SDK 1.32.0,
  enabled tool-input limits on both local servers and bounded authenticated JSON before SDK
  validation. Beta.11 (October 9) restored Google sign-in through `npm run build:beta`, which fails
  if the Desktop OAuth client is missing.
- Beta.12 added ⌘N New Item with a clickable sidebar + (PR #25), beta packaging that enforces the
  Google configuration through final macOS packaging (PR #33), the macOS shell, sidebar and
  responsive inspector refinement (PR #34), billing tooling updates (PR #22), the website Road Map
  (PR #36), PR #37, then #43, #42, #40 and #44.
- PR #37 (`d7e4463`, 2026-10-20) brought the offline Google refresh fix (only a refused grant signs
  out) and the recovered local Codex commits `aeab7b0` (stable update channel) and `43dedf7`
  (Assistant effect warnings; run `node --test tests/assistant-effects.browser.mjs` explicitly,
  since `npm test` skips it).
- PR #42 (`768329f`, 2026-10-21, final head `e34b93c`) built the Assistant composer from
  `docs/composer/`: a per-provider effort panel on the model chip, `/` commands and `@` mentions.
  Settings → AI and the composer's model menu share one model list, effort table and model-change
  rule, and one-click features get API-route effort. Claude Code's `default` model offers no effort
  anywhere, since what it resolves to is unknown until the CLI runs. Once an Assistant reply reports
  the exact model (Claude Code's init event), Settings, the composer and the sidebar name the
  default after it ("Opus 5.5") for the rest of the app session; before that, and after a restart,
  it reads "Claude Code default". Its Glaze port is only in the parked PR #45.
- Zod 4.6.6 (October 11) fixes SNYK-JS-ZOD-20510278: standalone requires `^4.6.6` from beta.12,
  and Glaze pins 4.6.6. The fix only stops early on arrays that declare a maximum, so keep the
  local input limits; remote MCP response validation stays outside them.
- Miles bought Apple Developer Program enrollment on October 20 and wants a notarized DayBoard that
  anyone can download and that updates itself. The App Store Connect team key "DayBoard
  notarization" was created that day.

### Foundations

- Standalone Electron integration is implemented: platform services, sandboxed preload, native window lifecycle, React UI, Swift Reminders helper, Google Desktop OAuth, AI provider selection, local MCP, preferences and history.
- The existing Claude platform/UI/AI/licensing packets have been incorporated and reviewed. Root fixes include account-change races, native date/list validation, explicit AI-provider selection, demo isolation, accessible editor labels, persisted theme and licensing enforcement.
- Stripe now replaces Lemon Squeezy by explicit user choice. The separate `billing/` Worker handles hosted Checkout, per-order authenticated key delivery, idempotent signed-webhook fulfillment, refund/dispute revocation and device limits. The app binds keys to issuer/product/environment, preserves old encrypted records and compensates only newly created activation slots. Since PR #67 the trial is a 7-day AI-only trial that starts on the first AI use; the 30-day offline grace still applies, and 14 days is the refund window. Missing commercial configuration produces preview mode; strict release builds require live configuration.
- The website lives in `website/`, with a real fictional-data screenshot. Its live state is under
  "Website" above.
- The reviewed Agenda/sidebar UI preserves the existing design tokens and adds clear date hierarchy, grouped navigation, wrapping filters and density spacing. Test/demo startup validates backend and browser storage before services and exits Electron immediately on isolation failure. No billing, waitlist or provider behavior changed.
- Manual update UI/service, DMG + ZIP packaging, save draining and temporary editing lock are implemented. Preview/demo builds never contact the updater. Third-party notices cover the installed dependency graph and ship with the GPL text.
- Assistant requests send the stable policy first; explicit cache controls apply only on the direct OpenAI API route for listed models (`docs/PROMPT-CACHING.md`). Token and cache usage are recorded per request; no live savings are measured.

## System panels (PR #44, merged as `5489bbb`)

PR #44 (`claude/system-panels-bb42de`, merged 2026-10-22, shipped in beta.12 and later) added Quick
Capture (global hotkey panel), the menu-bar mini Agenda and the meeting-aware Up Next card with
optional notifications and Granola notes import. Design:
`docs/superpowers/specs/2026-10-20-system-panels-design.md`; plan and decision log:
`docs/superpowers/plans/2026-10-20-system-panels.md`; Glaze port guide:
`docs/porting-system-panels.md`; fuse proposal: `docs/proposals/electron-fuses.md`.

Lifecycle changes for release-owner review (the updater's quit/install path is unchanged):

- `startSystemPanels()` runs before `createMainWindow()`; it registers the hotkey and panel IPC,
  creates the tray when enabled (never in test builds), and starts meeting alerts. Since #70 it
  also starts mail notifications and the Dock badge handler (`main/system-panels/index.ts:113`).
- `updates.startAutomatic()` (from #43) runs after `createMainWindow()` (`main/index.ts:119-121`).
- `app.on("will-quit", stopSystemPanels)` unregisters global shortcuts and destroys the tray.
- `activate` ignores floating panels when deciding whether to show the main window.
- Tray "Quit DayBoard" calls plain `app.quit()`, so the `before-quit` save guard runs. No
  hide-on-close was added. `window-all-closed`, `before-quit`, the quit guard, the updater
  service and `runtime-activity` are untouched. Check for Updates stays in the app menu.
- Meeting alerts hold one `setTimeout` and, only while on, a refresh `setInterval`. #70 adds mail
  and follow-up timers and a Dock badge (`main/system-panels/mail-notifications.ts`).

Acceptance correction (2026-10-20): the stale QA preview launched at 07:19:27 PDT (14:19:27 UTC; shell PID 81215, app PID 81216; `DAYBOARD_DEMO=1`, scratchpad `demo-profile`, built from `c316117`) was reported stopped at about 07:21 but kept running: the stop command matched an absolute path while the app had been launched with a relative one. It ran until it was stopped by PID with SIGTERM at about 07:47 PDT; its launch task exited with code 0, and a check at 14:48:08 UTC found no QA preview processes. While it ran it likely held ⌃⌥Space and showed a menu-bar icon. No canonical or user-launched DayBoard was touched. At the time (2026-10-20), acceptance used the fresh `cf890ac` preview package and a new empty demo profile; native checks now run on a current non-test build (see "Remaining work", item 4).

PR #42 overlap (resolved): #44 moved the `ai:run` body into `main/services/ai/completion.ts`, and
#42 changed that body. #44 merged second. origin/main, which already contained #42, was merged
into #44's branch at `94783c6`, with conflicts in `ai.ts`, `ipc.ts`, `package.json` and
`assistant-view.tsx`. `runCompletion` now carries #42's API effort options
(`main/services/ai/completion.ts:66`) and its explicit Codex default model (`:117-125`). Wiring
tests: `tests/quick-capture-wiring.test.mjs:51`, `tests/prompt-cache.test.mjs:1006` (`ai:run` API
effort) and `tests/prompt-cache.test.mjs:1565` (`ai:run` Codex default).

Integration (done): the merge order #43, #42, #44 was kept.

- #43 merged as `41e74bb` on 2026-10-20 (CI run 39446372947, as reported by its owner). Main was
  merged into #44 as `be58946` with no conflicts; it brought `updates.startAutomatic()` after the
  main window opens and zod 4.6.7.
- #42 merged as `768329f` on 2026-10-21 from its final head `e34b93c`, which includes the label
  commits `cb77c10` and `0859738`.
- The reconciliation merge `94783c6` (2026-10-20 18:25 PDT) used that merge. #44 then merged as
  `5489bbb` on 2026-10-22.
- A refused panel stream now ends with its end marker (`main/platform/ipc.ts:126-143`), covered by
  `tests/platform-ipc.test.mjs:380-393`.
- Earlier trial evidence and patches are in
  `/Users/mileschu/Documents/Codex/2026-10-20/task/integration-check-2026-10-20/`.
- Builds from the merged #42+#43+#44 tree exist: beta.12 and later, and the signed beta.16 dry-run
  package from `4996f9a`. `docs/CODEX-HANDOFF.md` reports a demo QA that passed 14/14 on the
  `01bb084` package on 2026-10-22, with tray anchoring fixed before that run. That evidence is not
  in the repository, so native combined acceptance is unverified here.

Native acceptance (2026-10-20, 15:09–15:22 UTC). Build: the `cf890ac` ad-hoc preview, demo mode,
disposable profile `scratchpad/acceptance-profile`, with Chess as the other app. Ten checks passed:

- the conflict message for ⌥⌘Space
- the hotkey from windowed and from full-screen Chess
- the panel on the display under the pointer
- focus return after Esc (windowed and full screen), windowed click-away, and submit (the demo
  refusal is shown and the text is kept)
- the switches removing the hotkey, the tray icon and the Up Next card, and turning the hotkey and
  card back on

Failed: the tray panel opened under its icon on 2 of 3 opens. The third landed on the built-in
display while the icon on the ASUS display was clicked. Electron 44.4.4's `Tray.getBounds()` reads
the status item view's own window (`[status_item_view_ window].frame`), which can be another
display's copy. The click event instead carries the frame of the window that was clicked
(`event.window.frame`).

Fixed in `609350d`: the click bounds now drive placement, with a `tests/tray-anchor.test.mjs`
regression. It needs native re-acceptance; the 2026-10-22 demo QA above reportedly covered it, but
its evidence is not in the repository.

Blocked or not run:

- Full-screen click-away is blocked. The Codex "Cua Driver" overlay covers the full-screen Space,
  so the test tool refuses clicks there.
- The re-enabled tray icon could not be confirmed. It is probably in the menu-bar manager's hidden
  section.
- Notification delivery was not run. Demo mode sends none, and the first notification would raise
  a macOS permission prompt. Since #70 this also covers mail notifications and the Dock badge.

Other findings:

- **Tray click made DayBoard frontmost** on 2 of 3 clicks, in both cases the clicks that opened
  the panel. Cause unresolved.
  - What was checked: Electron 44.4.4's tray click handler calls no activation, `Show()`/`Focus()`
    skip activation for panels (`if (!IsPanel())`), DayBoard calls `app.focus` only for Open
    DayBoard, and the hotkey-opened panel never activated the app.
  - That narrows the cause but does not rule out every native path.
  - Leading hypotheses: macOS activating the app on a status-item click, or the test tool
    activating the app it clicks.
  - Not fixed: a blind fix (`app.hide()`) would hide a visible main window. A by-hand tray click
    while another app is frontmost is the next check.
- **Esc on a freshly opened menu-bar panel** did nothing until focus was inside it. Fixed in
  `db10cdb`: both panels listen for Esc on the window, with an e2e regression.
- **First keystrokes lost after the hotkey** on 2 of about 8 opens.
  - A new e2e test types right after each way the capture panel reopens: first show, after Esc,
    after click-away, after a rejected submit. Every keystroke lands.
  - PR #48 (`ca29afb`, beta.13) later found and fixed one cause: on the first open after launch,
    the capture input stayed disabled while settings and accounts loaded. Before the fix the e2e
    test failed 1 of 10 runs; after it, 30 of 30 passed.
  - A by-hand native check on a build that contains `ca29afb` has not been recorded.

Verification of the acceptance fixes (2026-10-20). Each regression test was run and failed
before its fix:

- **Branch `01c4949`.**
  - `npm test`: renderer 63/63 and backend 520/520 pass. lint, typecheck and `format:check` exit 0.
  - `e2e/system-panels.spec.ts` (built at `db10cdb`): 11/11 pass.
- **`tests/tray-anchor.test.mjs`: 3 tests.**
  - Before the fix, the toggle received the click event instead of the bounds, and the panel was
    centred at x 371 (the built-in copy) instead of 936.
- **e2e "Escape hides a freshly shown menu-bar panel".**
  - Before the fix the panel stayed visible: "Expected: false, Received: true".
- **e2e "the first keystrokes after each reopen reach the capture input".** It passed before and
  after the change, so it records existing behaviour rather than proving a fix.
- **`tests/quick-capture-wiring.test.mjs`.** It fails when Quick Capture's `complete` bypasses
  `runCompletion`.

Trial reconciliation (scratch worktree, superseded by `94783c6`): merging #42 at interim head
`302d191` into `0e73008` with the reviewed `runCompletion` repair passed every check. The patch and
logs are in
`~/Library/Application Support/Claude/side-session-notes/local_855233d0-bc2b-4355-8e3f-3d0338d5d8c5/pr44-trial-on-302d191/`.

Design system check (2026-10-20). The panels were checked against "DayBoard Design System v21",
render `1791573676-ee86`. Its export sha256 `70b651fc…df85` was verified on the local copy in
`~/Documents/Codex/2026-10-09/task-4/design-reference/`. The live artifact revision
`1792522028-b5ac` gives the same panel rules, with tighter contrast wording.

- **Fixed in `ba10a95`:**
  - Placeholders end in an ellipsis, and the menu-bar one no longer truncates.
  - A failed capture is a red Callout.
  - Today rows use `list-hover`, `tabular-nums` and a `title` on truncated text.
  - Button labels are sentence case.
- **Fixed in `0e41eb8`:** menu-bar Today rows take the inset 2px keyboard ring that the app's list
  rows use. The design e2e test checks it (it failed at offset 0px before the fix).
- **Version 26** (`1792526832-32f0`): every design-system file used above has the same SHA-256 as
  in `1792522028-b5ac`, and its note says app tokens and cards are unchanged. The comparison stands.
- **Already compliant:** the panel ground is opaque. A new e2e test pins it along with the
  fixes.
- **Left as decisions:**
  - The Spotlight-size capture field stays for this release. It is 40px tall with 15px text
    (`h-10 text-[15px]`); the design system's Input sizes are 28, 32 and 36px with 13px text.
  - the app-wide time-range format
  - model and effort presentation, which has no guidance in the design system (owned by #42). No
    panel surface shows it.
  - the hidden native vibrancy layer
- Before and after screenshots and rendered design-system cards are in the shared notes folder's
  `pr44-design-system-check/`.
- **Exact-head regression at `a96c70c`** (code as `ba10a95`): `npm test` renderer 63/63 and backend
  529/529; lint, typecheck and `format:check` exit 0; `test:e2e` 39 passed, 1 skipped (the opt-in
  native encryption test).
- **Claude Design project (claude.ai/design): not inspected.** The `/design-sync` skill's
  read-only `DesignSync list_projects` call failed: "DesignSync needs design-system
  authorization, and /design-login cannot run in this non-interactive session. Ask the user to run
  /design-login once from an interactive Claude Code session on this machine". The artifact and
  the v21 export above were used instead.

Independent review (2026-10-20): local Codex review of exact `cc4e473..1f87dc7`, COMPLETE.

- **Important** (it predates this range): Escape during IME composition hid the panel. Fixed in
  `ade0ea0` with an e2e regression.
- **Minor:**
  - The tray tests skipped `index.ts`'s forwarding. Covered by a `startSystemPanels` test in
    `f68652b`, which fails if the forwarding is removed.
  - The Escape e2e test now confirms the panel is natively visible first.
  - A stale TASKS.md line was corrected.
- After the fixes: `npm test` renderer 63/63 and backend 530/530; lint, typecheck and
  `format:check` exit 0; panel e2e 13/13.

Platform feature matrix (2026-10-20, updated 2026-11-04). Standalone: #44 merged as `5489bbb` and
shipped in beta.12, beta.13 and beta.15; the installed DayBoard is now beta.15. Glaze: draft PR #45
(base `glaze`, head `2d106e0`) is parked and was never applied, so the published Glaze app has
none of it.

| Feature · platform                   | Source                                   | Automated tests                                                                                                                               | Native visual                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick Capture · standalone           | yes                                      | unit tests (capture, hotkey, shortcuts, wiring); panel e2e 12/12; full suite 529 backend + 63 renderer, e2e 39 passed / 1 skipped (`a96c70c`) | partial on `cf890ac`: hotkey, display, Esc, click-away, submit and conflict message passed; full-screen click-away blocked; first keystrokes: one cause fixed in #48, by-hand check open |
| Quick Capture · Glaze                | yes, on Glaze's backend                  | 65 renderer / 372 backend unit tests at `2d106e0` (PR #45 CI); Playwright renderer e2e since `7e9ea34`, not run in CI                         | not run (#45 parked)                                                                                                                                                                     |
| Menu-bar Agenda · standalone         | yes                                      | tray-anchor ×3, placement and today-items units; e2e open, Esc on a fresh panel, Open DayBoard, design rules                                  | placement failed on `cf890ac`, fixed in `609350d`; Esc fixed in `db10cdb`; re-check reported in the 10-22 demo QA, evidence not in the repo; tray activation open                        |
| Menu-bar Agenda · Glaze              | yes, with the click-bounds and Esc fixes | placement units; `tests/tray-anchor.test.mjs` (since `e89801d`, extended in `f83d106`)                                                        | not run (#45 parked)                                                                                                                                                                     |
| Up Next and alerts · standalone      | yes                                      | meetings and alerts units; 2 e2e                                                                                                              | card and switch passed; notifications not run                                                                                                                                            |
| Up Next and alerts · Glaze           | yes                                      | units                                                                                                                                         | not run (#45 parked)                                                                                                                                                                     |
| Meeting Notes (Granola) · standalone | yes                                      | 2 unit files; no e2e                                                                                                                          | not run (needs a real Granola server)                                                                                                                                                    |
| Meeting Notes (Granola) · Glaze      | yes                                      | 2 unit files                                                                                                                                  | not run (#45 parked)                                                                                                                                                                     |

Glaze ports: #45's branch has each one, and none is merged into `glaze` or applied, because #45 is
parked:

- #44's design fixes from `ba10a95` (ported in `7e9ea34`) and the inset focus ring from `0e41eb8`
  (`renderer/panel/menubar-panel.tsx:158` on #45's branch, since `402bcd6`)
- `tests/tray-anchor.test.mjs` (added in `e89801d`, extended in `f83d106` and `35e82be`)
- #42's final effort and model identity (`eaa7762`)
- renderer e2e coverage (`7e9ea34`)

Proven platform differences:

- Glaze applies updates itself, so there is no updater quit path to preserve.
- REA cannot see Glaze's window and IPC surface.

None of #45's native acceptance checks have run. They need publishing into Glaze's runtime, which
replaces the installed app, and #45 is parked, so they are not planned unless Miles un-parks Glaze
parity. Still unproven: whether Glaze's tray click passes the icon's bounds, and how its panels
behave over full-screen apps and across Spaces.

No canonical app or profile was touched. Full report, with permission evidence, screenshots and
logs:
`~/Library/Application Support/Claude/side-session-notes/local_855233d0-bc2b-4355-8e3f-3d0338d5d8c5/pr44-native-acceptance-2026-10-20/README.md`.

## Verification observed

- On October 7, the UI candidate passed 27 renderer tests and all 332 app/native tests, both typechecks, touched-file formatting and lint with the same three existing React dependency warnings. The first sandboxed app-test run was blocked by loopback socket and compiler-cache restrictions; the approved execution route and owned temporary compiler cache passed without changing tests or dependencies.
- Its fresh credential-free non-test community build embeds licensing disabled, no updater loader, blank Google client constants and AI disabled by default. The native helper and complete notices build passed. The ad-hoc package matches all 12 build files, resolves all 121 required runtime packages, includes the arm64 helper and GPL/notices, and passes strict deep signature checks before and after UI testing.
- All 14 packaged fictional/disabled-provider UI tests passed with owned, marked profiles and both actual storage paths verified. They include every primary route, editor recovery, theme/density, minimum window/details, focus, persistence and update UI behavior. The raw native encryption probe is now a separate explicit opt-in OS test and was skipped. Its earlier combined smoke attempt timed out before route screenshots; the exact stalled call is unproven and the original evidence is retained. This is not production Keychain, ordinary Finder launch or signed-install acceptance.

Earlier standalone observations follow; their counts and live-account results are historical.

- Both TypeScript projects pass; lint passes with three existing React dependency warnings.
- 10 renderer tests and 197 backend/native tests passed. The separate billing package passes 16 tests, including real local workerd/Miniflare + D1 execution, Stripe SDK serialization/signature verification, desktop activation and refund invalidation. All provider traffic is intercepted in those automated suites.
- Ten tests passed against the final packaged app: all routes, Settings, theme/name persistence, close/reopen, mail detail modes, task/reminder editing safety, Assistant history, focus persistence, an empty normal profile, the native update menu and update-failure UI recovery.
- The calendar editor has an additional isolated Electron component regression for refresh loading, failure recovery and out-of-order responses. It uses the real React editor with a synthetic IPC boundary; it is separate from the ten packaged-app tests.
- GitHub PR #4 review findings are repaired: event details must finish loading for the current item before Save is enabled, future license-validation timestamps trigger revalidation and fail closed offline, and license errors name the DayBoard service. A follow-up review also found a future trial-start timestamp could extend or revive the trial; that case now expires instead, with regression coverage.
- Google API automatic retries now apply only to GET requests. Task/event creation failures are surfaced after one attempt, preventing automatic duplicate creates. Failure fixtures cover POST 429/503, bounded GET retries and response cleanup.
- Native Reminders now selects the newest completion dates before capping completed-history results. Requests are serialized, and a timed-out helper is retired so a later request can start a fresh process; mutations are never replayed automatically. Queued reads preserve the full five-minute permission timeout. Synthetic fixtures cover the 400-item boundary, stale callbacks and spawn/exit/write failures.
- Beta.6 also passed two direct packaged-runtime checks: MCP initializes with exactly six read-only tools while disabled external access returns HTTP 403 without creating a persistent key; the native helper recovers after a controlled stall and crash. Those checks use isolated profiles and permission-status requests only, with no provider-record reads or writes.
- On beta.5, a separate, explicitly authorized profile passed real Google sign-in, a real token refresh triggered by a temporary in-process clock shift, persisted authentication across app restart, and sign-out with HTTP 200 token revocation. One task, calendar event and Apple Reminder each passed create/update/readback/delete; their absence was rechecked after restart. Gmail and AI were disabled during these acceptance operations. The test app is closed and signed out; these live writes were not repeated for beta.6.
- A fresh dependency installation passed the baseline standalone checks. The beta.6 preview DMG and ZIP include the arm64 helper, GPL text and third-party notices. Stripe SDK/backend credentials are excluded from the Mac app.
- Focused Stripe review found and closed three issues: simultaneous checkout receipt access, failed checkout retry, and unread response cleanup. The actual purchase/receipt scripts were exercised in a clearly labeled local UI fixture. No real Stripe payment or hosted deployment was tested.
- Native Settings shortcut, toolbar click, tab selection and Escape were exercised. Automated dragging did not move either the custom main title bar or the standard macOS Settings title bar, so physical window movement still needs a manual acceptance check. The main window reports movable and its drag/no-drag styles are verified.
- The earlier beta.1 packaged fictional demo reached Agenda in 1.7 seconds with warm OS caches; summed process working sets were 366 MiB. Later previews have not been re-benchmarked. This is not a real-account benchmark or unique physical-memory measurement.
- Automated suites use disposable profiles, synthetic providers/licenses and unsaved EventKit objects. The separately approved live acceptance used exactly three labeled source items, all deleted and verified absent. No merchant purchase or public deployment was performed.

## Remaining work

Ordered by priority. Each item says who or what it waits on. Tag pushes, merges, deploys, release
workflows and anything outward-facing need Miles's explicit OK for that action, every time.

1. **Merge the beta.17 PR and push `v1.3.0-beta.17`.** Branch `fix/beta16-release-audit` fixes the
   test that stopped beta.16's release run and bumps the version. After it merges, Miles tags the
   merge commit on `main` and pushes the tag from his Mac, which starts the public Signed macOS
   release run. Waits on Miles: the merge, the tag and the push.
2. **Verify the beta.17 release.** It will be the first tag release since the rename to
   `miles-chu10/DayBoard`, and only unit tests cover the letter-case fix on the release and publish
   path. After it publishes, check the assets, `SHA256SUMS.txt` against GitHub's digests and
   `latest-mac.yml`, and run `codesign`, `stapler` and `spctl` on the Mac (read-only, for example
   `/release-check 1.3.0-beta.17`). Waits on the release run that follows item 1.
   - If the run fails, `macos-release.yml` uploads no test results; only `macos-beta.yml` keeps
     `beta-test-results`. Adding that is a workflow PR with Miles's merge OK. It is not required
     for beta.17.
3. **Installed app on Miles's Mac.**
   - Update `/Applications/DayBoard.app` from beta.15 to beta.17 in the app once beta.17 is
     published and verified, and record it. Miles asked for this on 2026-11-04; waits on items 1
     and 2.
   - Miles confirms his Google accounts visually. A session then observes the first token refresh
     under beta.15 (or beta.17) and checks the Keychain item read-only. That Keychain item check
     is still open from the follow-up to the beta.12-to-beta.13 in-app update
     (`docs/CODEX-HANDOFF.md`, pending item 10); its `codesign` and `spctl` checks are covered by
     the beta.15 install checks above. Waits on Miles.
   - Re-check the installed app's MCP server on `127.0.0.1:54809` after the
     `~/code/dayboard-license-test` dev instance stops and the installed app relaunches. Waits on
     the session that owns that dev instance, then Miles.
4. **Native by-hand checks.** Miles, on a current non-test build with an owned profile.
   - Tray click activating DayBoard (cause unresolved): a by-hand tray click while another app is
     frontmost, before any fix.
   - First keystrokes after the hotkey, on a build that contains `ca29afb`.
   - Task 16 leftovers: full-screen click-away (last blocked by the Cua Driver overlay), the
     re-enabled tray icon, and notification delivery. Delivery now covers meeting alerts and #70's
     mail notifications and Dock badge; the first one raises a macOS permission prompt.
   - Tray placement (`609350d`) and Esc (`db10cdb`): close this once the 2026-10-22 14/14 demo QA
     evidence turns up; otherwise re-run it on a current build such as the beta.16 dry-run package.
     Waits on Miles or whoever ran that QA.
   - Gatekeeper on a quarantined first-install download, and Google sign-in and Keychain
     continuity when the Developer ID build replaces an ad-hoc install. Waits on an owned,
     disposable installation target that Miles provides or approves.
   - Manual window-drag acceptance: automated dragging moved neither title bar.
   - Live Gmail/AI-provider acceptance and first-time Reminders consent remain unverified. New
     consent and real Keychain checks require deliberately owned OS test state; a separate macOS
     account is not a requirement for fictional UI. Historical Google Tasks, Calendar and existing
     Reminders access were verified for the selected account; this does not prove public OAuth
     eligibility for every account.
5. **Docs, site and other follow-ups.** Any PR among them needs Miles's merge OK; site changes
   also need his website deploy.
   - HeroSpace plan Final step: a recorded demo-mode visual pass of the merged features, from the
     `beta-test-results` screenshots or a native demo run. Waits on an agent or Miles. The
     HANDOFF.md and TASKS.md refresh is on branch `claude/project-thread-44twxh`; merging it needs
     Miles's OK.
   - After beta.17 is published and verified, move `website/download.html` (version text, DMG and
     `SHA256SUMS.txt` URLs, the 138 MB size) and the README to beta.17. Not before the release
     exists.
   - Open checkout on the site by setting `buyUrl` once the payment flow is live. Waits on the
     payments project thread and Miles's approval for each deploy and Stripe write.
   - Confirm the production waitlist: D1 migrations 0001 to 0005, the suppressions table and the
     health of the waitlist endpoint. Waits on Miles running read-only `wrangler` commands
     (`wrangler d1 migrations list --remote`, `wrangler deployments list`).
   - Beta-tester invitation email: on hold. Its trigger was "after beta 14 is published", and beta
     14 was never published. Waits on Miles to restate the trigger, say where the one-by-one
     invitation workflow lives, and approve each send; each send needs fresh suppression checks.
   - Claude Design project check: rerun the read-only `/design-sync` inspection. Waits on Miles
     running `/design-login` once in an interactive Claude Code session.
   - Source migration review (see the note on separate histories below). Waits on Miles to
     schedule it.
   - Optional: run REA on a fresh combined artifact. Nothing records that it ran after the #42
     merge. Waits on an agent on the Mac, if still wanted.
   - Other docs that are stale. Found by the 2026-11-04 audit and not changed here. Each fix is a
     docs or site PR that waits on Miles's merge OK:
     - `README.md`: the banner (lines 26-31) and Getting started step 1 (lines 48-51) still name
       beta 12 and say no newer beta has shipped. The pricing paragraph describes main's
       post-#67 terms as current, but published betas are free and checkout isn't open.
     - `docs/RELEASE.md`: says beta.11 users install beta.12 once (now the beta.15 DMG); says
       `/download` redirects through `DOWNLOAD_URL` in `website-worker/worker.js` (it is the static
       `website/download.html`); still gates beta.12 on website disclosure; its dry-run artifact
       list misses `beta-test-results` (PR #72).
     - `docs/AUTOMATED_RELEASES.md`: says signing can't be proven until credentials exist (beta.12,
       beta.13 and beta.15 ran it end to end); implies release builds enforce licensing and need
       the account and checkout checks first, but the workflow keeps the `live` license
       environment (`macos-release.yml:27`) and sets `DAYBOARD_LICENSE=off` (`:59`), so published
       betas are free; names the repository `miles-chu10/dayboard` (now `miles-chu10/DayBoard`).
     - `docs/CODEX-HANDOFF.md`: the beta 14 status, "Published: v1.3.0-beta.13" and pending item 1
       are superseded by beta.15 and beta.16; #59 is deployed; #61 is merged as `8645628`; the
       "Glaze 1.2.5 is live", uncommitted `sources/` dependency fixes, pending item 2 and line 346
       predate the #61 merge.
     - `docs/release-notes-1.3.0-beta.12.md`, `-beta.13.md` and `-beta.15.md`: still say they are
       drafts and keep a "Before publishing" section, though all three are published.
     - `website/index.html:666`: the Road Map lists "Grok in the assistant" as planned, but xAI
       Grok is already an API-key provider in published betas. Miles chooses the new wording.
     - `docs/superpowers/plans/2026-11-04-herospace-features.md`: says "Local commits only" (it
       merged as PR #70, `368aebc`); its Final step is partly done (CI run 41923026422 and dry run
       41923039435 passed on `4996f9a`).
6. **Glaze decisions.** Waits on Miles.
   - PR #45: close it, keep it only for reference, or un-park Glaze parity. If it is revived, rebase
     it onto `8645628` and give it a version after 1.2.6. Its 10 native acceptance checks have not
     run; they need un-parking and an approved publish into the Glaze runtime, which replaces the
     installed Glaze app.
   - Confirm that Glaze 1.2.6 is live in the Glaze Public Store as Published Version 14.0.0. Only
     PR #61's description says so, and the Store is outside this repo.
7. **Loose signing key file.** The unprotected key file from `docs/CODEX-HANDOFF.md` pending item 9
   is still in the local release-signing folder (checked by file existence only on 2026-11-04).
   Back it up, then delete it. Waits on Miles.

Preserve. Never delete or force-push these; remove one only by its exact path and with Miles's OK:

- the worktrees `~/code/dayboard-pr54` (`25d0e63`) and `~/code/dayboard-pr57` (`6ba5cb8`)
- branch `claude/project-thread-p5gpjl` (`d9d5bc9`) and its worktree
  `~/code/dayboard/.claude/worktrees/stapler-diagnostics`
- `glaze` (now `8645628`), the Glaze baseline

Parked until Miles says otherwise:

- Mac App Store edition. PR #51 (`10fef65`) merged dormant and is in beta.13 and later. Resume
  only on Miles's word; the bundle ID question comes first.
- MicAI.
- Glaze feature parity (#45; see item 6).

The Glaze source repository and this standalone repository are separate histories and do not synchronize automatically. Preserve the public repository's history when preparing the standalone migration; do not force-push over it.

The durable local execution queue is under ignored `.workflow/standalone-release/` in the integration checkout. Recheck Git status and latest evidence before resuming. The root task owns integration and final acceptance.
