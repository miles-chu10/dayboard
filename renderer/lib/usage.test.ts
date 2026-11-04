import assert from "node:assert/strict";
import test from "node:test";

import type { UsageDay } from "@main/shared-types";

import { compactNumber, usageBars, usageByModel } from "./usage";

const days: UsageDay[] = [
  {
    date: "2026-10-01",
    models: { old: { runs: 9, inputTokens: 9, outputTokens: 9 } },
  },
  {
    date: "2026-11-02",
    models: {
      sonnet: { runs: 2, inputTokens: 1000, outputTokens: 200 },
      gpt: { runs: 1, inputTokens: 300, outputTokens: 50 },
    },
  },
  {
    date: "2026-11-04",
    models: { sonnet: { runs: 3, inputTokens: 1500, outputTokens: 300 } },
  },
];

test("usage bars cover every day in the span, oldest first, with quiet days at zero", () => {
  assert.deepEqual(usageBars(days, "2026-11-04", 4), [
    { date: "2026-11-01", runs: 0, tokens: 0 },
    { date: "2026-11-02", runs: 3, tokens: 1550 },
    { date: "2026-11-03", runs: 0, tokens: 0 },
    { date: "2026-11-04", runs: 3, tokens: 1800 },
  ]);
  // A span across a month boundary still lands on real dates.
  assert.equal(usageBars(days, "2026-11-01", 2)[0].date, "2026-10-31");
});

test("usage by model totals the span only, most runs first", () => {
  assert.deepEqual(usageByModel(days, "2026-11-04", 30), [
    { model: "sonnet", runs: 5, inputTokens: 2500, outputTokens: 500 },
    { model: "gpt", runs: 1, inputTokens: 300, outputTokens: 50 },
  ]);
  assert.deepEqual(usageByModel(days, "2026-11-04", 1), [
    { model: "sonnet", runs: 3, inputTokens: 1500, outputTokens: 300 },
  ]);
});

test("token counts read compactly", () => {
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1234), "1.2K");
  assert.equal(compactNumber(48_000), "48K");
  assert.equal(compactNumber(3_400_000), "3.4M");
});
