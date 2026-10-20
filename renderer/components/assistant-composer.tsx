import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import {
  AIChat,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
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
import type { AIProvider, AssistantAttachment, AssistantPermission } from "@main/shared-types";

import {
  assistantProvider,
  formatTokens,
  selectedModel,
  useClaudeModels,
  useCodexModels,
  useProviderAvailability,
} from "../lib/ai-models";
import {
  applyModelChoice,
  claudeSupportsFast,
  codexModel,
  modelChoices,
  modelSummary,
  savedModel,
  type ModelLists,
} from "../lib/model-choices";
import { useAllApiModels, useGeminiModels } from "../settings/provider-accounts";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import {
  API_KEY_PROVIDERS,
  PROVIDER_LABEL,
  SUBSCRIPTION_PROVIDERS,
  isApiKeyProvider,
  useSettingsEditor,
} from "../lib/settings";
import { useDictation } from "../lib/use-dictation";
import { ProviderMark } from "./provider-logo";
import {
  effortCommand,
  noEffortNote,
  effortOptions,
  effortPhrase,
  effortSelection,
  ultraNote,
} from "../../shared/ai-effort";
import {
  commandSections,
  parseModeArgument,
  slashInput,
  type AssistantCommand,
  type AssistantViewAction,
} from "../lib/assistant-commands";
import {
  MAX_MENTIONS,
  filterMentions,
  mentionQuery,
  type MentionItem,
} from "../lib/assistant-mentions";
import { ComposerMenu, type ComposerMenuModel } from "./composer-menu";
import { ComposerPopup } from "./composer-popup";
import { EffortPanel } from "./effort-panel";
import { MentionChip, MentionIcon } from "./mention-chip";

const PICKER_PROVIDERS: AIProvider[] = [...SUBSCRIPTION_PROVIDERS, ...API_KEY_PROVIDERS, "glaze"];

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
  mentions,
  setMentions,
  mentionCandidates,
  onSend,
  onStop,
  onAction,
  onPrompt,
  running,
  disabled,
  usage,
  demo,
  lastReply,
}: {
  input: string;
  setInput: (updater: (previous: string) => string) => void;
  attachments: AssistantAttachment[];
  setAttachments: (updater: (previous: AssistantAttachment[]) => AssistantAttachment[]) => void;
  mentions: MentionItem[];
  setMentions: (updater: (previous: MentionItem[]) => MentionItem[]) => void;
  /** Everything the user can mention, from the data the Assistant already loaded. */
  mentionCandidates: MentionItem[];
  onSend: () => void;
  onStop: () => void;
  /** Slash-command actions the Assistant view owns. */
  onAction: (name: AssistantViewAction) => void;
  /** Sends a prompt command's text. */
  onPrompt: (prompt: string) => void;
  running: boolean;
  disabled: boolean;
  usage: ContextUsage | null;
  demo: boolean;
  /** The model and effort the chat's last reply recorded, as evidence beside the next request's. */
  lastReply: string | null;
}) {
  const { settings, edit } = useSettingsEditor();
  const ai = settings?.ai;
  const provider = assistantProvider(settings);
  const available = useProviderAvailability().data;
  const codexModels = useCodexModels(Boolean(available?.codex));
  const geminiModels = useGeminiModels(Boolean(available?.gemini));
  const apiModels = useAllApiModels(available);
  const claudeModels = useClaudeModels().data;
  const current = selectedModel(
    settings,
    codexModels.data,
    provider,
    isApiKeyProvider(provider) ? apiModels[provider] : undefined,
    claudeModels,
  );

  function lists(option: AIProvider): ModelLists {
    return {
      codex: codexModels.data,
      gemini: geminiModels.data,
      api: isApiKeyProvider(option) ? apiModels[option] : undefined,
      claude: claudeModels,
    };
  }

  // Glaze's submenu may not scroll, so an API provider lists its 25 newest models and the saved
  // one; Settings lists them all.
  function menuChoices(option: AIProvider) {
    if (!ai) return [];
    const choices = modelChoices(option, ai, lists(option));
    if (!isApiKeyProvider(option)) return choices;
    const saved = savedModel(ai, option);
    return choices.filter((choice, index) => index <= 25 || choice.value === saved);
  }

  function choose(option: AIProvider, value: string) {
    edit((draft) => {
      draft.ai.assistantProvider = option === draft.ai.provider ? "" : option;
      applyModelChoice(draft.ai, option, value, lists(option));
    });
  }
  const permission = ai?.assistantPermission ?? "ask";
  const permissionLabel = PERMISSION_OPTIONS.find((option) => option.value === permission)?.label;
  const openAIKey = { data: { configured: Boolean(available?.openai) } };
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

  const codexSelected = ai ? codexModel(ai, codexModels.data) : undefined;
  const fastAvailable =
    provider === "claude"
      ? claudeSupportsFast(ai?.claudeModel ?? "default")
      : provider === "codex"
        ? Boolean(codexSelected?.tiers.length)
        : false;

  const [effortOpen, setEffortOpen] = useState(false);
  const effortRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const effort = effortOptions(provider, current.id, codexModels.data);
  const selection = effortSelection(effort, ai?.assistantEffort?.[provider]);
  // Built from short parts so no line-wrapping tool can split the label's text.
  const chipLabel = [
    `Model and effort: ${current.label}`,
    current.effort ? `, ${effortPhrase(current.effort)}` : "",
    current.fast ? ", Fast" : "",
  ].join("");

  // Glaze has no public popover, so the panel focuses its slider and closes on Esc and outside
  // presses itself. Esc works wherever focus is, as it would in a popover; the open `/` or `@`
  // list claims it first.
  useEffect(() => {
    if (!effortOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!effortRef.current?.contains(target) && !chipRef.current?.contains(target))
        setEffortOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setEffortOpen(false);
      chipRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [effortOpen]);

  function setEffort(level: string) {
    edit((draft) => {
      const efforts = { ...draft.ai.assistantEffort };
      if (level) efforts[provider] = level;
      else delete efforts[provider];
      draft.ai.assistantEffort = efforts;
    });
  }

  function toggleFast() {
    edit((draft) => {
      if (provider === "claude") draft.ai.claudeFast = !current.fast;
      else draft.ai.codexServiceTier = current.fast ? "" : (codexSelected?.tiers[0]?.id ?? "");
    });
  }

  const listId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const permissionTriggerRef = useRef<HTMLButtonElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);

  function runCommand(command: AssistantCommand, via: "enter" | "tab") {
    const argument = slashInput(input)?.argument ?? "";
    if (command.kind === "prompt") {
      const prompt = command.prompt ?? "";
      // While a reply runs, keep the prompt in the composer to send when it finishes.
      if (via === "tab" || running) setInput(() => prompt);
      else onPrompt(prompt);
      return;
    }
    setInput(() => "");
    switch (command.name) {
      case "new":
        onAction("new");
        return;
      case "history":
        onAction("history");
        return;
      case "mcp":
        onAction("mcp");
        return;
      case "settings":
        onAction("settings");
        return;
      case "model":
        setEffortOpen(true);
        return;
      case "effort": {
        if (!argument) {
          setEffortOpen(true);
          return;
        }
        const result = effortCommand(effort, argument, ultraNote(codexModels.data));
        if ("level" in result) setEffort(result.level);
        else toast(result.message);
        return;
      }
      case "mode": {
        if (!argument) {
          // The native menu has no open prop; its trigger opens it.
          permissionTriggerRef.current?.click();
          return;
        }
        const mode = parseModeArgument(argument);
        if (mode)
          edit((draft) => {
            draft.ai.assistantPermission = mode;
          });
        else toast("Use /mode read-only, /mode ask or /mode auto.");
        return;
      }
      case "attach":
        void addAttachments();
        return;
    }
  }

  const slash = commandSections(input, { demo });
  const slashMenu: ComposerMenuModel | null = slash.length
    ? {
        label: "Commands",
        sections: slash.map((section) => ({
          id: section.title.toLowerCase(),
          title: section.title,
          entries: section.commands.map((command) => ({
            id: `${listId}-${command.name}`,
            label: `/${command.name}${command.argument ? ` ${command.argument}` : ""}`,
            detail: command.description,
            run: (via: "enter" | "tab") => runCommand(command, via),
          })),
        })),
      }
    : null;

  const trigger = input.startsWith("/") ? null : mentionQuery(input, caret);
  const mentionResults = trigger ? filterMentions(mentionCandidates, trigger.query) : [];
  const mentionsFull = mentions.length >= MAX_MENTIONS;

  function pickMention(item: MentionItem) {
    if (!trigger) return;
    const start = trigger.start;
    setInput(() => input.slice(0, start) + input.slice(caret));
    setMentions((previous) =>
      previous.some((entry) => entry.key === item.key)
        ? previous
        : [...previous, item].slice(0, MAX_MENTIONS),
    );
    setCaret(start);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start, start));
  }

  // Open while the @ token has matches; a space after a query with none closes it.
  const mentionMenu: ComposerMenuModel | null =
    trigger && (mentionResults.length > 0 || !/\s/.test(trigger.query))
      ? {
          label: "Mentions",
          empty: mentionsFull
            ? `You can mention up to ${MAX_MENTIONS} items in one message.`
            : "No matching items",
          sections:
            mentionsFull || !mentionResults.length
              ? []
              : [
                  {
                    id: "items",
                    title: "Events, to-dos and email",
                    entries: mentionResults.map((item, index) => ({
                      id: `${listId}-mention-${index}`,
                      label: item.label,
                      detail: item.detail,
                      icon: <MentionIcon kind={item.kind} />,
                      run: () => pickMention(item),
                    })),
                  },
                ],
        }
      : null;
  const menu = dismissed === input ? null : (slashMenu ?? mentionMenu);
  const entries = menu ? menu.sections.flatMap((section) => section.entries) : [];
  const activeEntry = entries.length ? entries[Math.min(activeIndex, entries.length - 1)] : null;

  function handleMenuKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!menu || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(input);
      return;
    }
    if (!activeEntry) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((entries.indexOf(activeEntry) + step + entries.length) % entries.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      activeEntry.run(event.key === "Enter" ? "enter" : "tab");
    }
  }

  return (
    <AIChat.Composer.Root
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <ComposerMenu
        menu={menu}
        activeId={activeEntry?.id ?? null}
        anchorRef={surfaceRef}
        textareaRef={textareaRef}
        onHover={(id) =>
          setActiveIndex(
            Math.max(
              0,
              entries.findIndex((entry) => entry.id === id),
            ),
          )
        }
        onDismiss={() => setDismissed(input)}
      />
      <AIChat.Composer.Surface ref={surfaceRef}>
        {attachments.length || mentions.length ? (
          <div className="flex flex-wrap gap-1.5 px-2 pt-2">
            {mentions.map((mention) => (
              <MentionChip
                key={mention.key}
                kind={mention.kind}
                label={mention.label}
                onRemove={() =>
                  setMentions((previous) => previous.filter((item) => item.key !== mention.key))
                }
              />
            ))}
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
            ref={textareaRef}
            disabled={disabled}
            aria-label={`Message ${PROVIDER_LABEL[provider]}`}
            aria-expanded={Boolean(menu)}
            // Enter never submits while an option is active; the menu handles it.
            submitOn={activeEntry ? "manual" : "enter"}
            value={input}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setInput(() => event.target.value);
              setCaret(event.target.selectionStart);
              setActiveIndex(0);
              setDismissed(null);
            }}
            onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) =>
              setCaret(event.currentTarget.selectionStart)
            }
            onKeyDown={handleMenuKey}
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
              <DropdownMenuTrigger asChild ref={permissionTriggerRef}>
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

            <div>
              <Button
                ref={chipRef}
                size="small"
                variant="transparent"
                aria-label={chipLabel}
                title={modelSummary(current)}
                aria-haspopup="dialog"
                aria-expanded={effortOpen}
                onClick={() => setEffortOpen((open) => !open)}
              >
                {effortOpen ? (
                  <span>Select effort</span>
                ) : (
                  <>
                    <ProviderMark provider={provider} className="size-3.5" />
                    <span className="max-w-44 truncate">{current.label}</span>
                    {current.effort ? (
                      <span className="text-tertiary">{current.effort.text}</span>
                    ) : null}
                    {current.fast ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-support-yellow-10 px-1 text-small font-medium text-support-yellow">
                        <Zap className="size-3 fill-current" aria-hidden="true" />
                        Fast
                      </span>
                    ) : null}
                  </>
                )}
                <ChevronDown className="size-3 opacity-60" />
              </Button>
              {effortOpen ? (
                <ComposerPopup
                  anchorRef={chipRef}
                  popupRef={effortRef}
                  width={320}
                  focusOnOpen
                  role="dialog"
                  label="Model and effort"
                  className="rounded-2xl border border-separator bg-[var(--color-surface-popover)] p-3 shadow-xl"
                >
                  <EffortPanel
                    modelLabel={current.label}
                    nextRequest={modelSummary(current)}
                    lastReply={lastReply}
                    levels={effort.levels}
                    note={noEffortNote(effort)}
                    selection={selection}
                    onChange={setEffort}
                    fast={fastAvailable ? { on: current.fast, onToggle: toggleFast } : null}
                    ultraNote={
                      effort.levels.length > 0 && !effort.levels.includes("ultra")
                        ? ultraNote(codexModels.data)
                        : null
                    }
                    modelMenu={
                      <>
                        <DropdownMenuLabel>Model</DropdownMenuLabel>
                        {PICKER_PROVIDERS.filter(
                          (option) => available?.[option] || option === provider,
                        ).map((option) => (
                          <DropdownMenuSub
                            key={option}
                            label={`${option === provider ? "✓ " : ""}${PROVIDER_LABEL[option]}`}
                          >
                            {menuChoices(option).map((choice) => (
                              <DropdownMenuCheckboxItem
                                key={choice.value}
                                sublabel={choice.sublabel}
                                checked={
                                  option === provider && ai
                                    ? savedModel(ai, option) === choice.value
                                    : false
                                }
                                onCheckedChange={() => choose(option, choice.value)}
                              >
                                {choice.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuSub>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void openSettings()}>
                          Connect Accounts & AI Settings…
                        </DropdownMenuItem>
                      </>
                    }
                  />
                </ComposerPopup>
              ) : null}
            </div>
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
