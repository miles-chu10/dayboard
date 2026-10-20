import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  AssistantModelInfo,
  CodexModelInfo,
} from "../../shared-types.js";
import { effortOptions, supportedEffort } from "../../../shared/ai-effort.js";
import { claudeModelName } from "../../../shared/claude-model-name.js";
import { isApiProvider } from "./api-keys.js";
import { API_LABEL } from "./api-providers.js";

export function claudeModelArgs(ai: AppSettings["ai"]): string[] {
  const args: string[] = [];
  if (ai.claudeModel !== "default") args.push("--model", ai.claudeModel);
  const effort = claudeEffort(ai);
  if (effort) args.push("--effort", effort);
  // An explicit false prevents the user's CLI preference from enabling paid Fast mode.
  const fastMode = claudeFastOn(ai);
  args.push("--settings", JSON.stringify({ fastMode }));
  return args;
}

export function codexModelArgs(ai: AppSettings["ai"], models: CodexModelInfo[]): string[] {
  if (!ai.codexModel) return [];
  const model = models.find((entry) => entry.slug === ai.codexModel);
  if (!model)
    throw new Error(
      "The selected ChatGPT model is no longer listed. Refresh models in Settings and choose a model.",
    );
  const effort = ai.codexEffort || model.defaultEffort;
  if (effort && !model.efforts.some((level) => level.effort === effort)) {
    throw new Error(
      "This ChatGPT model does not support the selected reasoning effort. Update it in Settings.",
    );
  }
  if (ai.codexServiceTier && !model.tiers.some((tier) => tier.id === ai.codexServiceTier)) {
    throw new Error(
      "This ChatGPT model does not support the selected speed. Update it in Settings.",
    );
  }
  const args = ["-m", model.slug];
  if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
  if (ai.codexServiceTier) {
    args.push(
      "-c",
      `service_tier=${JSON.stringify(ai.codexServiceTier)}`,
      "-c",
      "features.fast_mode=true",
    );
  }
  return args;
}

const CLAUDE_NAMES: Record<string, string> = {
  default: "Claude Code default",
  fable: "Claude Fable",
  opus: "Claude Opus",
  sonnet: "Claude Sonnet",
  haiku: "Claude Haiku",
  "opus[1m]": "Claude Opus (1M context)",
  "sonnet[1m]": "Claude Sonnet (1M context)",
};

// Exact IDs Claude Code resolved each alias to on earlier runs in this app session (from its
// init event). Nothing is kept across restarts, since Claude Code's default can change meanwhile.
const claudeResolved = new Map<string, string>();
let claudeResolvedListener: ((models: Record<string, string>) => void) | undefined;

export function rememberClaudeModel(alias: string, id: string): void {
  if (claudeResolved.get(alias) === id) return;
  claudeResolved.set(alias, id);
  claudeResolvedListener?.(resolvedClaudeModels());
}

/** The exact ID each Claude Code alias last ran as, keyed by alias; empty until a reply reports one. */
export function resolvedClaudeModels(): Record<string, string> {
  return Object.fromEntries(claudeResolved);
}

export function onClaudeModelResolved(listener: (models: Record<string, string>) => void): void {
  claudeResolvedListener = listener;
}

/** Claude Code's default is named after the model it last ran as, once a reply has reported it. */
export function claudeDisplayName(alias: string, id: string | null): string {
  if (alias === "default" && id) {
    const name = claudeModelName(id);
    return name ? `Claude ${name}` : id;
  }
  return CLAUDE_NAMES[alias] ?? alias;
}

/** The saved Claude effort when the chosen alias takes one; Claude Code's default never does. */
function claudeEffort(ai: AppSettings["ai"]): string {
  return supportedEffort(effortOptions("claude", ai.claudeModel), ai.claudeEffort);
}

export function claudeFastOn(ai: AppSettings["ai"]): boolean {
  return ai.claudeFast && ["opus", "opus[1m]"].includes(ai.claudeModel);
}

/** What will serve the next request. Codex's default is its first listed model, passed explicitly. */
export function describeModel(
  ai: AppSettings["ai"],
  codexModels: CodexModelInfo[],
  provider: AIProvider = ai.provider,
  apiModel?: ApiModelInfo,
): AssistantModelInfo {
  if (isApiProvider(provider)) {
    const label = API_LABEL[provider];
    return {
      provider,
      name: apiModel ? `${apiModel.name} (${label})` : label,
      id: apiModel?.id ?? null,
      fast: false,
      effort: null,
      contextWindow: apiModel?.contextWindow ?? null,
    };
  }
  if (provider === "muse") {
    return {
      provider,
      name: ai.museModel ? `Muse · ${ai.museModel}` : "Muse (Muse Code default)",
      id: ai.museModel || null,
      fast: false,
      effort: null,
      contextWindow: null,
    };
  }
  if (provider === "gemini") {
    return {
      provider,
      name: ai.geminiModel ? `Gemini · ${ai.geminiModel}` : "Gemini (Antigravity default)",
      id: ai.geminiModel || null,
      fast: false,
      effort: null,
      contextWindow: null,
    };
  }
  if (provider === "claude") {
    const id = claudeResolved.get(ai.claudeModel) ?? null;
    return {
      provider: "claude",
      name: claudeDisplayName(ai.claudeModel, id),
      id,
      fast: claudeFastOn(ai),
      effort: claudeEffort(ai) || null,
      contextWindow: ai.claudeModel.endsWith("[1m]") ? 1_000_000 : 200_000,
    };
  }
  if (provider === "codex") {
    const model = codexModels.find((entry) => entry.slug === ai.codexModel) ?? codexModels[0];
    const tier = model?.tiers.find((entry) => entry.id === ai.codexServiceTier);
    return {
      provider: "codex",
      name: model?.name ?? (ai.codexModel || "Codex default"),
      id: model?.slug ?? (ai.codexModel || null),
      fast: Boolean(ai.codexServiceTier),
      effort: ai.codexEffort || model?.defaultEffort || null,
      contextWindow: model?.contextWindow ?? null,
      ...(tier ? { name: `${model?.name ?? ai.codexModel} · ${tier.name}` } : {}),
    };
  }
  throw new Error(`Unsupported AI provider: ${provider satisfies never}`);
}

/** Appended to every Assistant system prompt so the model can state what it is. */
export function modelSystemNote(info: AssistantModelInfo): string {
  const via = isApiProvider(info.provider)
    ? `the ${API_LABEL[info.provider]} (the user's API key)`
    : {
        claude: "Claude Code (the user's Claude subscription)",
        codex: "the Codex CLI (the user's ChatGPT subscription)",
        gemini: "Google Antigravity (the user's Gemini subscription)",
        muse: "Meta's Muse Code CLI (the user's Meta account)",
      }[info.provider];
  const exact = info.id
    ? `The exact model ID is "${info.id}".`
    : info.provider === "claude" || info.provider === "gemini" || info.provider === "muse"
      ? "The CLI resolves the exact model ID when the request starts; the app shows it under your reply."
      : "The exact model ID isn't published for this provider.";
  return `\n\n# Model\nYou are running as ${info.name} through ${via}. ${exact} Fast mode is ${info.fast ? "ON" : "off"}.${info.effort ? ` Reasoning effort: ${info.effort}.` : ""} When asked which model you are, state exactly this rather than guessing.`;
}
