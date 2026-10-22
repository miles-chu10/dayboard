import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  ClaudeModel,
  CodexModelInfo,
} from "@main/shared-types";
import {
  effortOptions,
  effortPart,
  effortSelection,
  supportedEffort,
  withEffort,
  type EffortPart,
} from "../../shared/ai-effort";
import { claudeModelName } from "../../shared/claude-model-name";

/**
 * The model list and model-change rules shared by Settings → AI and the Assistant's model menu,
 * so both offer the same models under the same names and keep the same efforts.
 */

export interface ModelChoice {
  /** The saved setting; "" is the provider's default (Claude Code's is "default"). */
  value: string;
  label: string;
  sublabel?: string;
}

/** The model lists a provider's choices come from; a list that hasn't loaded is undefined. */
export interface ModelLists {
  codex?: CodexModelInfo[];
  gemini?: string[];
  api?: ApiModelInfo[];
  /** The exact ID each Claude Code alias last ran as in this app session, keyed by alias. */
  claude?: Record<string, string>;
}

export const CLAUDE_MODEL_OPTIONS: {
  value: ClaudeModel;
  label: string;
  sublabel: string;
}[] = [
  {
    value: "default",
    label: "Claude Code default",
    sublabel: "The model set in Claude Code",
  },
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

/**
 * Claude Code's choices, each named after the model a reply last reported for that alias, such
 * as "Opus 5.5". With no report an alias keeps its own name rather than a guessed model; an ID
 * that can't be read names the default as reported and leaves the other aliases as they are.
 */
export function claudeChoices(resolved: Record<string, string> | undefined): ModelChoice[] {
  return CLAUDE_MODEL_OPTIONS.map((option) => {
    const id = resolved?.[option.value];
    if (!id) return option;
    const name = claudeModelName(id) ?? (option.value === "default" ? id : null);
    if (!name) return option;
    return {
      ...option,
      label: name,
      sublabel:
        option.value === "default"
          ? "Claude Code's default, as of its last reply"
          : `The ${option.label} alias, as of its last reply`,
    };
  });
}

/** Muse Code models; empty follows the CLI's default. */
export const MUSE_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Muse Code default" },
  { value: "muse-spark-1.3", label: "Muse Spark 1.3" },
  { value: "muse-spark-1.2", label: "Muse Spark 1.2" },
];

export const DEFAULT_MODEL_LABEL = {
  codex: "Codex default",
  gemini: "Antigravity default",
  muse: "Muse Code default",
  api: "Newest available",
} as const;

const CLI_PROVIDERS: readonly AIProvider[] = ["claude", "codex", "gemini", "muse"];

export function claudeSupportsFast(model: ClaudeModel): boolean {
  return model === "opus" || model === "opus[1m]";
}

/** The saved model setting for a provider. */
export function savedModel(ai: AppSettings["ai"], provider: AIProvider): string {
  if (provider === "glaze") return "";
  if (provider === "claude") return ai.claudeModel;
  if (provider === "codex") return ai.codexModel;
  if (provider === "gemini") return ai.geminiModel;
  if (provider === "muse") return ai.museModel;
  return ai.apiModels[provider];
}

/** Codex's default is its first listed model, which DayBoard passes explicitly. */
export function codexModel(
  ai: AppSettings["ai"],
  models: CodexModelInfo[] | undefined,
): CodexModelInfo | undefined {
  return ai.codexModel ? models?.find((model) => model.slug === ai.codexModel) : models?.[0];
}

/** The model ID a choice runs, which keys the effort table; "" when unknown. */
function effortModel(provider: AIProvider, value: string, lists: ModelLists): string {
  if (provider === "codex") return value || (lists.codex?.[0]?.slug ?? "");
  if (provider === "glaze" || CLI_PROVIDERS.includes(provider)) return value;
  return value || (lists.api?.[0]?.id ?? "");
}

/** Levels for the saved model, the same table the composer's slider uses. */
export function savedModelEffort(ai: AppSettings["ai"], provider: AIProvider, lists: ModelLists) {
  return effortOptions(
    provider,
    effortModel(provider, savedModel(ai, provider), lists),
    lists.codex,
  );
}

function withSaved(choices: ModelChoice[], saved: string): ModelChoice[] {
  return saved && !choices.some((choice) => choice.value === saved)
    ? [...choices, { value: saved, label: saved, sublabel: "Not in the current model list" }]
    : choices;
}

/** A provider's models: its default first, then the listed models, then a saved unlisted one. */
export function modelChoices(
  provider: AIProvider,
  ai: AppSettings["ai"],
  lists: ModelLists,
): ModelChoice[] {
  const saved = savedModel(ai, provider);
  if (provider === "glaze") return [{ value: "", label: "Glaze AI" }];
  if (provider === "claude") return withSaved(claudeChoices(lists.claude), saved);
  if (provider === "codex") {
    const first = lists.codex?.[0];
    return withSaved(
      [
        {
          value: "",
          label: DEFAULT_MODEL_LABEL.codex,
          sublabel: first ? `Codex's first model, ${first.name}` : "Codex's first listed model",
        },
        ...(lists.codex ?? []).map((model) => ({
          value: model.slug,
          label: model.name,
          sublabel: model.description || undefined,
        })),
      ],
      saved,
    );
  }
  if (provider === "gemini")
    return withSaved(
      [
        { value: "", label: DEFAULT_MODEL_LABEL.gemini },
        ...(lists.gemini ?? []).map((model) => ({ value: model, label: model })),
      ],
      saved,
    );
  if (provider === "muse") return withSaved(MUSE_MODEL_OPTIONS, saved);
  const newest = lists.api?.[0];
  return withSaved(
    [
      {
        value: "",
        label: DEFAULT_MODEL_LABEL.api,
        sublabel: newest ? `Currently ${newest.name}` : undefined,
      },
      ...(lists.api ?? []).map((model) => ({
        value: model.id,
        label: model.name,
        sublabel: model.id !== model.name ? model.id : undefined,
      })),
    ],
    saved,
  );
}

/**
 * Saves a model choice, keeping each effort and Fast setting only where the new model has it:
 * the one-click features' effort, the Assistant's effort and Fast mode or the Codex speed. While
 * the list that names the model is still loading, the saved settings stay as they are; the send
 * time check drops any the model turns out not to have.
 */
export function applyModelChoice(
  ai: AppSettings["ai"],
  provider: AIProvider,
  value: string,
  lists: ModelLists,
): void {
  const known =
    provider === "codex"
      ? lists.codex !== undefined
      : provider === "glaze" ||
        CLI_PROVIDERS.includes(provider) ||
        Boolean(value) ||
        lists.api !== undefined;
  if (provider === "claude") {
    ai.claudeModel = value as ClaudeModel;
    if (!claudeSupportsFast(ai.claudeModel)) ai.claudeFast = false;
    const levels = effortOptions("claude", value);
    if (!supportedEffort(levels, ai.claudeEffort)) ai.claudeEffort = "default";
  } else if (provider === "codex") {
    ai.codexModel = value;
    const model = codexModel(ai, lists.codex);
    if (known && !model?.efforts.some((level) => level.effort === ai.codexEffort))
      ai.codexEffort = "";
    if (known && !model?.tiers.some((tier) => tier.id === ai.codexServiceTier))
      ai.codexServiceTier = "";
  } else if (provider === "gemini") ai.geminiModel = value;
  else if (provider === "muse") ai.museModel = value;
  else if (provider !== "glaze" && !known) ai.apiModels[provider] = value;
  else if (provider !== "glaze") {
    ai.apiModels[provider] = value;
    const kept = supportedEffort(
      effortOptions(provider, effortModel(provider, value, lists)),
      ai.apiEffort?.[provider],
    );
    const efforts = { ...ai.apiEffort };
    if (kept) efforts[provider] = kept;
    else delete efforts[provider];
    ai.apiEffort = efforts;
  }
  if (!known) return;
  const kept = supportedEffort(
    effortOptions(provider, effortModel(provider, value, lists), lists.codex),
    ai.assistantEffort?.[provider],
  );
  const efforts = { ...ai.assistantEffort };
  if (kept) efforts[provider] = kept;
  else delete efforts[provider];
  ai.assistantEffort = efforts;
}

/**
 * The effort the Assistant's next request names beside `modelId`: the composer's level checked
 * against that model, else who picks it.
 */
export function assistantEffortPart(
  ai: AppSettings["ai"],
  provider: AIProvider,
  modelId: string,
  codexModels: CodexModelInfo[] | undefined,
  claudeModels: Record<string, string> | undefined,
): EffortPart | null {
  // "Claude Code default" before any report already leaves both model and effort to Claude Code.
  if (provider === "claude" && modelId === "default" && !claudeModels?.default) return null;
  const options = effortOptions(provider, modelId, codexModels);
  const { level } = effortSelection(options, ai.assistantEffort?.[provider]);
  return effortPart(provider, options, level);
}

/** The next request's model, effort and Fast mode, e.g. "Opus 5.5 Max · Fast". */
export function modelSummary(model: {
  label: string;
  effort: EffortPart | null;
  fast: boolean;
}): string {
  return `${withEffort(model.label, model.effort)}${model.fast ? " · Fast" : ""}`;
}

export const MODEL_NOT_RECORDED = "model not recorded";

/**
 * What the chat's latest finished reply recorded about its model and effort: null before any
 * reply, MODEL_NOT_RECORDED for one that recorded nothing (demo, a failed run, an older chat).
 */
export function lastReplyLabel(
  messages: readonly { id?: string; role: string; modelLabel?: string }[],
  runningId?: string | null,
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || (runningId && message.id === runningId)) continue;
    return message.modelLabel || MODEL_NOT_RECORDED;
  }
  return null;
}
