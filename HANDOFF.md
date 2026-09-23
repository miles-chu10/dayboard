# DayBoard standalone handoff

Read `docs/EXECPLAN.md` for the objective and `docs/RELEASE.md` for build/release gates.

## Current state

- Standalone Electron integration is implemented: platform services, sandboxed preload, native window lifecycle, React UI, Swift Reminders helper, Google Desktop OAuth, AI provider selection, local MCP, preferences and history.
- The existing Claude platform/UI/AI/licensing packets have been incorporated and reviewed. Root fixes include account-change races, native date/list validation, explicit AI-provider selection, demo isolation, accessible editor labels, persisted theme and licensing enforcement.
- Licensing includes merchant/product/variant binding, prevalidation before activation, cleanup after activation failures, serialized operations, a 14-day trial and 30-day offline grace. Missing commercial configuration produces preview mode; strict release builds reject missing configuration.
- The website is prepared in `website/`, with a real fictional-data screenshot. Purchase/download URLs remain unset until verified destinations exist.
- Version: `1.3.0-beta.1`; initial packaged target: Apple Silicon, macOS 14+.
- Manual update UI/service, DMG + ZIP packaging, save draining and temporary editing lock are implemented. Preview/demo builds never contact the updater. Third-party notices cover the installed dependency graph and ship with the GPL text.

## Verification observed

- Both TypeScript projects pass; lint passes with three existing React dependency warnings.
- 10 renderer tests and 182 backend/native tests passed. The final quit/update/MCP/IPC changes also passed a focused 28-test run.
- Ten tests passed against the final packaged app: all routes, Settings, theme/name persistence, close/reopen, mail detail modes, task/reminder editing safety, Assistant history, focus persistence, an empty normal profile, the native update menu and update-failure UI recovery.
- A fresh dependency installation passed the baseline standalone checks. The final preview DMG and ZIP include the arm64 helper, GPL text and third-party notices, with no private working artifacts in the packaged app.
- Native Settings shortcut, toolbar click, tab selection and Escape were exercised. Automated dragging did not move either the custom main title bar or the standard macOS Settings title bar, so physical window movement still needs a manual acceptance check. The main window reports movable and its drag/no-drag styles are verified.
- A packaged fictional demo reached Agenda in 1.7 seconds with warm OS caches; summed process working sets were 366 MiB. This is one local idle measurement, not a real-account benchmark or unique physical-memory measurement.
- Tests used disposable profiles, synthetic providers/licenses and unsaved EventKit objects. No real source mutation, merchant purchase or public deployment was performed.

## Remaining work

1. Real Google/Reminders operation and intended merchant configuration/test-mode checkout verification, using chosen test data.
2. Approved Developer ID signing, notarization and a signed update installation on a test Mac. No Developer ID Application identity is currently available on the build Mac.
3. Manual window-drag acceptance, source migration review and public download/site publication. The preview is unsigned and has no merchant configuration.

The Glaze source repository and this standalone repository are separate histories and do not synchronize automatically. Preserve the public repository's history when preparing the standalone migration; do not force-push over it.

The durable local execution queue is under ignored `.workflow/standalone-release/` in the integration checkout. Recheck Git status and latest evidence before resuming. The root task owns integration and final acceptance.
