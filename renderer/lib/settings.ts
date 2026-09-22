import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type {
  AIFeature,
  AIProvider,
  ApiProviderId,
  AppSettings,
  SourceId,
} from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";

export const settingsQueryKey = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => invoke<AppSettings>("settings:get"),
    staleTime: Infinity,
  });
}

/** Applies a change to a copy of the current settings, optimistically, and persists it. */
export function useSettingsEditor() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const mutation = useMutation({
    mutationFn: (next: AppSettings) => invoke<AppSettings>("settings:update", next),
    onMutate: (next) => {
      const previous = queryClient.getQueryData<AppSettings>(settingsQueryKey);
      queryClient.setQueryData(settingsQueryKey, next);
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(settingsQueryKey, context.previous);
      toast.error(`Couldn't save settings: ${errorMessage(error)}`);
    },
  });

  function edit(recipe: (draft: AppSettings) => void) {
    const current = queryClient.getQueryData<AppSettings>(settingsQueryKey);
    if (!current) return;
    const draft = structuredClone(current);
    recipe(draft);
    mutation.mutate(draft);
  }

  return { settings, edit };
}

export function featureOn(settings: AppSettings | undefined, feature: AIFeature): boolean {
  return Boolean(settings?.ai.enabled && settings.ai.features[feature]);
}

export function sourceOn(settings: AppSettings | undefined, source: SourceId): boolean {
  return settings?.sources[source].enabled ?? true;
}

export const PROVIDER_LABEL: Record<AIProvider, string> = {
  glaze: "Glaze AI",
  claude: "Claude",
  codex: "ChatGPT",
  gemini: "Gemini",
  muse: "Muse",
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  google: "Gemini API",
  xai: "xAI Grok",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
};

/** Subscription accounts vs. pay-per-use API keys, for grouping in pickers. */
export const SUBSCRIPTION_PROVIDERS = ["claude", "codex", "gemini", "muse"] as const;
export const API_KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
  "openrouter",
] as const satisfies readonly ApiProviderId[];

export function isApiKeyProvider(provider: AIProvider): provider is ApiProviderId {
  return (API_KEY_PROVIDERS as readonly AIProvider[]).includes(provider);
}

/** Antigravity and Muse run without per-request MCP configuration. */
export function providerUsesMcp(provider: AIProvider): boolean {
  return provider !== "gemini" && provider !== "muse";
}

export const PROVIDER_DETAIL: Record<AIProvider, string> = {
  glaze: "Uses your Glaze account.",
  claude: "Uses your Claude subscription through Claude Code.",
  codex: "Uses your ChatGPT subscription through the Codex CLI.",
  gemini: "Uses your Google AI subscription through the Antigravity CLI (agy).",
  muse: "Uses your Meta account (Muse) through the Muse Code CLI.",
  openai: "Pay per use with your OpenAI API key.",
  anthropic: "Pay per use with your Anthropic API key.",
  google: "Pay per use with your Gemini API key from Google AI Studio.",
  xai: "Grok models with your xAI API key.",
  mistral: "Mistral models with your Mistral API key.",
  deepseek: "DeepSeek models with your DeepSeek API key.",
  groq: "Very fast open models with your Groq API key.",
  openrouter: "Hundreds of models from one OpenRouter key.",
};
