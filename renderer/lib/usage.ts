import type { UsageCount, UsageDay } from "@main/shared-types";

import { addDays } from "./dates";

export interface UsageBar {
  date: string;
  runs: number;
  tokens: number;
}

function total(models: Record<string, UsageCount>): UsageCount {
  const sum = { runs: 0, inputTokens: 0, outputTokens: 0 };
  for (const count of Object.values(models)) {
    sum.runs += count.runs;
    sum.inputTokens += count.inputTokens;
    sum.outputTokens += count.outputTokens;
  }
  return sum;
}

/** One bar per local day ending `today` (YYYY-MM-DD), oldest first; days with no requests are 0. */
export function usageBars(days: UsageDay[], today: string, span: number): UsageBar[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return Array.from({ length: span }, (_, index) => {
    const date = addDays(today, index - span + 1);
    const sum = total(byDate.get(date)?.models ?? {});
    return { date, runs: sum.runs, tokens: sum.inputTokens + sum.outputTokens };
  });
}

/** Totals per model over the `span` days ending `today`, most runs first. */
export function usageByModel(
  days: UsageDay[],
  today: string,
  span: number,
): (UsageCount & { model: string })[] {
  const oldest = addDays(today, -span + 1);
  const models = new Map<string, UsageCount>();
  for (const day of days) {
    if (day.date < oldest || day.date > today) continue;
    for (const [model, count] of Object.entries(day.models)) {
      const sum = models.get(model) ?? {
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      models.set(model, {
        runs: sum.runs + count.runs,
        inputTokens: sum.inputTokens + count.inputTokens,
        outputTokens: sum.outputTokens + count.outputTokens,
      });
    }
  }
  return [...models]
    .map(([model, count]) => ({ model, ...count }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
}

/** 950 → "950", 1234 → "1.2K", 48000 → "48K", 3400000 → "3.4M". */
export function compactNumber(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
