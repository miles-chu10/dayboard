import type { AIProvider, CodexModelInfo } from "../main/shared-types.js";

/**
 * Reasoning effort for the Assistant composer: which levels each route accepts, Codex's labels
 * and the `/effort` argument parser. Used by the renderer (picker, `/effort`) and the main
 * process (the send-time check). Keep this file identical in the Glaze build.
 */

export interface EffortOptions {
  /**
   * Levels the model accepts, in the provider's order (lowest first in DayBoard's own tables);
   * empty when DayBoard offers no effort control.
   */
  levels: string[];
  /** The level the model uses when DayBoard sends none; null when the provider doesn't say. */
  defaultLevel: string | null;
  /** Why `levels` is empty when the reason isn't that the model lacks effort. */
  note?: string;
}

export const NO_EFFORT_NOTE = "This model doesn't have effort settings.";

export const CLAUDE_DEFAULT_NOTE =
  "Claude Code picks its default model when it runs. Choose a model to set effort.";

export const ULTRA_WARNING = "Runs several agents at once and uses your limit much faster.";

export const ULTRA_FALLBACK_NOTE =
  "Ultra is available with Codex on GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Sol or Terra.";

const LABELS = new Map([
  ["none", "None"],
  ["minimal", "Minimal"],
  ["low", "Light"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
  ["ultra", "Ultra"],
]);

const ARGUMENTS = new Map([
  ["none", "none"],
  ["minimal", "minimal"],
  ["low", "low"],
  ["light", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
  ["extrahigh", "xhigh"],
  ["max", "max"],
  ["ultra", "ultra"],
]);

const LIGHT_TO_MAX = ["low", "medium", "high", "xhigh", "max"];
const WITHOUT_EXTRA_HIGH = ["low", "medium", "high", "max"];

// Exact families plus dated snapshots, like supportsExplicitCache in prompt-cache.ts.
// The OpenAI API route offers effort only on GPT-6 Astra and GPT-6.1 Sol, Light to Max; other
// OpenAI models get the model default. @ai-sdk/openai drops levels outside low–max for GPT-6+.
const OPENAI_LEVELS: [RegExp, string[]][] = [
  [/^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/, LIGHT_TO_MAX],
  [/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/, LIGHT_TO_MAX],
];

const ANTHROPIC_LEVELS: [RegExp, string[]][] = [
  [
    /^claude-(?:fable-5(?:-1)?|opus-5(?:-5)?|sonnet-5(?:-5)?|haiku-5-5|opus-4-[78])(?:-\d{8})?$/,
    LIGHT_TO_MAX,
  ],
  [/^claude-(?:opus|sonnet)-4-6(?:-\d{8})?$/, WITHOUT_EXTRA_HIGH],
];

export function effortLabel(level: string): string {
  return LABELS.get(level) ?? level.charAt(0).toUpperCase() + level.slice(1);
}

/** Built fresh on every call, so a caller that edits its result can't change the next one. */
function noEffort(): EffortOptions {
  return { levels: [], defaultLevel: null };
}

function tableLevels(rows: [RegExp, string[]][], modelId: string): EffortOptions {
  const row = rows.find(([pattern]) => pattern.test(modelId));
  return row ? { levels: [...row[1]], defaultLevel: null } : noEffort();
}

/**
 * Levels for the model that serves the next Assistant request. `modelId` is the Claude Code
 * alias on `claude`, the catalog slug on `codex`, and the exact model ID on API routes. A model
 * DayBoard doesn't know gets no control rather than a guess.
 */
export function effortOptions(
  provider: AIProvider,
  modelId: string,
  codexCatalog: CodexModelInfo[] = [],
): EffortOptions {
  if (provider === "claude") {
    // Claude Code resolves its default only when it runs, so DayBoard can't check that model.
    if (modelId === "default") return { ...noEffort(), note: CLAUDE_DEFAULT_NOTE };
    return modelId === "haiku" ? noEffort() : { levels: [...LIGHT_TO_MAX], defaultLevel: null };
  }
  if (provider === "codex") {
    const model = codexCatalog.find((entry) => entry.slug === modelId);
    if (!model) return noEffort();
    const levels = model.efforts.map((entry) => entry.effort);
    const fallback = model.defaultEffort;
    return { levels, defaultLevel: fallback && levels.includes(fallback) ? fallback : null };
  }
  if (provider === "openai") return tableLevels(OPENAI_LEVELS, modelId);
  if (provider === "anthropic") return tableLevels(ANTHROPIC_LEVELS, modelId);
  return noEffort();
}

/** What the panel, Settings and `/effort` say when a model has no levels. */
export function noEffortNote(options: EffortOptions): string {
  return options.note ?? NO_EFFORT_NOTE;
}

/** The saved level when the model accepts it; "" means send the model default. */
export function supportedEffort(options: EffortOptions, stored: string | undefined): string {
  return stored && options.levels.includes(stored) ? stored : "";
}

/** What the picker shows: the saved level, else the model's default (null when unknown). */
export function effortSelection(
  options: EffortOptions,
  stored: string | undefined,
): { level: string | null; explicit: boolean } {
  const level = supportedEffort(options, stored);
  return level ? { level, explicit: true } : { level: options.defaultLevel, explicit: false };
}

/** Chip and panel label for a selection. */
export function selectionLabel(level: string | null): string {
  return level ? effortLabel(level) : "Default";
}

function listPhrase(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Where Ultra runs: from the live Codex catalog when there is one (a catalog that lists no Ultra
 * model says so), otherwise the known models.
 */
export function ultraNote(codexCatalog: CodexModelInfo[] = []): string {
  if (!codexCatalog.length) return ULTRA_FALLBACK_NOTE;
  const names = codexCatalog
    .filter((model) => model.efforts.some((entry) => entry.effort === "ultra"))
    .map((model) => model.name);
  return names.length
    ? `Ultra is available with Codex on ${listPhrase(names)}.`
    : "Ultra isn't available on any of your Codex models.";
}

/** Reads a `/effort` argument written as a label or a value: "high", "Extra High", "xhigh". */
export function parseEffortArgument(text: string): string | null {
  return (
    ARGUMENTS.get(
      text
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, ""),
    ) ?? null
  );
}

/** `/effort <argument>` on this model: the level to save, or the message to show instead. */
export function effortCommand(
  options: EffortOptions,
  argument: string,
  ultra: string,
): { level: string } | { message: string } {
  if (!options.levels.length) return { message: noEffortNote(options) };
  const level = parseEffortArgument(argument);
  if (level && options.levels.includes(level)) return { level };
  if (level === "ultra") return { message: ultra };
  return { message: `This model supports ${options.levels.map(effortLabel).join(", ")}.` };
}
