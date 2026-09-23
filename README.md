# DayBoard

DayBoard is a standalone macOS productivity app built with Electron, TypeScript, and React. It brings **Google Tasks**, **Apple Reminders**, **Gmail**, and **Google Calendar** into one Agenda. The application runs without Glaze. Optional AI uses a provider you explicitly choose and configure.

This is the **1.3.0-beta.1 standalone preview**. Public downloads and purchases require the release configuration and verification described in [the release guide](docs/RELEASE.md).

## Features

- **Agenda** — today or the next 7 days across Google Tasks, Apple Reminders, and Google Calendar, with search, per-source layers, a Google Calendar–style overdue row, KiteTasks-style event bars and task chips, and a compact daily brief.
- **Linked duplicates** — linked items share one Agenda row. Completing a group updates its available, incomplete members; Undo restores only the items that operation successfully changed.
- **Edit and delete** — change task/reminder titles, notes and deadlines, or calendar titles, descriptions, times and locations directly in DayBoard. Deletion asks for confirmation and affects only the selected source item.
- **Details your way** — open tasks, reminders, and events in a pop-up, inline under the row, or in a side panel.
- **Inbox** — recent Gmail with AI triage and reply drafts saved to Gmail.
- **AI** — briefing, prioritization, natural-language capture, meeting prep, weekly review, and an Assistant that can use MCP tools. Every feature can be turned off.
- **Chat history** — search, reopen, and continue earlier Assistant conversations. Chats are saved locally per account, with separate demo history. New chat keeps the previous conversation. Use **Import Previous Chat** once to preserve the conversation retained by an older version.
- **MCP** — an optional local server lets Claude Code, Codex, and other MCP clients use Dayboard's sources while the app runs. It's off by default, requires an access key, and stays read-only unless you turn on changes (Settings → MCP Servers).
- **Settings** — accent color, Default/Compact density, detail view, source colors, relative calendar range, launch view, auto-refresh, AI provider/model/effort/speed, MCP servers, and Start at login.

### How sources sync

Each source syncs two ways with the app: completing or adding an item here writes back to Google Tasks, Apple Reminders, or Google Calendar.

Apple Reminders and Google Tasks don't copy data to each other. Instead, when an item's details show a **Possible duplicate** (a similar title in another list or app), you can **Link** it or **Dismiss** the suggestion:

- **Linked** items appear once in the Agenda, showing both list chips and a link icon. The one with the most specific deadline is shown (Google Tasks wins ties).
- **Completing an item** from Dayboard also completes available linked items, including chains of links. Source filters only change what is shown. Already-completed or unavailable partners are left alone. If one app cannot save, DayBoard reports the partial result and Undo restores only the successful changes.
- Links are saved on your Mac, per Google account, and restored after quitting and reopening DayBoard. Saved links remain visible when a title changes or a partner is temporarily unavailable. **Unlink** in the item's details at any time; nothing in either app is deleted.
- Changes made outside Dayboard (for example, completing a reminder on your iPhone) aren't mirrored to the partner.
- Editing or deleting a linked item does not edit or delete its partners. An unavailable partner remains discoverable in saved links. Recurring Apple Reminders cannot be edited/deleted occurrence-by-occurrence with the current native SDK; DayBoard explains that limitation. Undo is unavailable when completion advances a recurring reminder. Calendar edits/deletes affect the selected occurrence, never the whole series.

## Requirements

- macOS 14 or later on Apple Silicon for the current packaged target.
- Google sign-in from **Settings → Sources**, using the app's Desktop OAuth client and a browser PKCE/loopback flow. End users do not create a Google Cloud project. Developers supply their own client through `DAYBOARD_GOOGLE_OAUTH_FILE` or `~/.config/dayboard/google-oauth.json`; never commit that file. Builds without it remain usable with Google sign-in unavailable; strict release builds reject it.
- Apple Reminders permission is requested only when connecting that source. A bundled Swift EventKit helper performs the native operations.
- Optional: [Claude Code](https://claude.com/claude-code) and/or the [Codex CLI](https://github.com/openai/codex), signed in from Terminal, to use your subscriptions as the AI provider.

## Development

```sh
npm ci --include=dev
npm run dev       # builds the native helper, then starts Electron + Vite
npm test          # disposable, offline unit and native fixtures
npm run format
npm run typecheck
npm run lint
npm run test:e2e   # credential-free build; isolated demo/empty-profile Electron tests
npm run package:preview  # local unsigned DMG and update ZIP; does not publish
```

Development requires Node.js 24+ and an existing Xcode command line toolchain for the Swift helper. `main/` owns backend services; `main/platform/` implements native boundaries; `electron/preload.ts` exposes a narrow sandboxed bridge; `renderer/` owns the UI; `native/` holds the Reminders helper; `e2e/` tests the built app. `website/` is the static direct-download site.

## Official builds and community builds

The source is [GPL-3.0-only](LICENSE). You may build and modify it under that license. Set `DAYBOARD_LICENSE=off` at build time for a community build without the official-build purchase gate. The value is stamped into the binary, rather than read from the user's environment at runtime.

Configured official builds provide a 14-day trial, license activation in Settings, and a 30-day offline validation grace period. Data viewing, preferences, and account recovery remain available when a license blocks editing and AI. Demo and unconfigured preview builds never open the personal license store or make licensing requests. AI usage is not included in an app purchase.

Payments use Stripe-hosted Checkout and the separate DayBoard license service in `billing/`. Customers copy a DayBoard key from the authenticated receipt page and activate it in Settings. The app embeds only its license API origin, Stripe product ID and test/live environment. Stripe and webhook credentials stay in the backend's secret store. The normal `dist` command requires complete Google and live license-service configuration and leaves publishing disabled. See [release configuration and checks](docs/RELEASE.md).

GitHub runs the offline test suite on pushes and pull requests. Optional Codex PR reviews use a separate API key and explicit activation; see [GitHub workflows](docs/github-workflows.md).

### Demo and screenshots

`npm run test:e2e` creates disposable profiles with fictional data and a credential-free build. Demo settings/history/appearance remain separate, AI responses are local samples, and live source writes, authentication changes, licensing changes, external service links, and MCP access are blocked. Editors can be previewed without saving. Test artifacts stay in ignored directories. Never use a personal profile for automated UI tests.
