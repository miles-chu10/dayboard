import { useQuery } from "@tanstack/react-query";
import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  CodexModelInfo,
  ProviderAvailability,
} from "@main/shared-types";

import type { EffortPart } from "../../shared/ai-effort";
import { invoke } from "./ipc";
import {
  DEFAULT_MODEL_LABEL,
  assistantEffortPart,
  claudeChoices,
  claudeSupportsFast,
  codexModel,
} from "./model-choices";
import { isApiKeyProvider } from "./settings";

export const codexModelsKey = ["codex-models"] as const;

export function useCodexModels(enabled: boolean) {
  return useQuery({
    queryKey: codexModelsKey,
    queryFn: () => invoke<CodexModelInfo[]>("ai:codexModels", {}),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/** The exact ID each Claude Code alias last ran as in this app session, keyed by alias. */
export function useClaudeModels() {
  return useQuery({
    queryKey: ["claude-models"],
    queryFn: () => invoke<Record<string, string>>("ai:claudeModels"),
    staleTime: Infinity,
  });
}

export function useProviderAvailability() {
  return useQuery({
    queryKey: ["ai-availability"],
    queryFn: () => invoke<ProviderAvailability>("ai:availability"),
    staleTime: 60_000,
  });
}

/**
 * The Assistant's next request for the sidebar and the Assistant's header: the composer's model
 * and effort, using the API model list the composer fetched. Reading that list here never starts
 * a request of its own; until the composer lists it, an unchosen API model stays "Newest model".
 */
export function useAssistantModel(settings: AppSettings | undefined): SelectedModel {
  const provider = assistantProvider(settings);
  const codexModels = useCodexModels(provider === "codex").data;
  const claudeModels = useClaudeModels().data;
  const apiModels = useQuery({
    queryKey: ["api-models", provider],
    queryFn: () => invoke<ApiModelInfo[]>("ai:apiModels", { provider }),
    enabled: false,
  }).data;
  return selectedModel(
    settings,
    codexModels,
    provider,
    isApiKeyProvider(provider) ? apiModels : undefined,
    claudeModels,
  );
}

/** The provider the Assistant uses: its own pick, or the default. */
export function assistantProvider(settings: AppSettings | undefined): AIProvider {
  return settings?.ai.assistantProvider || settings?.ai.provider || "claude";
}

export interface SelectedModel {
  label: string;
  fast: boolean;
  contextWindow: number | null;
  /** Keys the effort table: the Claude Code alias, the Codex slug, or the API model ID. */
  id: string;
  /** The Assistant's effort for the next request; null when the route has none to name. */
  effort: EffortPart | null;
}

/**
 * The model and effort the Assistant's next request uses. A Claude Code alias is named after the
 * model its last reply reported; the effort is the composer's, checked against this model.
 */
export function selectedModel(
  settings: AppSettings | undefined,
  codexModels: CodexModelInfo[] | undefined,
  provider: AIProvider = settings?.ai.provider ?? "claude",
  apiModels?: ApiModelInfo[],
  claudeModels?: Record<string, string>,
): SelectedModel {
  const model = modelOnly(settings, codexModels, provider, apiModels, claudeModels);
  if (!settings) return { ...model, effort: null };
  return {
    ...model,
    effort: assistantEffortPart(settings.ai, provider, model.id, codexModels, claudeModels),
  };
}

function modelOnly(
  settings: AppSettings | undefined,
  codexModels: CodexModelInfo[] | undefined,
  provider: AIProvider,
  apiModels?: ApiModelInfo[],
  claudeModels?: Record<string, string>,
): Omit<SelectedModel, "effort"> {
  const ai = settings?.ai;
  if (!ai) return { label: "Choose a model", fast: false, contextWindow: null, id: "" };
  if (provider === "claude") {
    const option = claudeChoices(claudeModels).find((entry) => entry.value === ai.claudeModel);
    return {
      label: option?.label ?? ai.claudeModel,
      fast: ai.claudeFast && claudeSupportsFast(ai.claudeModel),
      contextWindow: ai.claudeModel.endsWith("[1m]") ? 1_000_000 : 200_000,
      id: ai.claudeModel,
    };
  }
  if (provider === "gemini")
    return {
      label: ai.geminiModel || DEFAULT_MODEL_LABEL.gemini,
      fast: false,
      contextWindow: null,
      id: ai.geminiModel,
    };
  if (provider === "muse")
    return {
      label: ai.museModel || DEFAULT_MODEL_LABEL.muse,
      fast: false,
      contextWindow: null,
      id: ai.museModel,
    };
  if (isApiKeyProvider(provider)) {
    const chosen = ai.apiModels[provider];
    const model =
      apiModels?.find((entry) => entry.id === chosen) ?? (chosen ? undefined : apiModels?.[0]);
    return {
      label: model?.name ?? (chosen || "Newest model"),
      fast: false,
      contextWindow: model?.contextWindow ?? null,
      id: model?.id ?? chosen,
    };
  }
  const model = codexModel(ai, codexModels);
  return {
    label: model?.name ?? (ai.codexModel || DEFAULT_MODEL_LABEL.codex),
    fast: Boolean(ai.codexServiceTier),
    contextWindow: model?.contextWindow ?? null,
    id: model?.slug ?? ai.codexModel,
  };
}

export function formatTokens(count: number): string {
  return count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(count % 1_000_000 ? 1 : 0)}M`
    : count >= 1000
      ? `${Math.round(count / 1000)}K`
      : String(count);
}
