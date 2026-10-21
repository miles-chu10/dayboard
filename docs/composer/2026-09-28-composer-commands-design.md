# DayBoard composer: effort picker, slash commands and @ mentions — design

Approved by Miles on 2026-09-28. Ships as standalone DayBoard 1.3.0-beta.9 and Glaze DayBoard 1.2.5, after beta 8 and Glaze 1.2.4.

## Goal

In the Assistant composer, Miles can set reasoning effort from a Codex-style picker, run DayBoard commands by typing `/`, and pull a specific event, task, reminder or email into a message by typing `@`. Both the standalone and Glaze builds get the same behavior.

## Decisions

| Decision                | Choice                                                                                                | Source                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Builds                  | Standalone and Glaze                                                                                  | Miles, 2026-09-28                                                                                   |
| Picker look             | Match the Codex composer effort picker                                                                | Miles; reference `codex-effort-picker-reference.jpg`                                                |
| Ultra                   | The top slider stop where the route supports it; shown dimmed and unselectable elsewhere              | Miles                                                                                               |
| Slash menu contents     | DayBoard commands and @ mentions now; the user's Claude Code/Codex skills as a follow-on spec         | Miles picked all three; the skills option was described as a separate follow-up                     |
| Effort scope            | The composer's effort applies to the Assistant chat only; one-click features keep the Settings effort | Miles                                                                                               |
| Release                 | Beta 9 after beta 8; Glaze 1.2.5 after 1.2.4                                                          | Miles                                                                                               |
| Global effort shortcuts | None; the slider takes arrow keys and `/effort` sets it by keyboard                                   | Codex's own increase/decrease/cycle commands have no default keys (checked in the Codex app bundle) |

## Non-goals

- Running the user's own Claude Code or Codex skills and commands (follow-on spec, below).
- Showing model reasoning in the chat. Unknown stream chunk types currently render as tool events (`renderer/main/assistant-view.tsx:401-424`), so reasoning display is its own change.
- Effort for Google, the compatible gateways (xAI, Mistral, DeepSeek, Groq, OpenRouter), Antigravity, Muse or Glaze AI. Their effort support is unverified or absent.
- Slash commands or mentions in the Today card's composer (`renderer/components/ask-assistant-card.tsx`).
- Saved prompts.

## 1. Effort picker

### Look (matches Codex)

- **Closed:** the existing model chip shows the model label and, in muted text, the effort label, for example "GPT-6-Astra Max". When the model has no effort control, the chip shows only the model, as today. The Fast badge stays.
- **Open:** a panel above the chip, right-aligned with it:
  - **Top left:** a bolt button that toggles Fast mode. It shows only where Fast mode exists (Claude `claudeFast`, Codex `codexServiceTier`) and replaces the Fast checkbox in today's model menu. The bolt in Codex's chip and panel is its Fast-mode indicator, not an effort glyph.
  - **Top center:** the current effort label in the accent color.
  - **Top right:** a reset button that returns to the model's default, which means DayBoard sends no effort override.
  - **Second line:** the model label with a chevron. It opens the existing provider and model menu, including "Connect Accounts & AI Settings…".
  - **Slider:** one stop per level the current model supports, in order. Arrow keys move one stop.
  - **Ultra:** when Ultra is selected, a line under the slider reads "Runs several agents at once and uses your limit much faster."
  - **Ultra where it isn't supported:** on every route with a slider but no Ultra (the OpenAI and Anthropic APIs, Claude Code, and Codex models whose catalog doesn't list it), Ultra appears as a dimmed dot past the last stop, like the dot in Codex's slider. The thumb can't reach it by drag, click or arrow keys. Hovering or focusing it shows "Ultra is available with Codex on GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Sol or Terra." That list comes from the live Codex catalog when there is one, otherwise from the models named here. `/effort ultra` on these routes shows the same message instead of changing anything.
  - **No effort control:** the slider area reads "This model doesn't have effort settings."
- **While open:** the chip label reads "Select effort", as Codex's does.

Labels, from Codex: `none` None, `minimal` Minimal, `low` Light, `medium` Medium, `high` High, `xhigh` Extra High, `max` Max, `ultra` Ultra.

### Levels by route

| Route                                         | Levels                                                                                                                                                                                                                                                                                                                                     | How DayBoard sends it                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Codex CLI                                     | The live catalog from `codex debug models`, per model (`supported_reasoning_levels`, `default_reasoning_level`), already parsed in `main/services/ai/codex-models.ts`. On 2026-09-28 Ultra was listed for gpt-6-astra, gpt-6-sol, gpt-5.6-sol, gpt-5.6-terra and gpt-daybreak-blue-latest, and not for gpt-6-luna, gpt-5.6-luna or gpt-5.5 | `-c model_reasoning_effort="<level>"` (existing `codexModelArgs`)                   |
| Claude Code CLI                               | Light, Medium, High, Extra High, Max; none on Haiku                                                                                                                                                                                                                                                                                        | `--effort <level>` (existing `claudeModelArgs`)                                     |
| OpenAI API (Responses)                        | GPT-6 Astra, Sol and Luna, and GPT-6.1 Sol: Light–Max (the installed `@ai-sdk/openai` passes only low–max for GPT-6 and later, so None isn't offered there). GPT-5.6 Sol/Terra/Luna: None–Max. Other models: no control                                                                                                                    | `providerOptions.openai.reasoningEffort`, deep-merged with the prompt-cache options |
| Anthropic API                                 | Claude Fable 5.1/5, Opus 5.5/5, Sonnet 5.5/5, Opus 4.8/4.7: Light–Max. Opus 4.6 and Sonnet 4.6: Light, Medium, High, Max. Haiku 4.5: no control                                                                                                                                                                                            | `providerOptions.anthropic.effort` (the SDK sends `output_config.effort`)           |
| Google, gateways, Antigravity, Muse, Glaze AI | No control                                                                                                                                                                                                                                                                                                                                 | Nothing                                                                             |

Sources: OpenAI's model and reasoning guides (GPT-6 Astra rejects `none` with HTTP 400; Sol and Luna accept it); the `@ai-sdk/openai` 3.0.115 option docs for GPT-5.6; the Claude API reference for Anthropic effort by model; the Codex catalog read on this Mac. Model families are matched by exact ID pattern, including dated snapshots, like `supportsExplicitCache` in `main/services/ai/prompt-cache.ts`. An unknown model gets no control rather than a guess.

### Saving and scope

- **New setting:** `ai.assistantEffort: Partial<Record<AIProvider, string>>`. An empty or missing value means "model default". Values pass the existing effort token check (`/^[a-z][a-z0-9_-]{0,30}$/`, `settings-store.ts`). Add it to `AppSettings`, `DEFAULT_SETTINGS` and `normalizeSettings`, which drops unknown keys.
- **The composer reads and writes only `assistantEffort`.** `claudeEffort` and `codexEffort` keep driving the one-click features. Settings → AI relabels their control "Effort for AI features".
- **Switching models** keeps the effort if the new model supports it and clears it otherwise.
- **At send time,** the Assistant checks the stored effort against the current model's levels. If it's not supported (for example, the catalog changed), DayBoard sends the model default and the picker shows it. This fallback applies to the Assistant only. The existing throw in `codexModelArgs` stays for the feature path.
- **Demo mode:** the Codex catalog is empty in demo, so Codex shows no slider. Claude and API routes follow the table.

### Prompt caching

- Effort never goes into the system prompt on API routes. `modelSystemNote` (which adds "Reasoning effort: X.") stays CLI-only, as today.
- A mid-chat effort change on OpenAI or Anthropic costs one request without cache reuse; later requests reuse the new prefix.
- GPT-6's `reasoningEffortUpdate` could avoid that miss. It needs a per-chat baseline effort and conflicts with automatic truncation, so it's left out of this version.
- `apiPromptOptions` already returns `providerOptions.openai`; effort options are deep-merged into it, and the existing wire tests in `tests/prompt-cache.test.mjs` must still pass unchanged.

## 2. Slash menu

- **Opens** when the message's first character is `/`. It filters on the text after the slash (command name first, then description) and closes when the text no longer starts with `/` or has no match.
- **Keys:** ↑ and ↓ move, Enter or Tab picks, Esc closes. Keys pass through `ComposerInput`'s existing `onKeyDown` → `defaultPrevented` hook (`renderer/ui/ai-chat.tsx`). The textarea keeps `role="textbox"`, which the e2e tests rely on, and gains `aria-controls`, `aria-expanded` and `aria-activedescendant` for the list. Enter during IME composition is ignored (`event.nativeEvent.isComposing`), which also fixes today's IME submit.
- **Actions** run on Enter or Tab, then clear the input:

| Command                        | Does                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/new`                         | Start a new chat (same as the New chat button)                                                                                                                                                  |
| `/history`                     | Open chat history                                                                                                                                                                               |
| `/model`                       | Open the model and effort panel                                                                                                                                                                 |
| `/effort [level]`              | With a level (a label or value, like `high`, `extra high`, `xhigh`, `ultra`): set it if the model supports it, otherwise show a toast listing the supported levels. Without one: open the panel |
| `/mode [read-only\|ask\|auto]` | Set the permission mode; without an argument, open that menu                                                                                                                                    |
| `/attach`                      | Open the file picker (not in demo)                                                                                                                                                              |
| `/mcp`                         | Open MCP servers                                                                                                                                                                                |
| `/settings`                    | Open AI settings                                                                                                                                                                                |

- **Prompts:** Enter sends the prompt; Tab replaces the input with the prompt text for editing:

| Command    | Prompt                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| `/focus`   | What should I focus on for the rest of today?                                                |
| `/replies` | Summarize the emails that need a reply                                                       |
| `/free`    | When am I free tomorrow for an hour of deep work?                                            |
| `/overdue` | What's overdue, and what could I drop?                                                       |
| `/brief`   | Give me a short briefing for today: my meetings, what's due, and emails that need attention. |
| `/week`    | Review my week: what got done, what slipped, and what to focus on next week.                 |

The first four reuse `ASSISTANT_SUGGESTIONS` (`renderer/lib/assistant.ts`) so the chips and commands can't drift.

- **Sections:** Actions, then Prompts. A later "Your skills" section is reserved for the follow-on.
- **While a reply is running,** actions still work; prompts wait, following the existing send guard.

## 3. @ mentions

- **Opens** on `@` at the start of the text or after whitespace, so an email address like `bob@example.com` doesn't trigger it. It filters by the text after `@` and closes on Esc, when the caret leaves the `@` token, or when a space follows a query with no matches.
- **Candidates:** today's and the next 7 days' events, open tasks, open reminders, and the inbox messages DayBoard has loaded (`mail:list`), all taken from the renderer's existing queries (the same data the snapshot uses). Order: exact-prefix title matches, then events by start time, then tasks and reminders by due date, then emails by date. The menu shows at most 20.
- **Picking one** removes the `@query` text and adds a chip to the composer's chip row, beside file attachments, with an icon per kind and a remove button. At most 10 mentions.
- **At send:**
  - The Assistant receives each mentioned item in full, inside the existing untrusted snapshot, in a "Mentioned items" block after the current snapshot. Events carry title, time, location, attendees and notes. Tasks and reminders carry title, list, due date and notes. Emails carry sender, subject, date and the body from the existing `mail:getBody` IPC, which already handles demo mode, capped at 20,000 characters.
  - The IPC payload doesn't change. The snapshot string is already validated up to 400,000 characters.
- **Saved chat:** user messages gain an optional `mentions?: {kind: "event" | "task" | "reminder" | "email"; label: string}[]`, shown as chips on the message. It's added to the `normalizeMessage` whitelist, omitted when empty, and the history file `VERSION` stays 1. The full item content is never saved, just as snapshots aren't.
- **Failures:** if an email body can't load, the block carries the summary and says the body was unavailable. If a mentioned item was deleted before send, it's dropped and the chip shows why.

## 4. Architecture

- `shared/ai-effort.ts` (new): the effort-level table and label map, `effortOptions(route, modelId, codexCatalog?)` returning `{levels, defaultLevel}`, and a parser for `/effort` arguments. Used by the renderer (picker, `/effort`) and main (validation at send).
- **Settings:** `main/shared-types.ts`, `main/services/settings-store.ts`, `renderer/settings/ai-tab.tsx` (relabel).
- **Request path:** `main/services/ai/assistant.ts` reads `assistantEffort[provider]` and validates it. It then calls `model-options.ts` for the CLI arguments, or builds `providerOptions` for API routes. Main owns the send-time check.
- **Renderer:**
  - `renderer/components/assistant-composer.tsx`: chip and effort panel.
  - New `renderer/ui/popover.tsx` and `renderer/ui/slider.tsx` wrappers over the installed `radix-ui` Popover and Slider.
  - New `renderer/components/composer-menu.tsx`: one listbox popover used for both `/` and `@`.
  - New `renderer/lib/assistant-commands.ts` (the command registry) and `renderer/lib/assistant-mentions.ts` (candidates and context building).
  - `renderer/main/assistant-view.tsx`: action dispatch, mention context at send, message chips.
- **Glaze:** the logic modules are the same files. The UI uses Glaze's public components (`command`, `slider`, `dropdown-menu` from `@glaze/core/components`) instead of the new standalone wrappers, so the component files differ. No Glaze SDK source is copied.

## 5. Testing

- **Unit (Node test runner):**
  - `effortOptions` for every route and model row in the table, including dated snapshots, unknown models, Haiku and Ultra availability from a catalog fixture.
  - `normalizeSettings` for `assistantEffort`.
  - CLI arguments with an Assistant effort (Claude `--effort`, Codex `-c model_reasoning_effort`).
  - OpenAI and Anthropic provider options merged with the prompt-cache options; the existing wire tests stay unchanged.
  - Fallback when a stored effort isn't supported.
  - Command filtering and `/effort` and `/mode` argument parsing.
  - The mention context block, with its untrusted markers and caps.
  - History round-trip with and without `mentions`, plus old files.
  - Demo isolation stubs for any new module with side effects.
- **Playwright (`e2e/`):**
  - Type `/` and see the menu. ↓ and Enter run `/new`. Tab on `/focus` fills the text.
  - Open the effort panel, move the slider, and see the chip label change. Reset returns to the default.
  - On a Claude or API route, the dimmed Ultra dot is present, the thumb stops at the last supported level, and its tooltip names the Codex models.
  - `@lun` shows the demo event. Picking it adds a chip; sending shows the chip on the message.
- **Glaze:** `npm test`, `npm run verify` (after confirming no DayBoard Glaze app is running), and the same unit tests.

## 6. Order of work

1. Wait for beta 8's fixes to land and pass re-review, since this touches the same files (`assistant.ts`, `handlers/ai.ts`, `prompt-cache.ts`, `model-options.ts`, `settings-store.ts`, `shared-types.ts`, `assistant-composer.tsx`).
2. Cut `feat/composer-commands` from `feat/prompt-caching`, or from `main` if beta 8 has merged. Move this spec into the repo on that branch.
3. Build the standalone, then port to Glaze, then release beta 9 and Glaze 1.2.5 through the approval gates in plan 006.

## Follow-on: the user's Claude Code and Codex skills

Miles wants these; they need their own spec because DayBoard runs the CLIs in a way that keeps most skills from working:

- **Claude:** runs with `--tools ""`, only DayBoard's MCP tools and `--strict-mcp-config`, a working directory of `<userData>/ai-workspace`, and a transcript that starts "User's latest message:", so a typed `/skill` is never the first text.
- **Codex:** runs with `--ignore-user-config` and a read-only sandbox.

The spec has to settle:

- which tools a skill may use, since turning on file or shell tools in a chat that can read your email is a security change;
- how discovery reads names and descriptions only from `~/.claude/skills` (521), `~/.claude/commands` (1), `~/.codex/skills` (372) and `~/.agents/skills` (264), with search and no demo reads;
- how the prompt is restructured so the CLI sees the command;
- how results and failures show in the chat.
