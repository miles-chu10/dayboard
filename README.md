# Dayboard

Dayboard is a native macOS productivity dashboard built with [Glaze](https://glaze.app). It brings **Google Tasks**, **Apple Reminders**, **Gmail**, and **Google Calendar** into one Agenda, with optional AI features powered by Glaze AI, your Claude subscription (Claude Code), or your ChatGPT subscription (Codex CLI).

## Features

- **Agenda** — today or the next 7 days across Google Tasks, Apple Reminders, and Google Calendar, with search, per-source layers, overdue and undated backlogs, and a compact daily brief.
- **Inbox** — recent Gmail with AI triage and reply drafts saved to Gmail.
- **AI** — briefing, prioritization, natural-language capture, meeting prep, weekly review, and an Assistant that can use MCP tools. Every feature can be turned off.
- **MCP** — an optional local server lets Claude Code, Codex, and other MCP clients use Dayboard's sources while the app runs. It's off by default, requires an access key, and stays read-only unless you turn on changes (Settings → MCP Servers).
- **Settings** — source colors, relative calendar range, launch view, auto-refresh, AI provider/model/effort/speed, MCP servers, and Start at login.

### How sources sync

Each source syncs two ways with the app: completing or adding an item here writes back to Google Tasks, Apple Reminders, or Google Calendar. Apple Reminders and Google Tasks are **not** synced with each other — they appear side by side, and duplicates can be linked locally without copying data between services.

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
