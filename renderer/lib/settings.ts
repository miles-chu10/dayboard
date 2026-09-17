import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type { AIFeature, AIProvider, AppSettings, SourceId } from "@main/shared-types";

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
};

export const PROVIDER_DETAIL: Record<AIProvider, string> = {
  glaze: "Uses your Glaze account.",
  claude: "Uses your Claude subscription through Claude Code.",
  codex: "Uses your ChatGPT subscription through the Codex CLI.",
};
