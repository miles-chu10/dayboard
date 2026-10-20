import { useQuery } from "@tanstack/react-query";
import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  CodexModelInfo,
  ProviderAvailability,
} from "@main/shared-types";

import { invoke } from "./ipc";
import {
  DEFAULT_MODEL_LABEL,
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

export const claudeModelsKey = ["claude-models"] as const;

/** The exact ID each Claude Code alias last ran as in this app session, keyed by alias. */
export function useClaudeModels() {
  return useQuery({
    queryKey: claudeModelsKey,
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

/** The provider the Assistant uses: its own pick, or the default. */
export function assistantProvider(settings: AppSettings | undefined): AIProvider {
  return settings?.ai.assistantProvider || settings?.ai.provider || "claude";
}

/**
 * The model the composer should show before a reply reports the exact ID. `id` keys the effort
 * table: the Claude Code alias, the Codex slug, or the API model ID; empty when unknown.
 */
export function selectedModel(
  settings: AppSettings | undefined,
  codexModels: CodexModelInfo[] | undefined,
  provider: AIProvider = settings?.ai.provider ?? "claude",
  apiModels?: ApiModelInfo[],
  claudeModels?: Record<string, string>,
): { label: string; fast: boolean; contextWindow: number | null; id: string } {
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
