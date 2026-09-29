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

/** Request-only data: never mutate saved messages or accumulate previous snapshots. */
export function withCurrentSnapshot(
  messages: AssistantMessageInput[],
  snapshot?: string,
): AssistantMessageInput[] {
  if (!snapshot) return messages;
  return [...messages.slice(0, -1), { role: "user", content: snapshot }, ...messages.slice(-1)];
}
