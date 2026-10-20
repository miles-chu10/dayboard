import { streamText } from "ai";

import {
  aggregateStepUsage,
  tokenUsage,
  type RequestUsage,
  type TokenUsage,
} from "../../../shared/ai-usage.js";
import { logger } from "../../platform/index.js";
import type { AIStreamChunk } from "../../shared-types.js";
import { getSettings } from "../settings-store.js";
import { isApiProvider } from "./api-keys.js";
import { apiLanguageModel, resolveApiModel } from "./api-providers.js";
import { isCancelled, runCliCompletion } from "./cli-providers.js";
import { describeModel } from "./model-options.js";
import { apiPromptOptions } from "./prompt-cache.js";
import { resolveConfiguredProvider } from "./provider-resolution.js";
import { asError } from "./stream-error.js";

const RUN_TIMEOUT_MS = 3 * 60_000;

/**
 * One-shot generation through the selected CLI or API provider: the non-demo body of `ai:run`,
 * also used by Quick Capture in the main process.
 */
export async function runCompletion({
  system,
  prompt,
  signal,
  onChunk,
}: {
  system: string;
  prompt: string;
  signal: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
}): Promise<{ text: string; usage?: RequestUsage }> {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.providerChosen)
    throw new Error("Choose and enable an AI provider in Settings → AI first.");
  const provider = settings.ai.provider;
  if (!(await resolveConfiguredProvider(provider)))
    throw new Error(`Set up ${provider} in Settings → AI before using it.`);
  try {
    if (isApiProvider(provider)) {
      const model = await resolveApiModel(provider, settings.ai);
      const languageModel = await apiLanguageModel(provider, model.id);
      // Timed from just before the provider call, so setup work is not counted.
      const startedAt = Date.now();
      const result = streamText({
        model: languageModel,
        ...apiPromptOptions(
          provider,
          model.id,
          system,
          [{ role: "user", content: prompt }],
          "explicit",
        ),
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
            requestedModelId: model.id,
            route: provider,
            durationMs: Date.now() - startedAt,
          };
          onChunk?.({
            type: "usage",
            ...requestUsage,
            inputTokens: requestUsage.inputTokens ?? 0,
            outputTokens: requestUsage.outputTokens ?? 0,
            usage: requestUsage,
            contextWindow: model.contextWindow,
          });
        }
      }
      return { text, usage: requestUsage };
    }
    let usage: RequestUsage | undefined;
    let modelId: string | null = null;
    // Only a configured model is requested here; without one the CLI picks its own default.
    const requestedModelId = describeModel(settings.ai, [], provider).id;
    const startedAt = Date.now();
    const text = await runCliCompletion({
      provider,
      system,
      prompt,
      mcpServers: [],
      signal: signal,
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
    if (!isCancelled(error))
      logger.error("ai", "ai:run failed", {
        message: (error as Error).message,
      });
    throw error;
  }
}
