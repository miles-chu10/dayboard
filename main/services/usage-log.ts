// AI usage DayBoard recorded: requests and tokens per local day and model, kept for 90 days.
// Provider plan limits are out of reach (no provider exposes them to DayBoard), so none are shown.

import type { RequestUsage } from "../../shared/ai-usage.js";
import type { UsageCount, UsageDay } from "../shared-types.js";

export const USAGE_DAYS = 90;

export function localDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isCount(value: unknown): value is UsageCount {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return ["runs", "inputTokens", "outputTokens"].every((key) => count(entry[key]) === entry[key]);
}

export function parseUsage(value: unknown, now: number): UsageDay[] {
  const days = (value as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return [];
  const valid = days.flatMap((day): UsageDay[] => {
    if (typeof day !== "object" || day === null) return [];
    const { date, models } = day as { date?: unknown; models?: unknown };
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    if (typeof models !== "object" || models === null) return [];
    return [
      {
        date,
        models: Object.fromEntries(Object.entries(models).filter(([, entry]) => isCount(entry))),
      },
    ];
  });
  return pruneUsage(valid, now);
}

export function pruneUsage(days: UsageDay[], now: number): UsageDay[] {
  const oldest = localDate(now - (USAGE_DAYS - 1) * 86_400_000);
  return days.filter((day) => day.date >= oldest).sort((a, b) => a.date.localeCompare(b.date));
}

/** The model a request ran as, else the one asked for, else its route ("claude-cli", …). */
export function usageModel(usage: RequestUsage): string {
  return (usage.modelId || usage.requestedModelId || usage.route || "unknown").slice(0, 80);
}

export function addUsage(days: UsageDay[], usage: RequestUsage, now: number): UsageDay[] {
  const date = localDate(now);
  const model = usageModel(usage);
  const today = days.find((day) => day.date === date) ?? { date, models: {} };
  const before = today.models[model] ?? {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const updated: UsageDay = {
    date,
    models: {
      ...today.models,
      [model]: {
        runs: before.runs + 1,
        inputTokens: before.inputTokens + count(usage.inputTokens),
        outputTokens: before.outputTokens + count(usage.outputTokens),
      },
    },
  };
  return pruneUsage([...days.filter((day) => day.date !== date), updated], now);
}
