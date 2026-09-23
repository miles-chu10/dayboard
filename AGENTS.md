# DayBoard

Standalone macOS Electron app (GPL-3.0-only): Google Tasks, Gmail, Google Calendar, Apple Reminders, an AI assistant, and a local MCP server in one dashboard. Ported from a Glaze app; the goal, decisions, phases, and progress live in `docs/EXECPLAN.md`, and the current state in `HANDOFF.md`. Read both before starting work.

## Structure

- `main/` — Electron main process (Node). `index.ts` entry, `handlers/` IPC handlers, `services/` Google, Reminders, AI, MCP, licensing and settings; `window.ts` owns window lifecycle.
- `main/platform/` — Glaze-compatible platform layer over Electron (`app`, `ipcMain.handle/handleStream/broadcast`, async `safeStorage`, `reminders`, `logger`, OAuth token store). See its `README.md`.
- `electron/preload.ts` — the only preload. Exposes `window.dayboard` (typed in `renderer/types/dayboard-bridge.d.ts`) via `contextBridge`; never expose `ipcRenderer` or Node APIs.
- `shared/` — code used by main, preload, and renderer. `bridge-protocol.ts` defines the IPC wire protocol.
- `renderer/` — React 19, TanStack Router/Query, Tailwind 4. Windows: `main-window.html` → `renderer/main`, `settings-window.html` → `renderer/settings`.
- `tests/` — Node test runner suites (`*.test.mjs`) that bundle backend modules with esbuild; `renderer/lib/agenda.test.ts` runs under tsx. `e2e/` — Playwright Electron specs.
- `resources/bin/` — build output of the Swift Reminders helper (gitignored), shipped as `Contents/Resources/bin`.
- `build/` — electron-builder resources (`entitlements.mac.plist`). `electron-builder.yml` — packaging config.
- `billing/` — separately deployed Cloudflare Worker + D1 for Stripe Checkout, payment fulfillment and license activation. Its dependencies and credentials never ship in the Mac app.

Path aliases (`electron.vite.config.ts`, `tsconfig.*.json`): `@main/*` → `main/*`, `@renderer/*` → `renderer/*`, `@shared/*` → `shared/*`.

## Commands

Run from the repo root. The shell may export `NODE_ENV=production`, which makes npm skip devDependencies: install with `npm install --include=dev`.

- `npm run dev` — electron-vite dev (HMR renderer). Stop it when done.
- `npm run build` — build main, preload, renderer into `out/`.
- `npm run typecheck` — `tsc` over `tsconfig.node.json` (main, preload, shared, tests) and `tsconfig.web.json` (renderer).
- `npm run lint` / `npm run format` (oxfmt, width 100) / `npm run format:check`.
- `npm test` — unit tests. `npm run test:e2e` — builds, then Playwright Electron E2E.
- `npm run package:preview` — local ad-hoc-signed (not notarized) arm64 preview DMG and update ZIP; no publishing.
- `npm run test:billing` — typecheck and test the separate license backend after installing its dependencies.
- `npm run package:test` — credential-free ad-hoc-signed test app.
- `npm run dist` — unsigned arm64 release candidate in `release/`, requiring complete build configuration; publishing remains disabled. See `docs/RELEASE.md` for signing and external gates.
- `postinstall` runs `electron-builder install-app-deps` to rebuild node-pty for Electron.

## Conventions

- TypeScript strict, ESM, 2-space indent. Concise code; comments only for non-obvious logic.
- Runtime `dependencies` are only what the main process loads at runtime (externalized, shipped in `app.asar`). Renderer libraries are bundled by Vite, so they belong in `devDependencies`.
- New IPC: register in `main/handlers`, validate every payload, add the channel to the renderer via `window.dayboard.ipc`. Streams use `ipcMain.handleStream`; push updates with `ipcMain.broadcast`.
- No stubs, TODOs, or mock data standing in for required behavior. Demo mode data lives in `main/services/demo-data.ts`.

## Constraints (until Miles approves)

- No outward or permanent actions: no `git push`, remotes, GitHub repo/PR/release commands, publishing, account sign-ups, purchases, or signing/notarization with real identities. Local commits are fine.
- Never copy proprietary Glaze SDK source. Public API documentation may be read for compatibility reference. Preserve the separate Glaze project.

## Secrets

- Never print, log, or commit secrets, tokens, or API keys. User credentials are stored with `safeStorage` (Keychain) under `userData`, never in plain files.
- The Google Desktop OAuth client is injected at build time from `DAYBOARD_GOOGLE_OAUTH_FILE` or `~/.config/dayboard/google-oauth.json`. Do not read or print its contents. Ordinary builds without it report Google sign-in as unconfigured; test builds use blank constants; strict release builds reject missing client or merchant configuration.
- Stripe replaced Lemon Squeezy by the user's explicit choice. The license API HTTPS origin, Stripe product ID and test/live environment are public app build inputs. Stripe API/webhook and key-encryption secrets exist only in the backend's secret store. Demo/community/unconfigured licensing must not read personal license records or contact the license service.
- Developer secrets go through 1Password (`op run --env-file=.env.template -- <cmd>`); never write plaintext `.env` files.
