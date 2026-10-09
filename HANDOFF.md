# DayBoard standalone handoff

Read `docs/EXECPLAN.md` for the objective and `docs/RELEASE.md` for build/release gates.

## Current state

- Community UI beta follow-up: `1.3.0-beta.10` retains beta.9's visuals, D icon and credential-free
  build configuration. MCP SDK is pinned to 1.32.0; both local servers enable tool-input limits,
  and authenticated JSON is bounded before SDK validation. Zod's advisory remains unresolved
  upstream; remote MCP response validation is outside this local input mitigation.

- Standalone Electron integration is implemented: platform services, sandboxed preload, native window lifecycle, React UI, Swift Reminders helper, Google Desktop OAuth, AI provider selection, local MCP, preferences and history.
- The existing Claude platform/UI/AI/licensing packets have been incorporated and reviewed. Root fixes include account-change races, native date/list validation, explicit AI-provider selection, demo isolation, accessible editor labels, persisted theme and licensing enforcement.
- Stripe now replaces Lemon Squeezy by explicit user choice. The separate `billing/` Worker handles hosted Checkout, per-order authenticated key delivery, idempotent signed-webhook fulfillment, refund/dispute revocation and device limits. The app binds keys to issuer/product/environment, preserves old encrypted records and compensates only newly created activation slots. The 14-day trial and 30-day offline grace remain. Missing commercial configuration produces preview mode; strict release builds require live configuration.
- The website is prepared in `website/`, with a real fictional-data screenshot. Purchase/download URLs remain unset until verified destinations exist.
- Approved manual community UI beta: `1.3.0-beta.9`, with the reviewed Agenda/sidebar UI and updated D icon. Its credential-free artifact has Google sign-in unconfigured, licensing and automatic updates disabled, and AI opt-in. Miles explicitly deferred Developer ID signing and notarization for this limited beta. Packaged target: Apple Silicon, macOS 14+.
- The reviewed Agenda/sidebar UI preserves the existing design tokens and adds clear date hierarchy, grouped navigation, wrapping filters and density spacing. Test/demo startup validates backend and browser storage before services and exits Electron immediately on isolation failure. No billing, waitlist or provider behavior changed.
- Manual update UI/service, DMG + ZIP packaging, save draining and temporary editing lock are implemented. Preview/demo builds never contact the updater. Third-party notices cover the installed dependency graph and ship with the GPL text.
- Assistant requests send the stable policy first; explicit cache controls apply only on the direct OpenAI API route for listed models (`docs/PROMPT-CACHING.md`). Token and cache usage are recorded per request; no live savings are measured.

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
The community artifact described in `docs/RELEASE.md` reports Google sign-in as unconfigured.
Configured Google access needs its own approved audience. Apple signing/notarization and real
account acceptance remain follow-up work, not release blockers for this limited ad-hoc beta.

1. Pricing and activation limit are intentionally deferred by the user. Create no product/price until those terms are chosen and the external write is approved. Configure a separate Stripe sandbox and hosting account, then verify actual Checkout/payment/key delivery/refund and deployed D1 behavior. A connected Stripe account is not proof of charge/payout readiness.
2. Live Gmail/AI-provider acceptance and first-time Reminders consent remain unverified feature acceptance. New consent and real Keychain checks require deliberately owned OS test state; a separate macOS account is not a requirement for fictional UI. Historical Google Tasks, Calendar and existing Reminders access were verified for the selected account; this does not prove public OAuth eligibility for every account.
3. Approved Developer ID signing, notarization, Gatekeeper and ordinary signed launch/account continuity on an owned installation target. October 7 metadata showed two Apple Development identities, no valid Developer ID Application identity, no `macos-release` GitHub environment and no repository signing/notarization configuration names. The proposed manual beta keeps the updater disabled; signed automatic upgrade acceptance belongs to a future updater-enabled release.
4. Manual window-drag acceptance, source migration review and public download/site publication. The preview is ad-hoc signed, not Developer ID signed or notarized, and has no merchant configuration.

The Glaze source repository and this standalone repository are separate histories and do not synchronize automatically. Preserve the public repository's history when preparing the standalone migration; do not force-push over it.

The durable local execution queue is under ignored `.workflow/standalone-release/` in the integration checkout. Recheck Git status and latest evidence before resuming. The root task owns integration and final acceptance.
