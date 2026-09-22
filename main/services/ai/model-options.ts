import type { AppSettings, CodexModelInfo } from "../../shared-types.js";

export function claudeModelArgs(ai: AppSettings["ai"]): string[] {
  const args: string[] = [];
  if (ai.claudeModel !== "default") args.push("--model", ai.claudeModel);
  if (ai.claudeEffort !== "default" && ai.claudeModel !== "haiku") {
    args.push("--effort", ai.claudeEffort);
  }
  // An explicit false prevents the user's CLI preference from enabling paid Fast mode.
  const fastMode = ai.claudeFast && ["opus", "opus[1m]"].includes(ai.claudeModel);
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
