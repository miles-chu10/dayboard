import type { AssistantMessageInput } from "../../shared-types.js";

/** Intentionally excludes unknown future families, specialty variants and compatible gateways. */
export function supportsExplicitCache(modelId: string): boolean {
  return /^(?:gpt-5\.6-(?:sol|terra|luna)|gpt-6-(?:astra|sol|luna))(?:-\d{4}-\d{2}-\d{2})?$/.test(
    modelId,
  );
}

export function apiPromptOptions(
  provider: string,
  modelId: string,
  system: string,
  messages: AssistantMessageInput[],
  mode: "implicit" | "explicit",
) {
  if (provider !== "openai" || !supportsExplicitCache(modelId)) return { system, messages };
  return {
    system: {
      role: "system" as const,
      content: system,
      providerOptions: { openai: { promptCacheBreakpoint: { mode: "explicit" as const } } },
    },
    messages,
    providerOptions: { openai: { promptCacheOptions: { mode, ttl: "30m" } } },
  };
}

/**
 * Request-only data: never mutate saved messages or accumulate previous snapshots. The snapshot
 * leads the latest user message rather than adding a turn, so providers that require alternating
 * turns and providers that merge adjacent ones see the same request.
 */
export function withCurrentSnapshot(
  messages: AssistantMessageInput[],
  snapshot?: string,
): AssistantMessageInput[] {
  const latest = messages.findLastIndex((message) => message.role === "user");
  if (!snapshot || latest < 0) return messages;
  return messages.map((message, index) =>
    index === latest ? { ...message, content: `${snapshot}\n\n${message.content}` } : message,
  );
}
