import { SNAPSHOT_END, SNAPSHOT_START } from "../../../shared/ai-snapshot.js";
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
  // findLastIndex needs the ES2023 lib; this project's TypeScript lib is ES2020.
  const latest = messages.map((message) => message.role).lastIndexOf("user");
  if (!snapshot || latest < 0) return messages;
  return messages.map((message, index) =>
    index === latest ? { ...message, content: `${snapshot}\n\n${message.content}` } : message,
  );
}

/**
 * Text quoted from outside sources goes inside the snapshot block, ahead of its end marker, so the
 * rule that snapshot content is untrusted data covers it. A snapshot without that block gets one.
 */
export function insertIntoSnapshot(snapshot: string | undefined, section: string): string {
  const end = `\n${SNAPSHOT_END}`;
  if (snapshot?.endsWith(end)) return `${snapshot.slice(0, -end.length)}\n\n${section}${end}`;
  return [snapshot, `${SNAPSHOT_START}\n${section}${end}`].filter(Boolean).join("\n\n");
}
