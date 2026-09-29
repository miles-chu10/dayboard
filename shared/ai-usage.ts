export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** null means the provider did not report this counter. */
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
}

export interface RequestUsage extends TokenUsage {
  modelId: string | null;
  requestedModelId: string | null;
  route: string;
  durationMs: number;
}

export function knownTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Claude-format usage (Anthropic API, Claude Code, Antigravity). `input_tokens` excludes cache
 * reads and writes, so the input total exists only when all three counters were sent.
 * `knownInputTokens` is what the sent counters add up to, for display when the total is unknown.
 */
export function claudeFormatUsage(raw: Record<string, unknown>) {
  const fresh = knownTokenCount(raw.input_tokens);
  const read = knownTokenCount(raw.cache_read_input_tokens);
  const write = knownTokenCount(raw.cache_creation_input_tokens);
  const sent = [fresh, read, write].filter((count): count is number => count !== null);
  return {
    inputTokens: fresh !== null && read !== null && write !== null ? fresh + read + write : null,
    outputTokens: knownTokenCount(raw.output_tokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
    knownInputTokens: sent.length ? sent.reduce((total, count) => total + count, 0) : null,
  };
}

const OPENAI_FORMAT = ["openai", "xai", "mistral", "deepseek", "groq", "openrouter"];

/**
 * The AI SDK reports 0 for a counter the provider left out (Gemini's promptTokenCount, Anthropic's
 * cache fields, chat prompt_tokens), so these come from what the provider actually sent.
 */
function sentCounters(
  provider: string,
  raw: Record<string, unknown>,
): Omit<TokenUsage, "totalTokens"> | null {
  if (provider === "anthropic") {
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = claudeFormatUsage(raw);
    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
  }
  if (provider === "google") {
    const candidates = knownTokenCount(raw.candidatesTokenCount);
    return {
      inputTokens: knownTokenCount(raw.promptTokenCount),
      // Gemini reports thinking tokens separately; they are billed as output.
      outputTokens:
        candidates === null ? null : candidates + (knownTokenCount(raw.thoughtsTokenCount) ?? 0),
      cacheReadTokens: knownTokenCount(raw.cachedContentTokenCount),
      cacheWriteTokens: null,
    };
  }
  if (OPENAI_FORMAT.includes(provider)) {
    const details = asRecord(raw.input_tokens_details ?? raw.prompt_tokens_details);
    return {
      inputTokens: knownTokenCount(raw.input_tokens ?? raw.prompt_tokens),
      outputTokens: knownTokenCount(raw.output_tokens ?? raw.completion_tokens),
      cacheReadTokens: knownTokenCount(details?.cached_tokens),
      cacheWriteTokens: knownTokenCount(details?.cache_write_tokens),
    };
  }
  return null;
}

export function tokenUsage(
  value: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheWriteTokens?: unknown;
    raw?: unknown;
    inputTokenDetails?: { cacheReadTokens?: unknown; cacheWriteTokens?: unknown } | null;
  },
  provider?: string,
): TokenUsage {
  const raw = asRecord(value.raw);
  const sent = provider && raw ? sentCounters(provider, raw) : null;
  const input = sent ? sent.inputTokens : knownTokenCount(value.inputTokens);
  const output = sent ? sent.outputTokens : knownTokenCount(value.outputTokens);
  let read = sent
    ? sent.cacheReadTokens
    : knownTokenCount(value.inputTokenDetails?.cacheReadTokens ?? value.cacheReadTokens);
  let write = sent
    ? sent.cacheWriteTokens
    : knownTokenCount(value.inputTokenDetails?.cacheWriteTokens ?? value.cacheWriteTokens);
  if (input !== null) {
    if (read !== null && read > input) read = null;
    if (write !== null && write > input) write = null;
    if (read !== null && write !== null && read + write > input) read = write = null;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    // An SDK total adds a missing counter as 0, so a total derived from raw usage is recomputed.
    totalTokens:
      (sent ? null : knownTokenCount(value.totalTokens)) ??
      (input !== null && output !== null ? input + output : null),
  };
}

export function normalizeRequestUsage(value: unknown): RequestUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.route !== "string" ||
    typeof record.durationMs !== "number" ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0
  )
    return undefined;
  return {
    ...tokenUsage(record),
    requestedModelId:
      typeof record.requestedModelId === "string" ? record.requestedModelId.slice(0, 160) : null,
    modelId: typeof record.modelId === "string" ? record.modelId.slice(0, 160) : null,
    route: record.route.slice(0, 80),
    durationMs: record.durationMs,
  };
}

/** API input cost only; callers must supply current, explicit rates and every component. */
export function inputCost(
  usage: {
    inputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  },
  rates: { input: number; cached: number; write: number },
): number | null {
  const { inputTokens: input, cacheReadTokens: read, cacheWriteTokens: write } = usage;
  if (
    input === null ||
    read === null ||
    write === null ||
    [input, read, write].some((n) => knownTokenCount(n) === null) ||
    read + write > input ||
    [rates.input, rates.cached, rates.write].some((n) => !Number.isFinite(n) || n < 0)
  )
    return null;
  return (
    ((input - read - write) * rates.input + read * rates.cached + write * rates.write) / 1_000_000
  );
}

/** A total is known only when every step reported it; a missing step is never counted as 0. */
export function aggregateStepUsage(steps: TokenUsage[]): TokenUsage {
  const sum = (key: keyof TokenUsage) =>
    steps.length && steps.every((step) => step[key] !== null)
      ? steps.reduce((count, step) => count + (step[key] ?? 0), 0)
      : null;
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    totalTokens: sum("totalTokens"),
  };
}
