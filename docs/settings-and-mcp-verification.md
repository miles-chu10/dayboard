# Settings and local MCP verification

Source: the project root, baseline `fe4242e`. App ID: `dashboard-local-25d26qqt`. Implemented September 22, 2026, preserving the earlier Agenda work and Glaze changes.

## Delivered

- **General → Calendar range:** Today, Today & Tomorrow, Next 3 days, This week through Sunday, Next 7 days, Next 2 weeks, Rest of this month. The Calendar route uses the saved range; its picker and existing URL overrides remain usable. Numeric legacy settings migrate to the matching relative range.
- **AI → ChatGPT:** model picklist from `codex debug models`, refresh/retry, the selected model's reasoning levels and speed tiers. The installed CLI reported six visible models. Unsupported saved combinations fail before generation. Dashboard runs use `--ignore-user-config` so its Standard/Fast and MCP choices do not inherit unrelated Codex settings; CLI authentication remains available. Default means Codex's recommended default.
- **AI → Claude:** model aliases, thinking effort, and Fast where supported. Haiku effort is disabled; Fast is restricted to Opus choices and explicitly disabled otherwise so another model cannot be silently changed to Opus. The label discloses paid usage credits.
- **General → Start at login:** public Glaze `app.getLoginItemSettings()` / `app.setLoginItemSettings()` through narrow IPC. The switch uses OS readback and reports errors/approval requirements. No automatic enablement was performed.
- **MCP Servers → Dashboard:** built-in authenticated local read-only connection, automatically included when Assistant MCP is enabled. Tools: `list_tasks`, `list_reminders`, `list_inbox`, `read_email`, `list_events`, `get_weekly_review`. No extra package/server daemon is required. Custom-server settings and existing external `/mcp` clients are preserved.

## Evidence

- `npm test`: 29 passing tests (8 Agenda, 21 backend/HTTP/settings/startup/MCP fixtures). The affected MCP fixture passed again after the session-cleanup fix.
- `npm run format` and `npm run verify`: passed lint, type checking, and production build; published to the managed runtime.
- `npm run launch`: structured `ok: true`, latest request `aa519d5d-727e-4259-8586-a2a165a8c802`.
- Running backend log at `2026-09-22T09:57:06.028Z`: Assistant MCP self-check `{ok:true, toolCount:6}`. It initializes and lists tools without reading private source data.
- Independent live probes: `/assistant-mcp` rejects unauthenticated requests with 401; legacy `/mcp` initializes with 200 and its session terminates with 200.
- Fixtures cover read-only tool enforcement, foreign Host/Origin rejection, global MCP toggle, duplicate connections, custom-server fallback, HTTP-session termination, per-model capability validation, and failed login-item updates.

## Remaining native checks

Computer Use is unavailable in this task. Native Settings layout, changing/saving choices across relaunch, OS login-item interaction, and the earlier Agenda keyboard checks remain unverified. No AI generation or real task/email/calendar writes were performed during these checks.

## References

Codex settings and Fast behavior: [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Speed](https://learn.chatgpt.com/docs/agent-configuration/speed). Installed CLI help confirms `exec --ignore-user-config` retains authentication.

Claude aliases/effort and Fast availability: [Model configuration](https://code.claude.com/docs/en/model-config), [Fast mode](https://code.claude.com/docs/en/fast-mode). Provider availability can change; Codex choices are refreshed from the installed CLI rather than hard-coded.
