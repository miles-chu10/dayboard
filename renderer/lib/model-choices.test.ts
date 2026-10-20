import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, CodexModelInfo } from "@main/shared-types";

import { claudeModelName } from "../../shared/claude-model-name";
import {
  applyModelChoice,
  assistantEffortPart,
  codexModel,
  lastReplyLabel,
  modelChoices,
  modelSummary,
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
  // Claude Code's default resolves at run time, so neither effort carries over to it.
  const claudeDefault = choose(
    settings({ claudeEffort: "high", assistantEffort: { claude: "max" } }),
    "claude",
    "default",
  );
  assert.equal(claudeDefault.claudeEffort, "default");
  assert.deepEqual(claudeDefault.assistantEffort, {});

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
  // Before the catalog loads, nothing shows the levels are unsupported, so they stay.
  const loading = choose(
    settings({
      codexModel: "gpt-6-astra",
      codexEffort: "ultra",
      codexServiceTier: "priority",
      assistantEffort: { codex: "ultra" },
    }),
    "codex",
    "",
  );
  assert.equal(loading.codexModel, "");
  assert.equal(loading.codexEffort, "ultra");
  assert.equal(loading.codexServiceTier, "priority");
  assert.deepEqual(loading.assistantEffort, { codex: "ultra" });
  const apiLoading = choose(
    settings({
      apiModels: { ...settings().apiModels, openai: "gpt-6-astra" },
      apiEffort: { openai: "max" },
      assistantEffort: { openai: "high" },
    }),
    "openai",
    "",
  );
  assert.equal(apiLoading.apiModels.openai, "");
  assert.deepEqual(apiLoading.apiEffort, { openai: "max" });
  assert.deepEqual(apiLoading.assistantEffort, { openai: "high" });

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

test("exact Claude IDs read as family and version; any other shape has no name", () => {
  assert.equal(claudeModelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(claudeModelName("claude-opus-5-5[1m]"), "Opus 5.5 (1M context)");
  assert.equal(claudeModelName("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
  assert.equal(claudeModelName("claude-opus-4-20250514"), "Opus 4");
  assert.equal(claudeModelName("claude-3-5-haiku-20241022"), "Haiku 3.5");
  assert.equal(claudeModelName("claude-fable-5-1"), "Fable 5.1");
  for (const id of ["opus", "default", "claude-opus", "claude-opus-5-5-preview", "gateway-model"])
    assert.equal(claudeModelName(id), null, id);
});

test("Claude Code's default is named after the model a reply reported, and only then", () => {
  const label = (ai: AppSettings["ai"], claude?: Record<string, string>) =>
    modelChoices("claude", ai, { claude }).find((choice) => choice.value === ai.claudeModel)?.label;
  const byDefault = settings({ claudeModel: "default" });

  // Configured default with a report: the exact model, still marked as Claude Code's default.
  assert.deepEqual(
    modelChoices("claude", byDefault, { claude: { default: "claude-opus-5-5[1m]" } })[0],
    {
      value: "default",
      label: "Opus 5.5 (1M context)",
      sublabel: "Claude Code's default, as of its last reply",
    },
  );
  // It is still the default: the saved value stays "default" and no effort level appears.
  const reported = { claude: { default: "claude-opus-5-5" } };
  assert.deepEqual(savedModelEffort(byDefault, "claude", reported).levels, []);
  const chosen = settings({ claudeModel: "opus", claudeEffort: "max" });
  applyModelChoice(chosen, "claude", "default", reported);
  assert.equal(chosen.claudeModel, "default");
  assert.equal(chosen.claudeEffort, "default");

  // Explicit override: an alias is named only after what a reply reported for that alias.
  const opus = settings({ claudeModel: "opus" });
  assert.equal(label(opus, { default: "claude-sonnet-4-5" }), "Opus");
  assert.deepEqual(
    modelChoices("claude", opus, { claude: { opus: "claude-opus-5-5" } }).find(
      (choice) => choice.value === "opus",
    ),
    { value: "opus", label: "Opus 5.5", sublabel: "The Opus alias, as of its last reply" },
  );
  // An alias whose report can't be read keeps its own name rather than the raw ID.
  assert.equal(label(opus, { opus: "gateway-model-7" }), "Opus");

  // Unavailable metadata: no report for the default keeps its generic name.
  const unreported: (Record<string, string> | undefined)[] = [
    undefined,
    {},
    { opus: "claude-opus-5-5" },
  ];
  for (const claude of unreported) assert.equal(label(byDefault, claude), "Claude Code default");
  // An ID of another shape is shown exactly as reported rather than renamed.
  assert.equal(label(byDefault, { default: "gateway-model-7" }), "gateway-model-7");
});

test("the next request names its model with the composer's effort, apart from the last reply", () => {
  const next = (
    ai: AppSettings["ai"],
    provider: Parameters<typeof assistantEffortPart>[1],
    modelId: string,
    claude?: Record<string, string>,
    fast = false,
  ) =>
    modelSummary({
      label: modelId,
      fast,
      effort: assistantEffortPart(ai, provider, modelId, codex, claude),
    });
  // Explicit override: the level the composer saved for this route.
  const max = settings({ claudeEffort: "low", assistantEffort: { claude: "max" } });
  assert.equal(next(max, "claude", "opus"), "opus Max");
  assert.equal(next(max, "claude", "opus", undefined, true), "opus Max · Fast");
  // Configured default: no Assistant level leaves the effort to Claude Code's own setting.
  assert.equal(
    next(settings({ claudeEffort: "max" }), "claude", "opus"),
    "opus · Claude Code's effort",
  );
  // Claude Code's default names nothing extra until a reply reports its model.
  assert.equal(next(max, "claude", "default"), "default");
  assert.equal(
    next(max, "claude", "default", { default: "claude-opus-5-5" }),
    "default · Claude Code's effort",
  );
  // Codex: the catalog default it sends, or a saved level the model lists.
  assert.equal(next(settings(), "codex", "gpt-6-astra"), "gpt-6-astra Medium");
  const ultra = settings({ assistantEffort: { codex: "ultra" } });
  assert.equal(next(ultra, "codex", "gpt-6-astra"), "gpt-6-astra Ultra");
  assert.equal(next(ultra, "codex", "gpt-6-luna"), "gpt-6-luna Medium");
  assert.equal(next(ultra, "codex", "gone"), "gone");
  // API routes: the saved level, else the model's own default; no effort concept adds nothing.
  assert.equal(
    next(settings({ assistantEffort: { openai: "high" } }), "openai", "gpt-6-astra"),
    "gpt-6-astra High",
  );
  assert.equal(next(settings(), "openai", "gpt-6-astra"), "gpt-6-astra · Default effort");
  assert.equal(next(settings(), "gemini", "gemini-3-pro"), "gemini-3-pro");

  // The last reply's evidence is what that reply recorded, never the next request's setting.
  const reply = (modelLabel?: string) => ({ role: "assistant", modelLabel });
  const user = { role: "user" };
  assert.equal(lastReplyLabel([]), null);
  assert.equal(lastReplyLabel([user]), null);
  assert.equal(
    lastReplyLabel([reply("Claude Opus 5.5 · Max effort requested"), user]),
    "Claude Opus 5.5 · Max effort requested",
  );
  // A newer reply that recorded nothing (it failed first) hides the older evidence.
  assert.equal(
    lastReplyLabel([reply("Claude Opus 5.5 · Max effort requested"), user, reply()]),
    null,
  );
});
