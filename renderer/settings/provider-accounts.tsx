import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, FieldSet, Input, toast } from "@glaze/core/components";
import type {
  ApiKeyStatuses,
  ApiModelInfo,
  ApiProviderId,
  AppSettings,
  OpenAIKeyStatus,
  ProviderAvailability,
} from "@main/shared-types";

import { ProviderMark } from "../components/provider-logo";
import { MUSE_MODEL_OPTIONS } from "../lib/ai-models";
import { errorMessage, invoke } from "../lib/ipc";
import { API_KEY_PROVIDERS, PROVIDER_LABEL } from "../lib/settings";
import { SettingSelect } from "./setting-select";

type SettingsEdit = (recipe: (draft: AppSettings) => void) => void;

export const apiKeysQueryKey = ["api-keys"] as const;

export function useApiKeyStatuses() {
  return useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: () => invoke<ApiKeyStatuses>("apiKeys:status"),
    staleTime: 60_000,
  });
}

const KEY_HELP: Record<ApiProviderId, string> = {
  openai: "platform.openai.com → API keys. Also used for Assistant dictation.",
  anthropic: "console.anthropic.com → API keys.",
  google: "aistudio.google.com → Get API key.",
  xai: "console.x.ai → API Keys.",
  mistral: "console.mistral.ai → API Keys.",
  deepseek: "platform.deepseek.com → API keys.",
  groq: "console.groq.com → API Keys.",
  openrouter: "openrouter.ai → Keys. One key reaches models from many providers.",
};

function ApiKeyRow({ provider, status }: { provider: ApiProviderId; status?: OpenAIKeyStatus }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const done = (next: OpenAIKeyStatus) => {
    queryClient.setQueryData<ApiKeyStatuses>(apiKeysQueryKey, (previous) =>
      previous ? { ...previous, [provider]: next } : previous,
    );
    void queryClient.invalidateQueries({ queryKey: ["ai-availability"] });
    void queryClient.invalidateQueries({ queryKey: ["api-models", provider] });
  };
  const save = useMutation({
    mutationFn: () => invoke<OpenAIKeyStatus>("apiKeys:save", { provider, key: draft }),
    onSuccess: (next) => {
      done(next);
      setDraft("");
      toast.success(`${PROVIDER_LABEL[provider]} key saved`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const clear = useMutation({
    mutationFn: () => invoke<OpenAIKeyStatus>("apiKeys:clear", { provider }),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <ProviderMark provider={provider} className="size-3.5" />
          {PROVIDER_LABEL[provider]}
        </span>
      }
      description={status?.configured ? `Saved key ending in ${status.hint}.` : KEY_HELP[provider]}
      orientation="vertical"
    >
      <div className="flex w-full items-center gap-2">
        <Input
          type="password"
          aria-label={`${PROVIDER_LABEL[provider]} key`}
          placeholder={status?.configured ? "Enter a new key to replace it" : "Paste your API key"}
          value={draft}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          className="flex-1"
        />
        <Button
          size="small"
          disabled={!draft.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        {status?.configured ? (
          <Button
            size="small"
            variant="transparent"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

export function ApiKeysSection() {
  const statuses = useApiKeyStatuses();
  return (
    <FieldSet
      title="API keys"
      description="Pay-per-use access with your own keys. Keys are stored encrypted on this Mac and never leave the app except to call their provider."
    >
      {API_KEY_PROVIDERS.map((provider) => (
        <ApiKeyRow key={provider} provider={provider} status={statuses.data?.[provider]} />
      ))}
    </FieldSet>
  );
}

export function useApiModels(provider: ApiProviderId, enabled: boolean) {
  return useQuery({
    queryKey: ["api-models", provider],
    queryFn: () => invoke<ApiModelInfo[]>("ai:apiModels", { provider }),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Model lists for every API-key provider that has a saved key. */
export function useAllApiModels(available: ProviderAvailability | undefined) {
  const results = useQueries({
    queries: API_KEY_PROVIDERS.map((provider) => ({
      queryKey: ["api-models", provider],
      queryFn: () => invoke<ApiModelInfo[]>("ai:apiModels", { provider }),
      enabled: Boolean(available?.[provider]),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  return Object.fromEntries(
    API_KEY_PROVIDERS.map((provider, index) => [provider, results[index].data]),
  ) as Record<ApiProviderId, ApiModelInfo[] | undefined>;
}

export function MuseModelField({ settings, edit }: { settings: AppSettings; edit: SettingsEdit }) {
  const current = settings.ai.museModel;
  return (
    <Field label="Model" description="Muse Spark models from your Meta account.">
      <SettingSelect
        label="Muse model"
        value={current || NEWEST}
        options={[
          ...MUSE_MODEL_OPTIONS.map((option) => ({
            value: option.value || NEWEST,
            label: option.label,
          })),
          ...(current && !MUSE_MODEL_OPTIONS.some((option) => option.value === current)
            ? [{ value: current, label: current }]
            : []),
        ]}
        onChange={(value) =>
          edit((draft) => {
            draft.ai.museModel = value === NEWEST ? "" : value;
          })
        }
      />
    </Field>
  );
}

export function useGeminiModels(enabled: boolean) {
  return useQuery({
    queryKey: ["gemini-models"],
    queryFn: () => invoke<string[]>("ai:geminiModels"),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

const NEWEST = "__newest";

export function ApiModelField({
  provider,
  settings,
  edit,
}: {
  provider: ApiProviderId;
  settings: AppSettings;
  edit: SettingsEdit;
}) {
  const configured = useApiKeyStatuses().data?.[provider].configured ?? false;
  const models = useApiModels(provider, configured);
  const current = settings.ai.apiModels[provider];
  return (
    <Field
      label="Model"
      description={
        !configured
          ? `Add your ${PROVIDER_LABEL[provider]} key below to choose a model.`
          : models.isError
            ? errorMessage(models.error)
            : "Models your key can use, newest first."
      }
    >
      <SettingSelect
        label={`${PROVIDER_LABEL[provider]} model`}
        value={current || NEWEST}
        options={[
          { value: NEWEST, label: "Newest available" },
          ...(models.data ?? []).map((model) => ({
            value: model.id,
            label: model.name,
          })),
          ...(current && !models.data?.some((model) => model.id === current)
            ? [{ value: current, label: current }]
            : []),
        ]}
        onChange={(value) =>
          edit((draft) => {
            draft.ai.apiModels[provider] = value === NEWEST ? "" : value;
          })
        }
      />
    </Field>
  );
}

export function GeminiModelField({
  settings,
  edit,
}: {
  settings: AppSettings;
  edit: SettingsEdit;
}) {
  const models = useGeminiModels(true);
  const current = settings.ai.geminiModel;
  return (
    <Field
      label="Model"
      description={
        models.isError
          ? "Couldn't read Antigravity's model list; its default model is used."
          : "Models offered by your Antigravity sign-in."
      }
    >
      <SettingSelect
        label="Gemini model"
        value={current || NEWEST}
        options={[
          { value: NEWEST, label: "Antigravity default" },
          ...(models.data ?? []).map((model) => ({
            value: model,
            label: model,
          })),
          ...(current && !models.data?.includes(current)
            ? [{ value: current, label: current }]
            : []),
        ]}
        onChange={(value) =>
          edit((draft) => {
            draft.ai.geminiModel = value === NEWEST ? "" : value;
          })
        }
      />
    </Field>
  );
}
