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
  const input = knownTokenCount(value.inputTokens);
  const output = knownTokenCount(value.outputTokens);
  const raw =
    typeof value.raw === "object" && value.raw !== null
      ? (value.raw as Record<string, unknown>)
      : null;
  const openaiRaw =
    raw &&
    ["openai", "xai", "mistral", "deepseek", "groq", "openrouter"].includes(provider ?? "") &&
    ("input_tokens" in raw || "prompt_tokens" in raw);
  const details = openaiRaw ? (raw.input_tokens_details ?? raw.prompt_tokens_details) : null;
  const rawDetails =
    typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
  let read = knownTokenCount(
    openaiRaw
      ? rawDetails.cached_tokens
      : (value.inputTokenDetails?.cacheReadTokens ?? value.cacheReadTokens),
  );
  let write = knownTokenCount(
    openaiRaw
      ? rawDetails.cache_write_tokens
      : (value.inputTokenDetails?.cacheWriteTokens ?? value.cacheWriteTokens),
  );
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
    totalTokens:
      knownTokenCount(value.totalTokens) ??
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

/** Unknown on any step stays unknown; finish totals already include all steps. */
export function withCacheTotals(total: TokenUsage, steps: TokenUsage[]): TokenUsage {
  const sum = (key: "cacheReadTokens" | "cacheWriteTokens") =>
    steps.length && steps.every((step) => step[key] !== null)
      ? steps.reduce((count, step) => count + (step[key] ?? 0), 0)
      : null;
  return tokenUsage({
    ...total,
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
  });
}
