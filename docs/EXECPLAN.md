# Plan: DayBoard standalone macOS release

## Goal

Deliver a standalone Electron + TypeScript macOS app with Google Tasks, Gmail, Google Calendar, Apple Reminders, Agenda, optional AI, saved conversations and local MCP. Publish open-source code under GPL-3.0 and offer paid official builds through the product website. Glaze remains a separate reference implementation during the transition.

The root integration task owns the plan, test evidence and final acceptance. Bounded workers own disjoint files. Completed platform, UI, AI and licensing contributions have been incorporated; no duplicate implementation supervisor is required.

## Decisions

- Electron/React/TypeScript preserves the existing UI and Node services. The platform boundary uses a sandboxed preload and authenticated IPC senders; the Swift EventKit helper provides Apple Reminders access.
- GPL-3.0 permits building, modifying, selling and redistributing the code under its terms. Paid official builds fund convenient distribution, updates and support; the license does not prohibit commercial forks.
- The user chose Stripe to replace Lemon Squeezy. Hosted Checkout and a separate DayBoard license service handle one-time purchases and activation. Official builds retain the 14-day trial and 30-day offline validation grace. Price, account, tax setup and public launch remain unconfigured until verified; standard Stripe Checkout is not described as a merchant-of-record service.
- Google uses a Desktop OAuth client with browser PKCE and a loopback callback. Build inputs never contain end-user tokens. Real credentials are encrypted under the standalone app's own data directory.
- AI is optional and uses a provider the user explicitly chooses. Legacy Glaze settings do not silently send data to another provider. AI usage is supplied through the user's own provider access.
- Initial package target: Apple Silicon and macOS 14+. Intel support is not yet claimed.

## Work and evidence

| Milestone                            | State                                 | Required evidence                                                                                            |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Port platform and UI                 | Implemented                           | Typecheck, lint, standalone build, no host runtime imports                                                   |
| Preserve behavior and account safety | Implemented                           | Unit/native fixtures, source isolation, race and failure tests                                               |
| AI and licensing                     | Stripe implemented and tested locally | 207 app tests; 16 billing tests including local Worker/D1/SDK integration; focused security findings closed  |
| App interaction                      | Verified locally                      | Ten packaged Electron tests, one isolated editor regression, real MCP setup and native-helper fault recovery |
| Preview distributable                | Verified locally                      | DMG + ZIP, helper/notices inventory, packaged tests, resource measurements and fresh dependency install      |
| Website/source preparation           | Prepared locally                      | Static site render/links, GPL source and reproducible instructions                                           |
| Live Google and Reminders acceptance | Verified for the selected account     | Sign-in, real token refresh, relaunch, three labeled item round-trips and verified deletion, then sign-out   |
| Real integrations and public release | Pending external gates                | Intended accounts, real operations, test checkout, signing/notarization and publication readback             |

## Execution loop

Claim a bounded item, implement it, run its gate, fix observed failures and persist evidence. Repeat until the acceptance criteria pass. Reuse passing checks until changed code or a concrete remaining risk requires a rerun. A build, worker completion or mock checkout alone does not prove public readiness.

Automated UI tests always use disposable profiles. Normal-profile tests disable connected sources before launching; temporary app storage does not isolate the system's EventKit account. Demo mode must avoid live authentication, provider calls, licensing records and source mutations.

## Release gates

Follow `RELEASE.md`. Real merchant/account setup, purchases, use of signing identities and external publishing require the intended destination and concrete approval. Prepare artifacts first. Keep local implementation and testing moving while external decisions are pending.

Preserve unrelated changes, source identities and the working Glaze app. Never copy proprietary SDK source, expose credentials, overwrite `.env` files, weaken app security or force-push one repository's history over another.

## Stripe replacement

Build a separate TypeScript Worker with D1, paid-session fulfillment, cookie-authenticated key delivery, license activation/validation/deactivation and durable refund/dispute revocation. Keep Stripe dependencies and secrets out of Electron. Version the desktop cache, preserve earlier encrypted records, and bind licenses to service origin, product and environment. Concurrent webhook delivery and activation must be safe at the database boundary. Local tests use disposable databases and synthetic Stripe transport; sandbox purchase/refund verification and production deployment remain explicit release gates.

The user has selected the Stripe account and deliberately deferred pricing. The price and activation limit remain unset. No product, price, payment, backend deployment or public release has been created by this migration.
