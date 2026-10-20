# DayBoard standalone handoff

Read `docs/EXECPLAN.md` for the objective and `docs/RELEASE.md` for build/release gates.

## Current state

- Latest published beta: `1.3.0-beta.11` (prerelease `beta-1.3.0-beta.11`, October 9) restores
  Google sign-in through `npm run build:beta`, which fails if the Desktop OAuth client is missing.
  It keeps beta.10's MCP input limits and reports refresh failures and partial results alongside
  cached sidebar summaries. Notes: `docs/release-notes-1.3.0-beta.11.md`.
- Unreleased on `main` since beta.11, now versioned `1.3.0-beta.12`: ⌘N New Item with a
  clickable sidebar + (PR #25), beta packaging that enforces the Google configuration through
  final macOS packaging (PR #33), the macOS shell, sidebar and responsive inspector refinement
  (PR #34), billing tooling updates (PR #22), the website Road Map (PR #36), and PR #37 (merged
  October 20). No beta.12 artifact has been built yet.
- PR #37 carries the offline Google refresh fix (only a refused grant signs out) and the
  recovered local Codex commits `aeab7b0` (stable update channel) and `43dedf7` (Assistant
  effect warnings; run `node --test tests/assistant-effects.browser.mjs` explicitly, since
  `npm test` skips it).
- Miles bought Apple Developer Program enrollment on October 20 and wants a notarized DayBoard
  that anyone can download and that updates itself. Beta.12 onward is a free release published by
  pushing a `v`-prefixed tag (the **Signed macOS release** workflow, `DAYBOARD_RELEASE=1` with
  `DAYBOARD_LICENSE=off`): Developer ID signed, notarized, in-app updates on, licensing off. The
  manual **Signed macOS beta** workflow stays an updates-off signing dry run. Official builds
  check and download updates in the background and install on restart or quit. Each tag push
  needs Miles's approval. Beta.11 users move to beta.12 manually once; a real beta.12 to beta.13
  in-app update must then be tested in isolated QA state. See `docs/RELEASE.md`.
- October 20 signing setup on Miles's Mac: the `macos-release` environment exists (main and
  `v*`), with `DAYBOARD_GOOGLE_OAUTH_JSON`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` set and
  the App Store Connect team key "DayBoard notarization" created. Miles requires approval at
  the time of each credential creation, storage or import step.
- Glaze 1.2.5 was rebuilt from the 2026-10-14 recovery packet: remote `glaze` df4d574 plus
  patches 01, 02 and 03. All 53 files match the packet's hashes. Its shared fixes are ported into
  PR #37: Glaze's three-way Google refresh classification, one-line snapshot fields with MCP
  errors kept inside the snapshot, the pinned Anthropic base URL, usage accounting, the
  mid-stream error message, and queued settings reads. The original owner then pushed the
  preserved history to `glaze` (5bc351e, 1.2.5, same tree as the rebuild); that is the Glaze
  baseline. Standalone's `accentColors` theming and `useId` field labels are not ported: Glaze's
  SDK components read only `--accent-contrast`, which Glaze already computes to 3:1, and its
  inputs already carry `aria-label`s.
- Website: the `dayboard-website` Worker was last deployed October 9 at 12:23 UTC, matching
  `main` through PR #30. The Road Map (PR #36) is merged but not deployed.
- Waitlist: production D1 has migrations 0001 to 0005 applied. `0005_email_suppressions.sql`
  exists only in production, not in this repository; commit it with the code that uses it.
- Earlier, `1.3.0-beta.10` pinned MCP SDK 1.32.0, enabled tool-input limits on both local
  servers and bounded authenticated JSON before SDK validation. Zod 4.6.6 (October 11) fixes
  SNYK-JS-ZOD-20510278: standalone requires `^4.6.6` from beta.12 and Glaze 1.2.5 pins 4.6.6.
  The fix only stops early on arrays that declare a maximum, so keep the local input limits;
  remote MCP response validation stays outside them.

- Standalone Electron integration is implemented: platform services, sandboxed preload, native window lifecycle, React UI, Swift Reminders helper, Google Desktop OAuth, AI provider selection, local MCP, preferences and history.
- The existing Claude platform/UI/AI/licensing packets have been incorporated and reviewed. Root fixes include account-change races, native date/list validation, explicit AI-provider selection, demo isolation, accessible editor labels, persisted theme and licensing enforcement.
- Stripe now replaces Lemon Squeezy by explicit user choice. The separate `billing/` Worker handles hosted Checkout, per-order authenticated key delivery, idempotent signed-webhook fulfillment, refund/dispute revocation and device limits. The app binds keys to issuer/product/environment, preserves old encrypted records and compensates only newly created activation slots. The 14-day trial and 30-day offline grace remain. Missing commercial configuration produces preview mode; strict release builds require live configuration.
- The website is prepared in `website/`, with a real fictional-data screenshot. Purchase/download URLs remain unset until verified destinations exist.
- Approved manual community UI beta: `1.3.0-beta.9`, with the reviewed Agenda/sidebar UI and updated D icon. Its credential-free artifact has Google sign-in unconfigured, licensing and automatic updates disabled, and AI opt-in. Miles explicitly deferred Developer ID signing and notarization for this limited beta. Packaged target: Apple Silicon, macOS 14+.
- The reviewed Agenda/sidebar UI preserves the existing design tokens and adds clear date hierarchy, grouped navigation, wrapping filters and density spacing. Test/demo startup validates backend and browser storage before services and exits Electron immediately on isolation failure. No billing, waitlist or provider behavior changed.
- Manual update UI/service, DMG + ZIP packaging, save draining and temporary editing lock are implemented. Preview/demo builds never contact the updater. Third-party notices cover the installed dependency graph and ship with the GPL text.
- Assistant requests send the stable policy first; explicit cache controls apply only on the direct OpenAI API route for listed models (`docs/PROMPT-CACHING.md`). Token and cache usage are recorded per request; no live savings are measured.

## Unreleased branch: system panels (PR #44, draft)

`claude/system-panels-bb42de` adds Quick Capture (global hotkey panel), the menu-bar mini Agenda and
the meeting-aware Up Next card with optional notifications and Granola notes import. Design:
`docs/superpowers/specs/2026-10-20-system-panels-design.md`; plan and decision log:
`docs/superpowers/plans/2026-10-20-system-panels.md`; Glaze port guide:
`docs/porting-system-panels.md`; fuse proposal: `docs/proposals/electron-fuses.md`.

Lifecycle changes for release-owner review (the updater's quit/install path is unchanged):

- `startSystemPanels()` runs before `createMainWindow()`; it registers the hotkey and panel IPC,
  creates the tray when enabled (never in test builds), and starts meeting alerts.
- `app.on("will-quit", stopSystemPanels)` unregisters global shortcuts and destroys the tray.
- `activate` ignores floating panels when deciding whether to show the main window.
- Tray "Quit DayBoard" calls plain `app.quit()`, so the `before-quit` save guard runs. No
  hide-on-close was added. `window-all-closed`, `before-quit`, the quit guard, the updater
  service and `runtime-activity` are untouched. Check for Updates stays in the app menu.
- Meeting alerts hold one `setTimeout` and, only while on, a refresh `setInterval`.

Acceptance correction (2026-10-20): the stale QA preview launched at 07:19:27 PDT (14:19:27 UTC; shell PID 81215, app PID 81216; `DAYBOARD_DEMO=1`, scratchpad `demo-profile`, built from `c316117`) was reported stopped at about 07:21 but kept running: the stop command matched an absolute path while the app had been launched with a relative one. It ran until it was stopped by PID with SIGTERM at about 07:47 PDT; its launch task exited with code 0, and a check at 14:48:08 UTC found no QA preview processes. While it ran it likely held ⌃⌥Space and showed a menu-bar icon. No canonical or user-launched DayBoard was touched. Use the fresh `cf890ac` preview package and a new empty demo profile for acceptance.

PR #42 overlap: this branch moved the `ai:run` body into `main/services/ai/completion.ts`. PR #42
changes that body (effort provider options on the API path, explicit Codex default model on the
CLI path). Whichever merges second must carry both into `runCompletion` and add a wiring test that
`ai:run` and Quick Capture's runner pass the resolved effort and Codex model. See `TASKS.md`.

Integration handoff (2026-10-20): merge order is #43, then #42, then #44.

- #43 merged as `41e74bb`, with successful CI run 39446372947 (as reported by its owner). Main
  was merged into this branch as `be58946` with no conflicts; it brings `updates.startAutomatic()`
  after the main window opens and zod 4.6.7.
  - Checks at `be58946`, after `npm ci` from the merged lock: `npm test` renderer 63/63 and backend
    529/529 pass; lint, typecheck and `format:check` exit 0.
  - `test:e2e`: 38 passed, 1 skipped (the opt-in native encryption test).
- #42 is not final. At `e0c7604` it has the two P2 fixes with successful CI. Its owner is still
  adding model-name and effective-supported-effort labels before final review and merge.
- Reconcile #44 only against the final #42 head:
  - Carry #42's API effort provider options and its explicit default Codex model into
    `runCompletion`, so that both `ai:run` and Quick Capture use them.
  - Keep the `clipSnapshot` import in `main/handlers/ai.ts`.
  - Merge the `package.json` test lists as a union.
  - Rerun both wiring paths and full validation.
- A scratch combined tree with the reviewed repair passed every check: `05883de` / tree `b9b6209`,
  with #42's two `ai:run` regression tests failing before the repair and passing after.
- Do not apply its `port-for-44-completion-ai-package.patch` blindly to an older base.
- Evidence and patches are in
  `/Users/mileschu/Documents/Codex/2026-10-20/task/integration-check-2026-10-20/`.
- The `cf890ac` preview is valid for panel-only QA. Combined lifecycle acceptance needs a new build
  from the merged tree.

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
regression. It needs native re-acceptance.

Blocked or not run:

- Full-screen click-away is blocked. The Codex "Cua Driver" overlay covers the full-screen Space,
  so the test tool refuses clicks there.
- The re-enabled tray icon could not be confirmed. It is probably in the menu-bar manager's hidden
  section.
- Notification delivery was not run. Demo mode sends none, and the first notification would raise
  a macOS permission prompt.

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
- **First keystrokes lost after the hotkey** on 2 of about 8 opens. Cause unresolved.
  - A new e2e test types right after each way the capture panel reopens: first show, after Esc,
    after click-away, after a rejected submit. Every keystroke lands.
  - Playwright delivers keys to the page directly, so that test narrows the cause but does not
    rule out native key-window routing or the renderer under OS-level input.
  - The test tool's key injection is a further hypothesis. Next check: by hand.

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

Trial reconciliation (scratch worktree, not pushed), merging #42 at interim head `302d191` into
`0e73008`:

- Conflicts:
  - `main/handlers/ai.ts`: kept the slim `ai:run` and the `clipSnapshot`,
    `onClaudeModelResolved` and `resolvedClaudeModels` imports, and dropped the unused ones.
  - `package.json`: merged the test lists as a union.
- Applied the reviewed `runCompletion` repair.
- #42's two `ai:run` wiring tests fail 0/2 without the repair and pass 2/2 with it.
- `npm ci` from the merged lock: zod 4.6.7.
- `npm test`: renderer 82/82 and backend 548/548. lint, typecheck and `format:check` exit 0.
  `test:e2e`: 41 passed, 1 skipped (the opt-in native encryption test).
- `302d191` is interim: #42's final review raised two P2s that its owner is fixing. Redo this on
  the merged #42 source, then build a fresh artifact from the current lock.
- The trial resolution patch and logs are in
  `~/Library/Application Support/Claude/side-session-notes/local_855233d0-bc2b-4355-8e3f-3d0338d5d8c5/pr44-trial-on-302d191/`.

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

For the approved UI-only manual beta, checkout, pricing and paid AI are separate feature gates.
Beta.9 and beta.10 shipped with Google sign-in unconfigured; beta.11 restores it for accounts
in the Google project's approved test audience. Apple signing/notarization and real
account acceptance remain follow-up work, not release blockers for this limited ad-hoc beta.

1. Pricing and activation limit are intentionally deferred by the user. Create no product/price until those terms are chosen and the external write is approved. Configure a separate Stripe sandbox and hosting account, then verify actual Checkout/payment/key delivery/refund and deployed D1 behavior. A connected Stripe account is not proof of charge/payout readiness.
2. Live Gmail/AI-provider acceptance and first-time Reminders consent remain unverified feature acceptance. New consent and real Keychain checks require deliberately owned OS test state; a separate macOS account is not a requirement for fictional UI. Historical Google Tasks, Calendar and existing Reminders access were verified for the selected account; this does not prove public OAuth eligibility for every account.
3. Developer ID signing and notarization run in both signed workflows once the certificate, its password and the notary key are in `macos-release`; ordinary signed launch, Gatekeeper on a quarantined download and account/Keychain continuity across replacing an ad-hoc install still need an owned installation target. Signed automatic upgrade acceptance needs two published `v` releases (beta.12, then beta.13).
4. Manual window-drag acceptance, source migration review and public download/site publication. The preview is ad-hoc signed, not Developer ID signed or notarized, and has no merchant configuration.

The Glaze source repository and this standalone repository are separate histories and do not synchronize automatically. Preserve the public repository's history when preparing the standalone migration; do not force-push over it.

The durable local execution queue is under ignored `.workflow/standalone-release/` in the integration checkout. Recheck Git status and latest evidence before resuming. The root task owns integration and final acceptance.
