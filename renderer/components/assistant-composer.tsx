import { useCallback, useRef, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AIChat,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import {
  ChevronDown,
  File,
  Folder,
  Loader2,
  Mic,
  Plus,
  ShieldCheck,
  Square,
  X,
  Zap,
} from "lucide-react";
import type { AssistantAttachment, AssistantPermission, OpenAIKeyStatus } from "@main/shared-types";

import {
  CLAUDE_MODEL_OPTIONS,
  claudeSupportsFast,
  formatTokens,
  selectedModel,
  useCodexModels,
} from "../lib/ai-models";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { PROVIDER_LABEL, useSettingsEditor } from "../lib/settings";
import { useDictation } from "../lib/use-dictation";
import { ProviderMark } from "./provider-logo";

export const PERMISSION_OPTIONS: {
  value: AssistantPermission;
  label: string;
  sublabel: string;
}[] = [
  {
    value: "read-only",
    label: "Read only",
    sublabel: "Answers only; never proposes changes",
  },
  {
    value: "ask",
    label: "Ask first",
    sublabel: "Proposes items; you confirm each one",
  },
  {
    value: "auto",
    label: "Auto",
    sublabel: "Adds proposed tasks, reminders, and events",
  },
];

export interface ContextUsage {
  inputTokens: number;
  contextWindow: number | null;
}

function ContextRing({
  usage,
  fallbackWindow,
}: {
  usage: ContextUsage | null;
  fallbackWindow: number | null;
}) {
  const window = usage?.contextWindow ?? fallbackWindow;
  const used = usage?.inputTokens ?? 0;
  const ratio = window ? Math.min(1, used / window) : 0;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const label = !usage
    ? window
      ? `Context window: ${formatTokens(window)} tokens. Usage appears after the first reply.`
      : "Context usage appears after the first reply."
    : window
      ? `${Math.round(ratio * 100)}% of context used · ${formatTokens(used)} / ${formatTokens(window)} tokens`
      : `${formatTokens(used)} tokens in context`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="flex size-7 items-center justify-center">
          <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              strokeWidth="2"
              className="stroke-control"
            />
            <circle
              cx="9"
              cy="9"
              r={radius}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
              className={ratio > 0.85 ? "stroke-support-orange" : "stroke-accent"}
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AssistantComposer({
  input,
  setInput,
  attachments,
  setAttachments,
  onSend,
  onStop,
  running,
  disabled,
  usage,
  demo,
}: {
  input: string;
  setInput: (updater: (previous: string) => string) => void;
  attachments: AssistantAttachment[];
  setAttachments: (updater: (previous: AssistantAttachment[]) => AssistantAttachment[]) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
  usage: ContextUsage | null;
  demo: boolean;
}) {
  const { settings, edit } = useSettingsEditor();
  const ai = settings?.ai;
  const provider = ai?.provider ?? "glaze";
  const codexModels = useCodexModels(provider === "codex");
  const current = selectedModel(settings, codexModels.data);
  const permission = ai?.assistantPermission ?? "ask";
  const permissionLabel = PERMISSION_OPTIONS.find((option) => option.value === permission)?.label;
  const openAIKey = useQuery({
    queryKey: ["openai-key"],
    queryFn: () => invoke<OpenAIKeyStatus>("openai:keyStatus"),
    staleTime: 60_000,
  });
  const inputRef = useRef("");
  inputRef.current = input;

  const appendText = useCallback(
    (text: string) =>
      setInput((previous) => (previous.trim() ? `${previous.trimEnd()} ${text}` : text)),
    [setInput],
  );
  const dictationError = useCallback((message: string) => {
    toast.error(
      message,
      message.includes("Settings → AI")
        ? { action: { label: "Settings", onClick: () => void openSettings() } }
        : undefined,
    );
  }, []);
  const dictation = useDictation(appendText, dictationError);

  async function addAttachments() {
    try {
      const picked = await invoke<AssistantAttachment[]>("assistant:pickAttachments");
      if (picked.length) setAttachments((previous) => [...previous, ...picked].slice(-10));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function toggleDictation() {
    if (dictation.state === "recording") dictation.stop();
    else if (dictation.state === "idle") {
      if (!openAIKey.data?.configured) {
        dictationError("Add an OpenAI API key in Settings → AI to use dictation.");
        return;
      }
      void dictation.start();
    }
  }

  const fastAvailable =
    provider === "claude"
      ? claudeSupportsFast(ai?.claudeModel ?? "default")
      : provider === "codex"
        ? Boolean(
            (
              codexModels.data?.find((model) => model.slug === ai?.codexModel) ??
              codexModels.data?.[0]
            )?.tiers.length,
          )
        : false;
  const codexSelected =
    codexModels.data?.find((model) => model.slug === ai?.codexModel) ?? codexModels.data?.[0];

  return (
    <AIChat.Composer.Root
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <AIChat.Composer.Surface>
        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5 px-2 pt-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md bg-control-subtle pl-2 pr-0.5 text-small"
              >
                {attachment.kind === "folder" ? (
                  <Folder className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
                ) : (
                  <File className="size-3.5 shrink-0 text-secondary" aria-hidden="true" />
                )}
                <span className="truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="flex size-5 items-center justify-center rounded text-tertiary hover:bg-control focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <AIChat.Composer.Row>
          <AIChat.Composer.Input
            disabled={disabled}
            aria-label={`Message ${PROVIDER_LABEL[provider]}`}
            value={input}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setInput(() => event.target.value)
            }
            placeholder={
              dictation.state === "recording"
                ? "Listening… click the microphone to stop"
                : dictation.state === "transcribing"
                  ? "Transcribing…"
                  : `Message ${PROVIDER_LABEL[provider]}…`
            }
          />
        </AIChat.Composer.Row>
        <AIChat.Composer.Row>
          <AIChat.Composer.Actions>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button iconOnly size="small" variant="transparent" aria-label="Add" title="Add">
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top">
                <DropdownMenuItem
                  icon="paperclip"
                  disabled={demo}
                  onSelect={() => void addAttachments()}
                >
                  Add Files or Folders…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="small"
                  variant="transparent"
                  aria-label={`Permissions: ${permissionLabel}`}
                >
                  <ShieldCheck
                    className={permission === "auto" ? "text-support-orange" : undefined}
                  />
                  {permissionLabel}
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top">
                <DropdownMenuLabel>Permissions</DropdownMenuLabel>
                {PERMISSION_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    sublabel={option.sublabel}
                    checked={permission === option.value}
                    onCheckedChange={() =>
                      edit((draft) => {
                        draft.ai.assistantPermission = option.value;
                      })
                    }
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="small"
                  variant="transparent"
                  aria-label={`Model: ${current.label}${current.fast ? ", Fast" : ""}`}
                >
                  <ProviderMark provider={provider} className="size-3.5" />
                  <span className="max-w-44 truncate">{current.label}</span>
                  {current.fast ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-support-yellow-10 px-1 text-small font-medium text-support-yellow">
                      <Zap className="size-3 fill-current" aria-hidden="true" />
                      Fast
                    </span>
                  ) : null}
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top">
                <DropdownMenuLabel>{`${PROVIDER_LABEL[provider]} model`}</DropdownMenuLabel>
                {provider === "claude"
                  ? CLAUDE_MODEL_OPTIONS.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        sublabel={option.sublabel}
                        checked={ai?.claudeModel === option.value}
                        onCheckedChange={() =>
                          edit((draft) => {
                            draft.ai.claudeModel = option.value;
                          })
                        }
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))
                  : provider === "codex"
                    ? (codexModels.data ?? []).map((model) => (
                        <DropdownMenuCheckboxItem
                          key={model.slug}
                          sublabel={model.slug}
                          checked={codexSelected?.slug === model.slug}
                          onCheckedChange={() =>
                            edit((draft) => {
                              draft.ai.codexModel = model.slug;
                              draft.ai.codexEffort = "";
                              if (
                                !model.tiers.some((tier) => tier.id === draft.ai.codexServiceTier)
                              )
                                draft.ai.codexServiceTier = "";
                            })
                          }
                        >
                          {model.name}
                        </DropdownMenuCheckboxItem>
                      ))
                    : [
                        <DropdownMenuItem key="glaze" disabled>
                          Glaze AI picks the model
                        </DropdownMenuItem>,
                      ]}
                {fastAvailable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      icon="bolt.fill"
                      sublabel="Faster replies; uses more of your plan"
                      checked={current.fast}
                      onCheckedChange={(checked) =>
                        edit((draft) => {
                          if (provider === "claude") draft.ai.claudeFast = checked;
                          else
                            draft.ai.codexServiceTier = checked
                              ? (codexSelected?.tiers[0]?.id ?? "")
                              : "";
                        })
                      }
                    >
                      Fast mode
                    </DropdownMenuCheckboxItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void openSettings()}>
                  AI Settings…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </AIChat.Composer.Actions>
          <AIChat.Composer.Actions>
            <ContextRing usage={usage} fallbackWindow={current.contextWindow} />
            <Button
              iconOnly
              size="small"
              variant="transparent"
              aria-label={dictation.state === "recording" ? "Stop dictation" : "Dictate"}
              title={dictation.state === "recording" ? "Stop dictation" : "Dictate"}
              aria-pressed={dictation.state === "recording"}
              disabled={
                demo ||
                disabled ||
                dictation.state === "starting" ||
                dictation.state === "transcribing"
              }
              onClick={toggleDictation}
              className={cn(dictation.state === "recording" && "text-support-red")}
            >
              {dictation.state === "transcribing" || dictation.state === "starting" ? (
                <Loader2 className="animate-spin" />
              ) : dictation.state === "recording" ? (
                <Square className="fill-current" />
              ) : (
                <Mic />
              )}
            </Button>
            {running ? (
              <AIChat.Composer.Submit action="stop" type="button" onClick={onStop} />
            ) : (
              <AIChat.Composer.Submit
                action="send"
                disabled={!inputRef.current.trim() || disabled || dictation.state !== "idle"}
              />
            )}
          </AIChat.Composer.Actions>
        </AIChat.Composer.Row>
      </AIChat.Composer.Surface>
    </AIChat.Composer.Root>
  );
}
