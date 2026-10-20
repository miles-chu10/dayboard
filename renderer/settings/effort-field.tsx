import { Field } from "@glaze/core/components";
import type { AIProvider } from "@main/shared-types";

import {
  effortLabel,
  noEffortNote,
  supportedEffort,
  type EffortOptions,
} from "../../shared/ai-effort";
import { SettingSelect } from "./setting-select";

const LEVEL_HINT: Record<string, string> = {
  low: "Fast responses with lighter thinking",
  medium: "Balances speed and depth",
  high: "Deeper thinking for complex requests",
  xhigh: "Even more thinking",
  max: "Maximum thinking for the hardest problems",
};

/**
 * "Effort for AI features": the levels, names and no-effort message the Assistant's effort panel
 * shows for the same model. "" is the model default.
 */
export function EffortField({
  provider,
  options,
  value,
  onChange,
  label,
  descriptions,
}: {
  provider: AIProvider;
  options: EffortOptions;
  value: string;
  onChange: (level: string) => void;
  label: string;
  /** Per-level descriptions from the provider (Codex's catalog). */
  descriptions?: Record<string, string>;
}) {
  const available = options.levels.length > 0;
  return (
    <Field
      label="Effort for AI features"
      description={
        available
          ? "Used by briefings, triage and other one-click features. Set the Assistant's effort in its composer."
          : noEffortNote(options)
      }
      disabled={!available}
    >
      <SettingSelect
        label={label}
        value={supportedEffort(options, value)}
        disabled={!available}
        options={[
          {
            value: "",
            label: options.defaultLevel
              ? `Default (${effortLabel(options.defaultLevel)})`
              : "Default",
            sublabel:
              provider === "claude" ? "Use Claude Code's setting" : "Use the model's default",
          },
          ...options.levels.map((level) => ({
            value: level,
            label: effortLabel(level),
            sublabel: descriptions?.[level] || LEVEL_HINT[level],
          })),
        ]}
        onChange={onChange}
      />
    </Field>
  );
}
