# Prompt caching and request usage

The Assistant sends its stable permission and action policy first. Each request puts one fresh, untrusted source snapshot at the start of the latest user message, ahead of the user's own text, so a request never ends with two adjacent user turns; everything before that message is identical across requests, and snapshots never enter saved conversation text. Existing history limits still apply, so truncation or a permission/model change can invalidate a reusable prefix. MCP discovery completes before server/tool ordering, nested schema key ordering and collision names are finalized.

Only the direct OpenAI API route enables explicit controls for known GPT-5.6 Sol/Terra/Luna and GPT-6 Astra/Sol/Luna families (including dated snapshots). Unknown models, older models and compatible gateways receive no new cache options. Assistant requests use implicit caching plus an explicit boundary on the stable system policy. One-shot requests use explicit-only caching on their system policy. The requested TTL is 30 minutes; no cache key or legacy 24-hour retention is forced. The direct route always uses `https://api.openai.com/v1`; an inherited `OPENAI_BASE_URL` is ignored so explicit cache options never reach a gateway. No model selection or saved setting changes.

A stable prefix must reach 1,024 visible tokens to be eligible on these supported models. Many one-shot policies are shorter. Prompts are not padded, prewarmed or sent in the background, and cache hits are not guaranteed.

## Measuring a request

The existing `usage` stream event and successful request result carry input/output/total tokens, cache reads/writes, requested and provider-reported model IDs, route and duration. A record accompanies a reply only when the provider reports usage: a successful API request always gets one (counters the provider left out are `null`), and a CLI run gets one only if the CLI prints a usage event. A one-shot CLI run records its configured model as the requested ID, or `null` when none is configured because it then requests no model. The legacy event token fields keep a display fallback (0, or for Claude-format CLI usage that lacks a cache field, the input count the CLI did report); use the nested `usage` record for measurement. Missing, invalid or inconsistent counters are `null`, not measured zero. Assistant replies retain the same record in existing account-scoped history; the one-shot `useAITask` hook exposes its current record without a new export or telemetry service.

Assistant tool requests report final aggregate totals once, and the one-shot route collects usage the same way. Every counter (input, output, cache reads, cache writes and total) is taken from each step's raw provider usage and summed only when every step reported it; otherwise it is `null`, never a missing step counted as 0. The AI SDK fills a counter a provider left out with 0, so this raw correction covers OpenAI-format and compatible providers, Google and Anthropic: a counter the provider sent, including a real 0, is kept, and one it did not send (absent or `null`) is `null`. Anthropic input is `input_tokens` plus cache reads and writes and needs all three; Gemini output is `candidatesTokenCount` plus `thoughtsTokenCount` when present, and Gemini has no cache-write counter. Claude-format CLI usage (Claude Code, Antigravity) totals input under the same all-three rule. The subscription Codex parser reads `cached_input_tokens` and, when present, `cache_write_tokens`; it never invents either.

For a user-authorized API measurement, compare the same model, policy, tools and source coverage across a cold request and repeated requests, using the existing request records. Calculate aggregate cache-read share as total known reads divided by total known input, and compare actual durations and provider billing. Do not count read/write components again in total tokens. Do not log prompt bodies, email, task contents, keys or tool arguments.

`shared/ai-usage.ts` provides an input-cost helper requiring known input/read/write counts and caller-supplied current rates per million tokens:

`((I - R - W) * Pinput + R * Pcached + W * Pwrite) / 1e6`

It returns `null` for missing components, invalid rates or counters exceeding input. This excludes output charges and other fees. Do not use API prices to claim dollar savings for subscription CLI, Glaze or other bundled access.

## Verification boundary

Offline tests intercept provider fetches and inject synthetic settings, keys, MCP discovery and responses. They verify wire fields, model gating, unchanged prefixes and history, changed snapshot suffixes, tool collisions, per-provider sent, absent and null usage counters, provider failure and multi-step aggregation. No live provider request or measured savings is claimed.

References: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI model catalog](https://developers.openai.com/api/docs/models), [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai).
