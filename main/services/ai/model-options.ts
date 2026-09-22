import type {
  AIProvider,
  ApiModelInfo,
  AppSettings,
  AssistantModelInfo,
  CodexModelInfo,
} from "../../shared-types.js";

export function claudeModelArgs(ai: AppSettings["ai"]): string[] {
  const args: string[] = [];
  if (ai.claudeModel !== "default") args.push("--model", ai.claudeModel);
  if (ai.claudeEffort !== "default" && ai.claudeModel !== "haiku") {
    args.push("--effort", ai.claudeEffort);
  }
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

// Exact IDs Claude Code resolved each alias to on earlier runs (from its init event).
const claudeResolved = new Map<string, string>();

export function rememberClaudeModel(alias: string, id: string): void {
  claudeResolved.set(alias, id);
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
  if (provider === "openai" || provider === "anthropic" || provider === "google") {
    const label = { openai: "OpenAI API", anthropic: "Anthropic API", google: "Gemini API" }[
      provider
    ];
    return {
      provider,
      name: apiModel ? `${apiModel.name} (${label})` : label,
      id: apiModel?.id ?? null,
      fast: false,
      effort: null,
      contextWindow: apiModel?.contextWindow ?? null,
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
    return {
      provider: "claude",
      name: CLAUDE_NAMES[ai.claudeModel] ?? ai.claudeModel,
      id: claudeResolved.get(ai.claudeModel) ?? null,
      fast: claudeFastOn(ai),
      effort: ai.claudeEffort === "default" ? null : ai.claudeEffort,
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
  return {
    provider: "glaze",
    name: "Glaze AI (fast)",
    id: null,
    fast: false,
    effort: null,
    contextWindow: null,
  };
}

/** Appended to every Assistant system prompt so the model can state what it is. */
export function modelSystemNote(info: AssistantModelInfo): string {
  const via = {
    claude: "Claude Code (the user's Claude subscription)",
    codex: "the Codex CLI (the user's ChatGPT subscription)",
    gemini: "Google Antigravity (the user's Gemini subscription)",
    openai: "the OpenAI API (the user's API key)",
    anthropic: "the Anthropic API (the user's API key)",
    google: "the Gemini API (the user's API key)",
    glaze: "Glaze AI",
  }[info.provider];
  const exact = info.id
    ? `The exact model ID is "${info.id}".`
    : info.provider === "claude" || info.provider === "gemini"
      ? "The CLI resolves the exact model ID when the request starts; the app shows it under your reply."
      : "The exact model ID isn't published for this provider.";
  return `\n\n# Model\nYou are running as ${info.name} through ${via}. ${exact} Fast mode is ${info.fast ? "ON" : "off"}.${info.effort ? ` Reasoning effort: ${info.effort}.` : ""} When asked which model you are, state exactly this rather than guessing.`;
}
