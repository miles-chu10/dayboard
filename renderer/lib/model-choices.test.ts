import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, CodexModelInfo } from "@main/shared-types";

import {
  applyModelChoice,
  codexModel,
  modelChoices,
  savedModelEffort,
  type ModelLists,
} from "./model-choices";

const lightToMax = ["low", "medium", "high", "xhigh", "max"];

function catalogModel(
  slug: string,
  efforts: string[],
  tiers: string[] = [],
  description = "",
): CodexModelInfo {
  return {
    slug,
    name: slug.toUpperCase(),
    description,
    defaultEffort: "medium",
    efforts: efforts.map((effort) => ({ effort, description: "" })),
    tiers: tiers.map((id) => ({ id, name: "Fast", description: "" })),
    contextWindow: null,
  };
}

const codex = [
  catalogModel("gpt-6-astra", [...lightToMax, "ultra"], ["priority"], "Frontier model"),
  catalogModel("gpt-6-luna", lightToMax),
];

function settings(overrides: Partial<AppSettings["ai"]> = {}): AppSettings["ai"] {
  return {
    enabled: true,
    providerChosen: true,
    provider: "claude",
    claudeModel: "opus",
    claudeEffort: "default",
    claudeFast: false,
    codexModel: "",
    codexEffort: "",
    codexServiceTier: "",
    geminiModel: "",
    museModel: "",
    apiModels: {
      openai: "",
      anthropic: "",
      google: "",
      xai: "",
      mistral: "",
      deepseek: "",
      groq: "",
      openrouter: "",
    },
    apiEffort: {},
    assistantProvider: "",
    assistantEffort: {},
    useMcpInAssistant: true,
    assistantPermission: "ask",
    features: {} as AppSettings["ai"]["features"],
    ...overrides,
  };
}

const values = (provider: Parameters<typeof modelChoices>[0], ai = settings(), lists = {}) =>
  modelChoices(provider, ai, lists).map((choice) => choice.value);

test("each provider lists its default first, then its models, then a saved unlisted model", () => {
  assert.deepEqual(values("codex", settings(), { codex }), ["", "gpt-6-astra", "gpt-6-luna"]);
  const [codexDefault, astra] = modelChoices("codex", settings(), { codex });
  assert.deepEqual(codexDefault, {
    value: "",
    label: "Codex default",
    sublabel: "Codex's first model, GPT-6-ASTRA",
  });
  assert.equal(astra.sublabel, "Frontier model");
  assert.deepEqual(values("codex", settings({ codexModel: "retired" }), { codex }), [
    "",
    "gpt-6-astra",
    "gpt-6-luna",
    "retired",
  ]);
  assert.deepEqual(values("gemini", settings(), { gemini: ["gemini-3-pro"] }), [
    "",
    "gemini-3-pro",
  ]);
  assert.equal(modelChoices("gemini", settings(), {})[0].label, "Antigravity default");
  assert.equal(modelChoices("muse", settings(), {})[0].label, "Muse Code default");
  assert.deepEqual(values("claude"), [
    "default",
    "fable",
    "opus",
    "sonnet",
    "haiku",
    "opus[1m]",
    "sonnet[1m]",
  ]);
  const api = [
    { id: "gpt-6-astra", name: "gpt-6-astra", contextWindow: null },
    { id: "gpt-6-sol", name: "gpt-6-sol", contextWindow: null },
  ];
  const openai = modelChoices("openai", settings(), { api });
  assert.deepEqual(
    openai.map((choice) => choice.value),
    ["", "gpt-6-astra", "gpt-6-sol"],
  );
  assert.deepEqual(openai[0], {
    value: "",
    label: "Newest available",
    sublabel: "Currently gpt-6-astra",
  });
  assert.equal(openai[1].sublabel, undefined);
});

test("Codex default is its first listed model for effort, speed and the saved model's levels", () => {
  assert.equal(codexModel(settings(), codex)?.slug, "gpt-6-astra");
  assert.equal(codexModel(settings({ codexModel: "gpt-6-luna" }), codex)?.slug, "gpt-6-luna");
  assert.equal(codexModel(settings({ codexModel: "retired" }), codex), undefined);
  assert.deepEqual(savedModelEffort(settings(), "codex", { codex }).levels, [
    ...lightToMax,
    "ultra",
  ]);
  const api = { api: [{ id: "gpt-6.1-sol", name: "gpt-6.1-sol", contextWindow: null }] };
  assert.deepEqual(savedModelEffort(settings(), "openai", api).levels, lightToMax);
  assert.deepEqual(savedModelEffort(settings(), "gemini", {}).levels, []);
});

test("changing the model keeps each effort and Fast only where the new model has them", () => {
  const choose = (
    ai: AppSettings["ai"],
    provider: Parameters<typeof applyModelChoice>[1],
    value: string,
    lists: ModelLists = {},
  ) => {
    applyModelChoice(ai, provider, value, lists);
    return ai;
  };
  const claude = choose(
    settings({ claudeFast: true, claudeEffort: "max", assistantEffort: { claude: "high" } }),
    "claude",
    "haiku",
  );
  assert.equal(claude.claudeModel, "haiku");
  assert.equal(claude.claudeFast, false);
  assert.equal(claude.claudeEffort, "default");
  assert.deepEqual(claude.assistantEffort, {});
  const sonnet = choose(
    settings({ claudeEffort: "xhigh", assistantEffort: { claude: "max" } }),
    "claude",
    "sonnet",
  );
  assert.equal(sonnet.claudeEffort, "xhigh");
  assert.deepEqual(sonnet.assistantEffort, { claude: "max" });

  const luna = choose(
    settings({
      codexModel: "gpt-6-astra",
      codexEffort: "ultra",
      codexServiceTier: "priority",
      assistantEffort: { codex: "high", claude: "max" },
    }),
    "codex",
    "gpt-6-luna",
    { codex },
  );
  assert.equal(luna.codexEffort, "");
  assert.equal(luna.codexServiceTier, "");
  assert.deepEqual(luna.assistantEffort, { codex: "high", claude: "max" });
  // Codex default keeps what its first listed model offers.
  const backToDefault = choose(
    settings({
      codexModel: "gpt-6-luna",
      codexEffort: "high",
      codexServiceTier: "priority",
      assistantEffort: { codex: "ultra" },
    }),
    "codex",
    "",
    { codex },
  );
  assert.equal(backToDefault.codexEffort, "high");
  assert.equal(backToDefault.codexServiceTier, "priority");
  assert.deepEqual(backToDefault.assistantEffort, { codex: "ultra" });

  const api = { api: [{ id: "gpt-6-astra", name: "gpt-6-astra", contextWindow: null }] };
  const sol = choose(
    settings({ apiEffort: { openai: "max" }, assistantEffort: { openai: "high" } }),
    "openai",
    "gpt-6-sol",
    api,
  );
  assert.equal(sol.apiModels.openai, "gpt-6-sol");
  assert.deepEqual(sol.apiEffort, {});
  assert.deepEqual(sol.assistantEffort, {});
  const newest = choose(
    settings({ apiModels: { ...settings().apiModels, openai: "gpt-6-sol" }, apiEffort: {} }),
    "openai",
    "",
    api,
  );
  assert.equal(newest.apiModels.openai, "");
  const kept = choose(settings({ apiEffort: { openai: "max" } }), "openai", "gpt-6.1-sol", api);
  assert.deepEqual(kept.apiEffort, { openai: "max" });
});
