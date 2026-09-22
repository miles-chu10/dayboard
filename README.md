# Dayboard

Dayboard is a native macOS productivity dashboard built with [Glaze](https://glaze.app). It brings **Google Tasks**, **Apple Reminders**, **Gmail**, and **Google Calendar** into one Agenda, with optional AI features powered by Glaze AI, your Claude subscription (Claude Code), or your ChatGPT subscription (Codex CLI).

## Features

- **Agenda** — today or the next 7 days across Google Tasks, Apple Reminders, and Google Calendar, with search, per-source layers, a Google Calendar–style overdue row, KiteTasks-style event bars and task chips, and a compact daily brief.
- **Linked duplicates** — the same to-do in Google Tasks and Apple Reminders can be linked. A linked pair shows as one Agenda row with both list chips, and checking it off completes it in both apps (Undo reverts both).
- **Details your way** — open tasks, reminders, and events in a pop-up, inline under the row, or in a side panel.
- **Inbox** — recent Gmail with AI triage and reply drafts saved to Gmail.
- **AI** — briefing, prioritization, natural-language capture, meeting prep, weekly review, and an Assistant that can use MCP tools. Every feature can be turned off.
- **MCP** — an optional local server lets Claude Code, Codex, and other MCP clients use Dayboard's sources while the app runs. It's off by default, requires an access key, and stays read-only unless you turn on changes (Settings → MCP Servers).
- **Settings** — accent color, Default/Compact density, detail view, source colors, relative calendar range, launch view, auto-refresh, AI provider/model/effort/speed, MCP servers, and Start at login.

### How sources sync

Each source syncs two ways with the app: completing or adding an item here writes back to Google Tasks, Apple Reminders, or Google Calendar.

Apple Reminders and Google Tasks don't copy data to each other. Instead, when an item's details show a **Possible duplicate** (a similar title in another list or app), you can **Link** it or **Dismiss** the suggestion:

- **Linked** items appear once in the Agenda, showing both list chips and a link icon. The one with the most specific deadline is shown (Google Tasks wins ties).
- **Completing either** item from Dayboard also completes its linked partner in the other app; Undo reverts both. If one app can't be reached, Dayboard says which one wasn't updated.
- Links are stored only on your Mac, per Google account. **Unlink** in the item's details at any time; nothing in either app is deleted.
- Changes made outside Dayboard (for example, completing a reminder on your iPhone) aren't mirrored to the partner.

## Requirements

- macOS with the Glaze app
- A Google Cloud project with the Tasks, Gmail, and Calendar APIs enabled and an OAuth client of type **Web application** using the redirect URI `https://www.glaze.app/api/oauth/callback`. Enter the client ID and secret in **Settings → Sources**; they are stored encrypted on the Mac, never in this repository.
- Optional: [Claude Code](https://claude.com/claude-code) and/or the [Codex CLI](https://github.com/openai/codex), signed in from Terminal, to use your subscriptions as the AI provider.

## Development

```sh
npm install --include=dev
npm test          # offline unit and backend tests
npm run verify    # lint, type-check, and build
```

Source layout: `main/` is the Node.js backend (Google, Reminders, AI providers, MCP), `renderer/` is the React UI, and `tests/` holds offline backend fixtures. Design notes live in `docs/`.
