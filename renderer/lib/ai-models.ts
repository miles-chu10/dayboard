import { useQuery } from "@tanstack/react-query";
import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  ClaudeModel,
  CodexModelInfo,
  ProviderAvailability,
} from "@main/shared-types";

import { invoke } from "./ipc";

export const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string; sublabel: string }[] = [
  { value: "default", label: "Claude Code default", sublabel: "The model set in Claude Code" },
  { value: "fable", label: "Fable", sublabel: "Latest Claude Fable" },
  { value: "opus", label: "Opus", sublabel: "Latest Claude Opus" },
  { value: "sonnet", label: "Sonnet", sublabel: "Latest Claude Sonnet" },
  { value: "haiku", label: "Haiku", sublabel: "Latest Claude Haiku" },
  {
    value: "opus[1m]",
    label: "Opus (1M context)",
    sublabel: "Opus with a 1 million token context window",
  },
  {
    value: "sonnet[1m]",
    label: "Sonnet (1M context)",
    sublabel: "Sonnet with a 1 million token context window",
  },
];

export const codexModelsKey = ["codex-models"] as const;

export function useCodexModels(enabled: boolean) {
  return useQuery({
    queryKey: codexModelsKey,
    queryFn: () => invoke<CodexModelInfo[]>("ai:codexModels", {}),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function claudeSupportsFast(model: ClaudeModel): boolean {
  return model === "opus" || model === "opus[1m]";
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
  return settings?.ai.assistantProvider || settings?.ai.provider || "glaze";
}

/** The model the composer should show before a reply reports the exact ID. */
export function selectedModel(
  settings: AppSettings | undefined,
  codexModels: CodexModelInfo[] | undefined,
  provider: AIProvider = settings?.ai.provider ?? "glaze",
  apiModels?: ApiModelInfo[],
): { label: string; fast: boolean; contextWindow: number | null } {
  const ai = settings?.ai;
  if (!ai || provider === "glaze") return { label: "Glaze AI", fast: false, contextWindow: null };
  if (provider === "claude") {
    const option = CLAUDE_MODEL_OPTIONS.find((entry) => entry.value === ai.claudeModel);
    return {
      label: option?.label ?? ai.claudeModel,
      fast: ai.claudeFast && claudeSupportsFast(ai.claudeModel),
      contextWindow: ai.claudeModel.endsWith("[1m]") ? 1_000_000 : 200_000,
    };
  }
  if (provider === "gemini")
    return { label: ai.geminiModel || "Gemini default", fast: false, contextWindow: null };
  if (provider === "openai" || provider === "anthropic" || provider === "google") {
    const chosen = ai.apiModels[provider];
    const model =
      apiModels?.find((entry) => entry.id === chosen) ?? (chosen ? undefined : apiModels?.[0]);
    return {
      label: model?.name ?? (chosen || "Newest model"),
      fast: false,
      contextWindow: model?.contextWindow ?? null,
    };
  }
  const model = codexModels?.find((entry) => entry.slug === ai.codexModel) ?? codexModels?.[0];
  return {
    label: model?.name ?? (ai.codexModel || "Codex default"),
    fast: Boolean(ai.codexServiceTier),
    contextWindow: model?.contextWindow ?? null,
  };
}

export function formatTokens(count: number): string {
  return count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(count % 1_000_000 ? 1 : 0)}M`
    : count >= 1000
      ? `${Math.round(count / 1000)}K`
      : String(count);
}
