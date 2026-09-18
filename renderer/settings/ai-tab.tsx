import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Field,
  FieldSet,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Status,
  Switch,
  Text,
  toast,
} from "@glaze/core/components";
import type { AIFeature, AIProvider, AppSettings, ProviderStatus } from "@main/shared-types";

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

const CLAUDE_MODELS = [
  { value: "default", label: "Claude Code default" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

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

function CodexModelField({
  settings,
  onSave,
}: {
  settings: AppSettings;
  onSave: (model: string) => void;
}) {
  const [model, setModel] = useState(settings.ai.codexModel);
  return (
    <Field label="Model" description="Leave empty to use your Codex default.">
      <Input
        size="small"
        className="w-48"
        value={model}
        placeholder="Default"
        spellCheck={false}
        onChange={(event) => setModel(event.target.value)}
        onBlur={() => model.trim() !== settings.ai.codexModel && onSave(model.trim())}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </Field>
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
            {ai.provider === "claude" ? (
              <Field label="Model">
                <SettingSelect
                  label="Claude model"
                  value={ai.claudeModel}
                  options={CLAUDE_MODELS}
                  onChange={(value) =>
                    edit((draft) => {
                      draft.ai.claudeModel = value as AppSettings["ai"]["claudeModel"];
                    })
                  }
                />
              </Field>
            ) : null}
            {ai.provider === "codex" ? (
              <CodexModelField
                settings={settings}
                onSave={(model) =>
                  edit((draft) => {
                    draft.ai.codexModel = model;
                  })
                }
              />
            ) : null}
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
