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
  ClaudeModel,
  CodexModelInfo,
  ProviderStatus,
} from "@main/shared-types";

import { errorMessage, invoke } from "../lib/ipc";
import { ProviderMark } from "../components/provider-logo";
import { PROVIDER_DETAIL, PROVIDER_LABEL, useSettingsEditor } from "../lib/settings";
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

// Radix Select can't use an empty value, so "use the default" is a sentinel.
const DEFAULT_OPTION = "__default";

const CLAUDE_MODELS: { value: ClaudeModel; label: string; sublabel: string }[] = [
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

const CLAUDE_EFFORTS: { value: ClaudeEffort; label: string; sublabel: string }[] = [
  { value: "default", label: "Default", sublabel: "Use Claude Code's setting" },
  { value: "low", label: "Low", sublabel: "Fast responses with lighter thinking" },
  { value: "medium", label: "Medium", sublabel: "Balances speed and depth" },
  { value: "high", label: "High", sublabel: "Deeper thinking for complex requests" },
  { value: "xhigh", label: "Extra High", sublabel: "Even more thinking" },
  { value: "max", label: "Max", sublabel: "Maximum thinking for the hardest problems" },
];

const EFFORT_LABEL: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

function effortLabel(effort: string): string {
  return EFFORT_LABEL[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}

function ProviderStatusRow({ provider }: { provider: "claude" | "codex" }) {
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
      ? { variant: "loading" as const, text: verify.isPending ? "Checking sign-in…" : "Checking…" }
      : current?.ok
        ? { variant: "success" as const, text: verified ? "Ready" : "Installed" }
        : current?.reason === "not-logged-in"
          ? { variant: "warning" as const, text: "Not signed in" }
          : current?.reason === "missing"
            ? { variant: "error" as const, text: "Not installed" }
            : { variant: "error" as const, text: "Unavailable" };

  return (
    <Field
      label={provider === "claude" ? "Claude Code" : "Codex CLI"}
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
  const supportsEffort = ai.claudeModel !== "haiku";
  const supportsFast = ai.claudeModel === "opus" || ai.claudeModel === "opus[1m]";
  return (
    <>
      <Field
        label="Model"
        description="Claude Code model aliases; availability depends on your account."
      >
        <SettingSelect
          label="Claude model"
          value={ai.claudeModel}
          options={CLAUDE_MODELS}
          onChange={(value) =>
            edit((draft) => {
              draft.ai.claudeModel = value as ClaudeModel;
              if (value === "haiku") draft.ai.claudeEffort = "default";
              if (value !== "opus" && value !== "opus[1m]") draft.ai.claudeFast = false;
            })
          }
        />
      </Field>
      <Field
        label="Thinking effort"
        description={
          supportsEffort
            ? "More effort gives deeper answers but takes longer."
            : "Haiku does not offer a thinking-effort setting."
        }
        disabled={!supportsEffort}
      >
        <SettingSelect
          label="Claude thinking effort"
          value={supportsEffort ? ai.claudeEffort : "default"}
          disabled={!supportsEffort}
          options={CLAUDE_EFFORTS}
          onChange={(value) =>
            edit((draft) => {
              draft.ai.claudeEffort = value as ClaudeEffort;
            })
          }
        />
      </Field>
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
  const selected = models.find((model) => model.slug === ai.codexModel) ?? null;
  const efforts = selected?.efforts ?? [];
  const tiers = selected?.tiers ?? [];

  const modelOptions = [
    {
      value: DEFAULT_OPTION,
      label: "Codex default",
      sublabel: "Let Codex choose its recommended default model",
    },
    ...models.map((model) => ({
      value: model.slug,
      label: model.name,
      sublabel: model.description,
    })),
    ...(ai.codexModel && !selected
      ? [
          {
            value: ai.codexModel,
            label: ai.codexModel,
            sublabel: "Not in Codex's current model list",
          },
        ]
      : []),
  ];
  const effortOptions = [
    {
      value: DEFAULT_OPTION,
      label: selected?.defaultEffort
        ? `Default (${effortLabel(selected.defaultEffort)})`
        : "Default",
      sublabel: "Use the model's default",
    },
    ...efforts.map((level) => ({
      value: level.effort,
      label: effortLabel(level.effort),
      sublabel: level.description,
    })),
  ];

  function selectModel(slug: string) {
    const model = models.find((candidate) => candidate.slug === slug);
    edit((draft) => {
      draft.ai.codexModel = slug === DEFAULT_OPTION ? "" : slug;
      if (!model) {
        draft.ai.codexEffort = "";
        draft.ai.codexServiceTier = "";
        return;
      }
      if (
        draft.ai.codexEffort &&
        !model.efforts.some((level) => level.effort === draft.ai.codexEffort)
      ) {
        draft.ai.codexEffort = "";
      }
      if (
        draft.ai.codexServiceTier &&
        !model.tiers.some((tier) => tier.id === draft.ai.codexServiceTier)
      ) {
        draft.ai.codexServiceTier = "";
      }
    });
  }

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
          value={ai.codexModel || DEFAULT_OPTION}
          options={modelOptions}
          onChange={selectModel}
        />
      </Field>
      <Field>
        <Button size="small" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? "Refreshing…" : "Refresh models"}
        </Button>
      </Field>
      <Field
        label="Reasoning effort"
        description={
          selected
            ? "More effort gives deeper answers but takes longer."
            : "Choose a model to customize reasoning and speed."
        }
        disabled={!selected || !efforts.length}
      >
        <SettingSelect
          label="ChatGPT reasoning effort"
          value={selected ? ai.codexEffort || DEFAULT_OPTION : DEFAULT_OPTION}
          disabled={!selected || !efforts.length}
          options={effortOptions}
          onChange={(value) =>
            edit((draft) => {
              draft.ai.codexEffort = value === DEFAULT_OPTION ? "" : value;
            })
          }
        />
      </Field>
      {tiers.length === 0 ? (
        <Field
          label="Fast mode"
          description={
            selected ? "Not available for this model." : "Choose a model to customize speed."
          }
          disabled
        >
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
            value={ai.codexServiceTier || DEFAULT_OPTION}
            options={[
              { value: DEFAULT_OPTION, label: "Standard", sublabel: "Normal speed and usage" },
              ...tiers.map((tier) => ({
                value: tier.id,
                label: tier.name,
                sublabel: tier.description,
              })),
            ]}
            onChange={(value) => setTier(value === DEFAULT_OPTION ? "" : value)}
          />
        </Field>
      )}
    </>
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
            title="Provider"
            description="Choose what powers AI features. Subscriptions run through the official command-line tools on this Mac, so no API keys are needed."
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
                {(["glaze", "claude", "codex"] as const).map((provider) => (
                  <Label key={provider}>
                    <RadioGroupItem value={provider} />
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
              </RadioGroup>
            </Field>
            {ai.provider !== "glaze" ? (
              <ProviderStatusRow key={ai.provider} provider={ai.provider} />
            ) : null}
            {ai.provider === "claude" ? <ClaudeOptions settings={settings} edit={edit} /> : null}
            {ai.provider === "codex" ? <CodexOptions settings={settings} edit={edit} /> : null}
          </FieldSet>

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
