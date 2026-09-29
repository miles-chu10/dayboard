# Prompt caching and request usage

The Assistant sends its stable permission and action policy first. Each request inserts one fresh, untrusted source snapshot immediately before the latest user request; snapshots never enter saved conversation text. Existing history limits still apply, so truncation or a permission/model change can invalidate a reusable prefix. MCP discovery completes before server/tool ordering, nested schema key ordering and collision names are finalized.

Only the direct OpenAI API route enables explicit controls for known GPT-5.6 Sol/Terra/Luna and GPT-6 Astra/Sol/Luna families (including dated snapshots). Unknown models, older models and compatible gateways receive no new cache options. Assistant requests use implicit caching plus an explicit boundary on the stable system policy. One-shot requests use explicit-only caching on their system policy. The requested TTL is 30 minutes; no cache key or legacy 24-hour retention is forced. No model selection or saved setting changes.

A stable prefix must reach 1,024 visible tokens to be eligible on these supported models. Many one-shot policies are shorter. Prompts are not padded, prewarmed or sent in the background, and cache hits are not guaranteed.

## Measuring a request

The existing `usage` stream event and successful request result carry input/output/total tokens, cache reads/writes, requested and provider-reported model IDs, route and duration. The legacy event token fields keep their display fallback; use the nested `usage` record for measurement. Missing, invalid or inconsistent counters are `null`, not measured zero. Assistant replies retain the same record in existing account-scoped history; the one-shot `useAITask` hook exposes its current record without a new export or telemetry service.

Assistant tool requests report final aggregate totals once. Cache components are summed only when every step supplies them. The SDK's synthesized zero for omitted OpenAI cache reads is corrected using raw usage. The subscription Codex parser retains `cached_input_tokens`; it does not invent a cache-write counter.

For a user-authorized API measurement, compare the same model, policy, tools and source coverage across a cold request and repeated requests, using the existing request records. Calculate aggregate cache-read share as total known reads divided by total known input, and compare actual durations and provider billing. Do not count read/write components again in total tokens. Do not log prompt bodies, email, task contents, keys or tool arguments.

`shared/ai-usage.ts` provides an input-cost helper requiring known input/read/write counts and caller-supplied current rates per million tokens:

`((I - R - W) * Pinput + R * Pcached + W * Pwrite) / 1e6`

It returns `null` for missing components, invalid rates or counters exceeding input. This excludes output charges and other fees. Do not use API prices to claim dollar savings for subscription CLI, Glaze or other bundled access.

## Verification boundary

Offline tests intercept provider fetches and inject synthetic settings, keys, MCP discovery and responses. They verify wire fields, model gating, unchanged prefixes and history, changed snapshot suffixes, tool collisions, unknown/zero usage, provider failure and multi-step aggregation. No live provider request or measured savings is claimed.

References: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI model catalog](https://developers.openai.com/api/docs/models), [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai).
