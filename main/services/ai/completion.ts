import { GlazeAIError, glaze, streamText } from "@glaze/core/ai";
import { logger } from "@glaze/core/backend";

import { BLOCKED_MESSAGE } from "../../../shared/ai-blocked.js";
import {
  aggregateStepUsage,
  tokenUsage,
  type RequestUsage,
  type TokenUsage,
} from "../../../shared/ai-usage.js";
import type { AIStreamChunk } from "../../shared-types.js";
import { getSettings } from "../settings-store.js";
import { isApiProvider } from "./api-keys.js";
import { apiLanguageModel, resolveApiModel } from "./api-providers.js";
import { isCancelled, runCliCompletion } from "./cli-providers.js";
import { listCodexModels } from "./codex-models.js";
import {
  effortProviderOptions,
  resolveFeatureEffort,
  withProviderOptions,
} from "./assistant-effort.js";
import { describeModel } from "./model-options.js";
import { apiPromptOptions } from "./prompt-cache.js";
import { asError } from "./stream-error.js";

const RUN_TIMEOUT_MS = 3 * 60_000;

/**
 * One-shot generation through the selected provider: the non-demo body of `ai:run`, also used by
 * Quick Capture in the backend. `ai:run` keeps Glaze AI in the app window (useGlazeAI), so only
 * backend callers pass `allowGlaze`; they get Glaze's blocked states as readable errors.
 */
export async function runCompletion({
  system,
  prompt,
  signal,
  onChunk,
  allowGlaze = false,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
  allowGlaze?: boolean;
}): Promise<{ text: string; usage?: RequestUsage }> {
  const settings = await getSettings();
  if (!settings.ai.enabled) throw new Error("Turn on AI in Settings → AI first.");
  const provider = settings.ai.provider;
  if (provider === "glaze" && !allowGlaze)
    throw new Error("Glaze AI requests run in the app window.");
  try {
    if (provider === "glaze" || isApiProvider(provider)) {
      const model = provider === "glaze" ? null : await resolveApiModel(provider, settings.ai);
      const languageModel = model
        ? await apiLanguageModel(provider as Parameters<typeof apiLanguageModel>[0], model.id)
        : glaze("fast");
      // Timed from just before the provider call, so setup work is not counted.
      const startedAt = Date.now();
      const result = streamText({
        model: languageModel,
        ...(model
          ? withProviderOptions(
              apiPromptOptions(
                provider as Parameters<typeof apiPromptOptions>[0],
                model.id,
                system,
                [{ role: "user", content: prompt }],
                "explicit",
              ),
              effortProviderOptions(
                provider,
                resolveFeatureEffort(
                  settings.ai,
                  provider as Parameters<typeof resolveFeatureEffort>[1],
                  model.id,
                ),
              ),
            )
          : { system, prompt }),
        maxOutputTokens: 4000,
        abortSignal: signal,
      });
      let text = "";
      const steps: TokenUsage[] = [];
      let resolvedModelId: string | null = null;
      let requestUsage: RequestUsage | undefined;
      for await (const rawPart of result.fullStream) {
        const part = rawPart as {
          type: string;
          text?: string;
          error?: unknown;
          usage?: Parameters<typeof tokenUsage>[0];
          response?: { modelId?: string };
        };
        if (part.type === "error") throw asError(part.error);
        if (part.type === "text-delta") {
          text += part.text ?? "";
          onChunk?.({ type: "delta", text: part.text ?? "" });
        }
        if (part.type === "finish-step") {
          steps.push(tokenUsage(part.usage ?? {}, provider));
          if (part.response?.modelId) resolvedModelId = part.response.modelId;
        }
        // An aborted request ends with an "abort" part instead, so it records no usage.
        if (part.type === "finish") {
          requestUsage = {
            ...aggregateStepUsage(steps),
            modelId: resolvedModelId,
            requestedModelId: model?.id ?? null,
            route: provider,
            durationMs: Date.now() - startedAt,
          };
          onChunk?.({
            type: "usage",
            ...requestUsage,
            inputTokens: requestUsage.inputTokens ?? 0,
            outputTokens: requestUsage.outputTokens ?? 0,
            usage: requestUsage,
            contextWindow: model?.contextWindow ?? null,
          });
        }
      }
      return { text, usage: requestUsage };
    }
    let usage: RequestUsage | undefined;
    let modelId: string | null = null;
    const codexModels =
      provider === "codex" && !settings.ai.codexModel
        ? await listCodexModels().catch(() => [])
        : [];
    const requestedModelId = describeModel(settings.ai, codexModels, provider).id;
    const startedAt = Date.now();
    const text = await runCliCompletion({
      provider,
      codexModel: provider === "codex" ? (requestedModelId ?? undefined) : undefined,
      system,
      prompt,
      mcpServers: [],
      signal,
      timeoutMs: RUN_TIMEOUT_MS,
      onDelta: (text) => onChunk?.({ type: "delta", text }),
      onTool: () => undefined,
      onModel: (id) => {
        modelId = id;
      },
      onUsage: (counts) => {
        usage = {
          ...tokenUsage(counts),
          modelId,
          requestedModelId,
          route: provider,
          durationMs: Date.now() - startedAt,
        };
        onChunk?.({
          type: "usage",
          ...usage,
          inputTokens: usage.inputTokens ?? counts.displayInputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          usage,
          contextWindow: null,
        });
      },
    });
    return { text, usage };
  } catch (error) {
    if (error instanceof GlazeAIError)
      throw new Error(BLOCKED_MESSAGE[error.state] ?? "Glaze AI couldn't run this request.");
    if (!isCancelled(error))
      logger.error("ai", "ai:run failed", {
        message: (error as Error).message,
      });
    throw error;
  }
}
