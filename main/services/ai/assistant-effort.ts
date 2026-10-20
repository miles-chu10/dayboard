import { effortOptions, supportedEffort } from "../../../shared/ai-effort.js";
import type {
  AIProvider,
  ApiProviderId,
  AppSettings,
  ClaudeEffort,
  CodexModelInfo,
} from "../../shared-types.js";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

/** The AI SDK's provider options: one JSON record per provider. */
export type ProviderOptions = Record<string, { [key: string]: JsonValue | undefined }>;

/**
 * The model an effort applies to: the Claude Code alias, the Codex slug that will run (the first
 * catalog model when the saved one is missing, as describeModel does), or the API model ID.
 */
export function effortModelId(
  ai: AppSettings["ai"],
  provider: AIProvider,
  codexModels: CodexModelInfo[],
  apiModelId = "",
): string {
  if (provider === "claude") return ai.claudeModel;
  if (provider === "codex")
    return (
      (codexModels.find((model) => model.slug === ai.codexModel) ?? codexModels[0])?.slug ?? ""
    );
  return apiModelId;
}

/**
 * The Assistant's saved effort for this route, checked against the model that will run. A level
 * the model no longer accepts (for example after a Codex catalog change) becomes "", the model
 * default, instead of failing the request.
 */
export function resolveAssistantEffort(
  ai: AppSettings["ai"],
  provider: AIProvider,
  codexModels: CodexModelInfo[],
  apiModelId?: string,
): string {
  const options = effortOptions(
    provider,
    effortModelId(ai, provider, codexModels, apiModelId),
    codexModels,
  );
  // Settings objects written before assistantEffort existed have no record at all.
  return supportedEffort(options, ai.assistantEffort?.[provider]);
}

/** One-click features' effort on an API route, checked against the model that will run. */
export function resolveFeatureEffort(
  ai: AppSettings["ai"],
  provider: ApiProviderId,
  modelId: string,
): string {
  return supportedEffort(effortOptions(provider, modelId), ai.apiEffort?.[provider]);
}

/**
 * Settings for the CLI argument builders with the Assistant's effort in place of the one-click
 * features' effort. `undefined` keeps the feature settings; "" sends the model default.
 */
export function withAssistantEffort(
  ai: AppSettings["ai"],
  provider: AIProvider,
  effort: string | undefined,
): AppSettings["ai"] {
  if (effort === undefined) return ai;
  if (provider === "claude") return { ...ai, claudeEffort: (effort || "default") as ClaudeEffort };
  if (provider === "codex") return { ...ai, codexEffort: effort };
  return ai;
}

/** Effort on API routes: OpenAI Responses `reasoningEffort`, Anthropic `effort` (`output_config.effort`). */
export function effortProviderOptions(
  provider: AIProvider,
  effort: string,
): ProviderOptions | undefined {
  if (!effort) return undefined;
  if (provider === "openai") return { openai: { reasoningEffort: effort } };
  if (provider === "anthropic") return { anthropic: { effort } };
  return undefined;
}

/** Merges extra provider options per provider, so the prompt-cache options survive. */
export function withProviderOptions<T extends { providerOptions?: ProviderOptions }>(
  options: T,
  extra: ProviderOptions | undefined,
): T & { providerOptions?: ProviderOptions } {
  if (!extra) return options;
  const merged: ProviderOptions = { ...options.providerOptions };
  for (const [provider, values] of Object.entries(extra))
    merged[provider] = { ...merged[provider], ...values };
  return { ...options, providerOptions: merged };
}
