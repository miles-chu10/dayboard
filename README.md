# Dayboard

Dayboard is a native macOS productivity dashboard built with [Glaze](https://glaze.app). It brings **Google Tasks**, **Apple Reminders**, **Gmail**, and **Google Calendar** into one Agenda, with optional AI features powered by Glaze AI, your Claude subscription (Claude Code), or your ChatGPT subscription (Codex CLI).

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

- macOS with the Glaze app
- Sign in with Google from **Settings → Sources** (browser OAuth). End users do not create a Google Cloud project. Developers set the app-owned Web application client ID/secret in `main/services/google-oauth-app-client.ts` (redirect URI `https://www.glaze.app/api/oauth/callback`, with Tasks, Gmail, and Calendar APIs enabled).
- Optional: [Claude Code](https://claude.com/claude-code) and/or the [Codex CLI](https://github.com/openai/codex), signed in from Terminal, to use your subscriptions as the AI provider.

## Development

```sh
sh ./glaze-node.sh --npm install --include=dev
npm test          # offline unit and backend tests
npm run format
npm run verify    # lint, type-check, build, and publish to the managed app runtime
npm run launch    # open the verified managed app
```

Source layout: `main/` is the Node.js backend (Google, Reminders, AI providers, MCP), `renderer/` is the React UI, and `tests/` holds offline backend fixtures. Design notes live in `docs/`.

GitHub runs the offline test suite on pushes and pull requests. Optional Codex PR reviews use a separate API key and explicit activation; see [GitHub workflows](docs/github-workflows.md).

### Store screenshots

The local `demo-mode` marker in the app's user-data directory enables fictional data after a full quit and relaunch. Changing the marker while DayBoard is running does not change that session's mode. Demo settings and cached content are separate from normal use and earlier demo caches, AI responses are local samples, and live provider writes, authentication changes, external service links, and MCP access are blocked. Editors can be previewed without saving. Remove the marker and fully restart to return to normal use. Screenshot files stay in the ignored `store-screenshots/` directory.
