# Prompt caching and request usage

The Assistant sends its stable permission and action policy first. Each request inserts one fresh, untrusted source snapshot immediately before the latest user request; snapshots never enter saved conversation text. Existing history limits still apply, so truncation or a permission/model change can invalidate a reusable prefix. MCP discovery completes before server/tool ordering, nested schema key ordering and collision names are finalized.

Only the direct OpenAI API route enables explicit controls for known GPT-5.6 Sol/Terra/Luna and GPT-6 Astra/Sol/Luna families (including dated snapshots). Unknown models, older models and compatible gateways receive no new cache options, and neither do Glaze AI (the default provider in this build) or the subscription CLIs. Assistant requests use implicit caching plus an explicit boundary on the stable system policy. One-shot requests use explicit-only caching on their system policy. The requested TTL is 30 minutes; no cache key or legacy 24-hour retention is forced. No model selection or saved setting changes.

A stable prefix must reach 1,024 visible tokens to be eligible on these supported models. Many one-shot policies are shorter. Prompts are not padded, prewarmed or sent in the background, and cache hits are not guaranteed.

## Measuring a request

Every route produces one `usage` record: input/output/total tokens, cache reads/writes, requested and provider-reported model IDs, route and duration. The backend routes (direct API providers, subscription CLIs and the Assistant) send it in the existing `usage` stream event and successful request result. The legacy event token fields keep their display fallback; use the nested `usage` record for measurement. The one-shot `useAITask` hook exposes its current record for every provider, including Glaze AI, without a new export or telemetry service. Assistant replies retain their record in existing account-scoped history; one-shot records are not saved. Missing, invalid or inconsistent counters are `null`, not measured zero.

The direct API routes, one-shot and Assistant, take cache counters from each step's `finish-step` usage, the only usage that keeps the provider's raw counters. The Glaze host bundles AI SDK 7 (7.0.16 for SDK 0.14.3), whose aggregated usage carries no raw counters and reports a synthesized zero for omitted OpenAI cache reads. The raw values replace that zero, so an omitted counter stays `null` and a reported zero stays zero. Token totals come from the aggregate, cache components are summed only when every step supplies them, and Assistant tool requests report their final totals once.

Glaze AI records only what the host's result carries. The app-window one-shot record is built from the public `useGlazeAI` result: its counters as reported (`null` where absent), no resolved model (`modelId` and `requestedModelId` are `null`, since the request names a grade rather than a model) and the duration measured in the app window. The Assistant's Glaze route applies the same rule to each step. The app-window result carries no raw provider payload and the Assistant's Glaze route does not consult one, so a zero either reports cannot be told apart from a measured zero. Usage is recorded when the app window's request resolves; text the host streams after resuming a blocked request is shown, but its usage is not recorded. The subscription Codex parser retains `cached_input_tokens`; it does not invent a cache-write counter.

For a user-authorized API measurement, compare the same model, policy, tools and source coverage across a cold request and repeated requests, using the existing request records. Calculate aggregate cache-read share as total known reads divided by total known input, and compare actual durations and provider billing. Do not count read/write components again in total tokens. Do not log prompt bodies, email, task contents, keys or tool arguments.

`shared/ai-usage.ts` provides an input-cost helper requiring known input/read/write counts and caller-supplied current rates per million tokens:

`((I - R - W) * Pinput + R * Pcached + W * Pwrite) / 1e6`

It returns `null` for missing components, invalid rates or counters exceeding input. This excludes output charges and other fees. Do not use API prices to claim dollar savings for subscription CLI, Glaze or other bundled access.

## Verification boundary

Offline tests intercept provider fetches and inject synthetic settings, keys, MCP discovery and responses. They replace `@glaze/core/ai` with the upstream `ai` package pinned to the version the Glaze host bundles (7.0.16 for SDK 0.14.3) and stub the bundled `glaze()` model, so the Glaze AI routes themselves never run; the app-window Glaze record is tested only as a normalizer applied to a result shaped like the host's. Keep the `ai` devDependency equal to the host's version, because the stand-in must aggregate usage the way the host does. The tests verify wire fields, model gating, unchanged prefixes and history, changed snapshot suffixes, tool collisions, unknown/zero usage (empty and absent OpenAI cache details on both API routes), provider failure and multi-step aggregation. No live provider request or measured savings is claimed.

References: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI model catalog](https://developers.openai.com/api/docs/models), [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai).
