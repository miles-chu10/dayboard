import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Field,
  FieldSet,
  Label,
  RadioGroup,
  RadioGroupItem,
  Status,
  Switch,
  Text,
  toast,
} from "@glaze/core/components";
import type {
  AIFeature,
  AIProvider,
  AppSettings,
  ClaudeEffort,
  CliProviderId,
  CodexModelInfo,
  ProviderStatus,
} from "@main/shared-types";

import { effortOptions } from "../../shared/ai-effort";
import {
  applyModelChoice,
  claudeSupportsFast,
  codexModel,
  modelChoices,
  savedModelEffort,
} from "../lib/model-choices";
import { errorMessage, invoke } from "../lib/ipc";
import { useClaudeModels } from "../lib/ai-models";
import { ProviderMark } from "../components/provider-logo";
import {
  API_KEY_PROVIDERS,
  PROVIDER_DETAIL,
  PROVIDER_LABEL,
  SUBSCRIPTION_PROVIDERS,
  isApiKeyProvider,
  useSettingsEditor,
} from "../lib/settings";
import {
  ApiKeysSection,
  ApiModelField,
  GeminiModelField,
  MuseModelField,
  useApiKeyStatuses,
  useApiModels,
} from "./provider-accounts";
import { EffortField } from "./effort-field";
import { SettingSelect } from "./setting-select";

const FEATURES: { feature: AIFeature; label: string; description: string }[] = [
  {
    feature: "briefing",
    label: "Daily briefing",
    description: "Summarize your schedule, due items, and inbox on Today.",
  },
  {
    feature: "autoBriefing",
    label: "Write briefing automatically",
    description: "Generate it the first time you open the dashboard each day.",
  },
  {
    feature: "prioritize",
    label: "Smart prioritization",
    description: "Rank tasks and reminders into what to do next.",
  },
  {
    feature: "triage",
    label: "Email triage",
    description: "Sort mail into needs reply, FYI, and ignorable.",
  },
  {
    feature: "replyDrafts",
    label: "Reply drafts",
    description: "Write email replies you can edit and save to Gmail.",
  },
  {
    feature: "capture",
    label: "Natural-language capture",
    description: "Turn a typed sentence into a task, reminder, or event.",
  },
  {
    feature: "assistant",
    label: "Assistant",
    description: "Chat about your day, with suggested items and MCP tools.",
  },
  {
    feature: "meetingPrep",
    label: "Meeting prep",
    description: "Prepare notes for events from related email and to-dos.",
  },
  {
    feature: "weeklyReview",
    label: "Weekly review",
    description: "Review what got done and plan next week.",
  },
];

type SettingsEdit = (recipe: (draft: AppSettings) => void) => void;

const CLI_LABEL: Record<CliProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Antigravity CLI",
  muse: "Muse Code",
};

const PROVIDER_GROUPS: { title: string; providers: readonly AIProvider[] }[] = [
  { title: "Built in", providers: ["glaze"] },
  { title: "Subscription accounts", providers: SUBSCRIPTION_PROVIDERS },
  { title: "API keys", providers: API_KEY_PROVIDERS },
];

function ProviderStatusRow({ provider }: { provider: CliProviderId }) {
  const queryClient = useQueryClient();
  const [verified, setVerified] = useState(false);
  const key = ["provider-status", provider];
  const status = useQuery({
    queryKey: key,
    queryFn: () => invoke<ProviderStatus>("ai:providerStatus", { provider, verify: false }),
    staleTime: 60_000,
  });
  const verify = useMutation({
    mutationFn: () => invoke<ProviderStatus>("ai:providerStatus", { provider, verify: true }),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
      setVerified(result.ok);
      if (result.ok) toast.success(`${PROVIDER_LABEL[provider]} is signed in and ready`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const current = status.data;
  const indicator =
    status.isPending || verify.isPending
      ? {
          variant: "loading" as const,
          text: verify.isPending ? "Checking sign-in…" : "Checking…",
        }
      : current?.ok
        ? {
            variant: "success" as const,
            text: verified ? "Ready" : "Installed",
          }
        : current?.reason === "not-logged-in"
          ? { variant: "warning" as const, text: "Not signed in" }
          : current?.reason === "missing"
            ? { variant: "error" as const, text: "Not installed" }
            : { variant: "error" as const, text: "Unavailable" };

  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          <ProviderMark provider={provider} className="size-3.5" />
          {`${PROVIDER_LABEL[provider]} · ${CLI_LABEL[provider]}`}
        </span>
      }
      description={
        current
          ? current.ok
            ? `${current.version}. Test sends a tiny request to confirm you're signed in.`
            : current.message
          : "Looking for the command-line tool…"
      }
    >
      <div className="flex items-center gap-2">
        <Status variant={indicator.variant}>{indicator.text}</Status>
        <Button
          size="small"
          onClick={() => verify.mutate()}
          disabled={verify.isPending || (current?.ok === false && current.reason === "missing")}
        >
          Test
        </Button>
      </div>
    </Field>
  );
}

function ClaudeOptions({ settings, edit }: { settings: AppSettings; edit: SettingsEdit }) {
  const { ai } = settings;
  const claudeModels = useClaudeModels().data;
  const supportsFast = claudeSupportsFast(ai.claudeModel);
  return (
    <>
      <Field
        label="Model"
        description="Claude Code model aliases; availability depends on your account."
      >
        <SettingSelect
          label="Claude model"
          value={ai.claudeModel}
          options={modelChoices("claude", ai, { claude: claudeModels })}
          onChange={(value) => edit((draft) => applyModelChoice(draft.ai, "claude", value, {}))}
        />
      </Field>
      <EffortField
        provider="claude"
        label="Claude thinking effort"
        options={effortOptions("claude", ai.claudeModel)}
        value={ai.claudeEffort === "default" ? "" : ai.claudeEffort}
        onChange={(level) =>
          edit((draft) => {
            draft.ai.claudeEffort = (level || "default") as ClaudeEffort;
          })
        }
      />
      <Field
        label="Fast mode"
        description={
          supportsFast
            ? "Faster Opus output. Uses paid usage credits outside subscription limits."
            : "Choose Opus to use Fast mode."
        }
        disabled={!supportsFast}
      >
        <Switch
          checked={supportsFast && ai.claudeFast}
          disabled={!supportsFast}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.ai.claudeFast = checked;
            })
          }
          aria-label="Claude fast mode"
        />
      </Field>
    </>
  );
}

function CodexOptions({ settings, edit }: { settings: AppSettings; edit: SettingsEdit }) {
  const { ai } = settings;
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ["codex-models"],
    queryFn: () => invoke<CodexModelInfo[]>("ai:codexModels", {}),
    staleTime: 10 * 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => invoke<CodexModelInfo[]>("ai:codexModels", { refresh: true }),
    onSuccess: (models) => queryClient.setQueryData(["codex-models"], models),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (catalog.isPending) {
    return (
      <Field label="Model">
        <Status variant="loading">Loading models from Codex…</Status>
      </Field>
    );
  }
  if (catalog.isError) {
    return (
      <Field label="Model" description={errorMessage(catalog.error)}>
        <Button size="small" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          Retry
        </Button>
      </Field>
    );
  }

  const models = catalog.data;
  // Codex default runs the first listed model, so its levels and speeds apply.
  const selected = codexModel(ai, models);
  const tiers = selected?.tiers ?? [];

  const setTier = (tier: string) =>
    edit((draft) => {
      draft.ai.codexServiceTier = tier;
    });

  return (
    <>
      <Field
        label="Model"
        description={`${models.length} models reported by Codex. Availability depends on your account.`}
      >
        <SettingSelect
          label="ChatGPT model"
          value={ai.codexModel}
          options={modelChoices("codex", ai, { codex: models })}
          onChange={(value) =>
            edit((draft) => applyModelChoice(draft.ai, "codex", value, { codex: models }))
          }
        />
      </Field>
      <Field>
        <Button size="small" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? "Refreshing…" : "Refresh models"}
        </Button>
      </Field>
      <EffortField
        provider="codex"
        label="ChatGPT reasoning effort"
        options={effortOptions("codex", selected?.slug ?? "", models)}
        descriptions={Object.fromEntries(
          (selected?.efforts ?? []).map((level) => [level.effort, level.description]),
        )}
        value={ai.codexEffort}
        onChange={(level) =>
          edit((draft) => {
            draft.ai.codexEffort = level;
          })
        }
      />
      {tiers.length === 0 ? (
        <Field label="Fast mode" description="Not available for this model." disabled>
          <Switch checked={false} disabled aria-label="Fast mode" />
        </Field>
      ) : tiers.length === 1 ? (
        <Field
          label={`${tiers[0].name} mode`}
          description={tiers[0].description || "Faster output uses more of your plan's usage."}
        >
          <Switch
            checked={ai.codexServiceTier === tiers[0].id}
            onCheckedChange={(checked) => setTier(checked ? tiers[0].id : "")}
            aria-label={`${tiers[0].name} mode`}
          />
        </Field>
      ) : (
        <Field label="Speed" description="Faster tiers use more of your plan's usage.">
          <SettingSelect
            label="ChatGPT speed"
            value={ai.codexServiceTier}
            options={[
              {
                value: "",
                label: "Standard",
                sublabel: "Normal speed and usage",
              },
              ...tiers.map((tier) => ({
                value: tier.id,
                label: tier.name,
                sublabel: tier.description,
              })),
            ]}
            onChange={setTier}
          />
        </Field>
      )}
    </>
  );
}

/** Effort for providers whose model field lives in provider-accounts: the API routes, Gemini, Muse. */
function OtherEffort({
  provider,
  settings,
  edit,
}: {
  provider: AIProvider;
  settings: AppSettings;
  edit: SettingsEdit;
}) {
  const apiProvider = isApiKeyProvider(provider) ? provider : null;
  const configured = useApiKeyStatuses().data?.[apiProvider ?? "openai"].configured ?? false;
  const api = useApiModels(apiProvider ?? "openai", Boolean(apiProvider) && configured);
  const options = savedModelEffort(settings.ai, provider, { api: api.data });
  return (
    <EffortField
      provider={provider}
      label={`${PROVIDER_LABEL[provider]} effort`}
      options={options}
      value={isApiKeyProvider(provider) ? (settings.ai.apiEffort[provider] ?? "") : ""}
      onChange={(level) =>
        edit((draft) => {
          if (!isApiKeyProvider(provider)) return;
          const efforts = { ...draft.ai.apiEffort };
          if (level) efforts[provider] = level;
          else delete efforts[provider];
          draft.ai.apiEffort = efforts;
        })
      }
    />
  );
}

export function AITab() {
  const { settings, edit } = useSettingsEditor();
  if (!settings) return <Status variant="loading">Loading settings…</Status>;
  const { ai } = settings;

  return (
    <>
      <FieldSet title="AI Features">
        <Field label="Enable AI" description="Turn off to hide every AI feature in the dashboard.">
          <Switch
            checked={ai.enabled}
            onCheckedChange={(checked) =>
              edit((draft) => {
                draft.ai.enabled = checked;
              })
            }
            aria-label="Enable AI"
          />
        </Field>
      </FieldSet>

      {ai.enabled ? (
        <>
          <FieldSet
            title="Default provider"
            description="Powers briefings, triage, and other AI features, and the Assistant unless you pick another model in its composer."
          >
            <Field orientation="vertical">
              <RadioGroup
                value={ai.provider}
                onValueChange={(value) =>
                  edit((draft) => {
                    draft.ai.provider = value as AIProvider;
                  })
                }
              >
                {PROVIDER_GROUPS.map((group) => (
                  <div key={group.title} className="flex flex-col gap-2">
                    <Text variant="small-strong" color="secondary" className="pt-1">
                      {group.title}
                    </Text>
                    {group.providers.map((provider) => (
                      <Label key={provider} className="items-start">
                        <RadioGroupItem value={provider} className="mt-0.5" />
                        <span className="flex flex-col">
                          <span className="flex items-center gap-1.5">
                            <ProviderMark provider={provider} className="size-3.5" />
                            <Text>{PROVIDER_LABEL[provider]}</Text>
                          </span>
                          <Text variant="small" color="tertiary">
                            {PROVIDER_DETAIL[provider]}
                          </Text>
                        </span>
                      </Label>
                    ))}
                  </div>
                ))}
              </RadioGroup>
            </Field>
            {ai.provider === "claude" ? <ClaudeOptions settings={settings} edit={edit} /> : null}
            {ai.provider === "codex" ? <CodexOptions settings={settings} edit={edit} /> : null}
            {ai.provider === "gemini" ? <GeminiModelField settings={settings} edit={edit} /> : null}
            {ai.provider === "muse" ? <MuseModelField settings={settings} edit={edit} /> : null}
            {isApiKeyProvider(ai.provider) ? (
              <ApiModelField provider={ai.provider} settings={settings} edit={edit} />
            ) : null}
            {ai.provider !== "claude" && ai.provider !== "codex" ? (
              <OtherEffort provider={ai.provider} settings={settings} edit={edit} />
            ) : null}
          </FieldSet>

          <FieldSet
            title="Subscription accounts"
            description="Your Claude, ChatGPT, Google AI, and Meta Muse plans, through their official command-line tools on this Mac. No API keys needed; sign in once in Terminal."
          >
            {SUBSCRIPTION_PROVIDERS.map((provider) => (
              <ProviderStatusRow key={provider} provider={provider} />
            ))}
          </FieldSet>

          <ApiKeysSection />

          <FieldSet title="Features" description="Turn individual AI features on or off.">
            {FEATURES.map(({ feature, label, description }) => {
              const disabled = feature === "autoBriefing" && !ai.features.briefing;
              return (
                <Field
                  key={feature}
                  label={label}
                  description={disabled ? "Turn on Daily briefing first." : description}
                  disabled={disabled}
                >
                  <Switch
                    checked={ai.features[feature]}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      edit((draft) => {
                        draft.ai.features[feature] = checked;
                      })
                    }
                    aria-label={label}
                  />
                </Field>
              );
            })}
          </FieldSet>
        </>
      ) : null}
    </>
  );
}
