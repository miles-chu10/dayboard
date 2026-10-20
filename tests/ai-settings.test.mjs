import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

async function loadModule(file) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "offline-cli",
        setup(api) {
          api.onResolve({ filter: /(?:shell-env|cli-binaries)\.js$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          api.onResolve({ filter: /^@glaze\/core\/backend$/ }, (args) => ({
            path: args.path,
            namespace: "glaze-backend",
          }));
          api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const getToolEnv = async () => ({}); export const resolveCli = async () => null;",
            loader: "js",
          }));
          api.onLoad({ filter: /.*/, namespace: "glaze-backend" }, () => ({
            contents:
              'export const app = { getPath: () => "/nonexistent" }; export const safeStorage = {}; export const logger = { info() {}, warn() {}, error() {} };',
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { parseCodexCatalog } = await loadModule("../main/services/ai/codex-models.ts");
const { codexModelArgs, claudeModelArgs } = await loadModule(
  "../main/services/ai/model-options.ts",
);
const models = [
  {
    slug: "fixture-model",
    name: "Fixture",
    description: "",
    defaultEffort: "medium",
    efforts: [
      { effort: "medium", description: "" },
      { effort: "high", description: "" },
    ],
    tiers: [{ id: "priority", name: "Fast", description: "" }],
  },
];
const ai = {
  codexModel: "fixture-model",
  codexEffort: "",
  codexServiceTier: "",
  claudeModel: "opus",
  claudeEffort: "default",
  claudeFast: false,
};

test("Model picker preserves the live catalog's per-model capabilities and excludes hidden models", () => {
  const result = parseCodexCatalog(
    JSON.stringify({
      models: [
        { slug: "hidden", visibility: "hide", priority: 0 },
        { slug: "second", visibility: "list", priority: 2, service_tiers: [] },
        {
          slug: "first",
          display_name: "First",
          visibility: "list",
          priority: 1,
          default_reasoning_level: "high",
          supported_reasoning_levels: [{ effort: "high", description: "More thought" }],
          service_tiers: [{ id: "priority", name: "Fast", description: "More usage" }],
        },
      ],
    }),
  );
  assert.deepEqual(
    result.map((item) => item.slug),
    ["first", "second"],
  );
  assert.equal(result[0].defaultEffort, "high");
  assert.equal(result[0].efforts[0].effort, "high");
  assert.equal(result[0].tiers[0].id, "priority");
  assert.deepEqual(result[1].tiers, []);
});

test("Explicit model uses its default effort; Fast passes the catalog's tier ID", () => {
  const standard = codexModelArgs(ai, models);
  assert.deepEqual(standard, ["-m", "fixture-model", "-c", 'model_reasoning_effort="medium"']);
  const fast = codexModelArgs({ ...ai, codexEffort: "high", codexServiceTier: "priority" }, models);
  assert.ok(fast.includes('model_reasoning_effort="high"'));
  assert.ok(fast.includes('service_tier="priority"'));
});

test("Unsupported model, reasoning and speed fail before launching a paid request", () => {
  assert.throws(() => codexModelArgs({ ...ai, codexModel: "removed" }, models), /no longer listed/);
  assert.throws(() => codexModelArgs({ ...ai, codexEffort: "ultra" }, models), /reasoning effort/);
  assert.throws(
    () => codexModelArgs({ ...ai, codexServiceTier: "other" }, models),
    /selected speed/,
  );
});

test("Codex default does not carry options from a previously selected model", () => {
  assert.deepEqual(
    codexModelArgs(
      { ...ai, codexModel: "", codexEffort: "ultra", codexServiceTier: "priority" },
      models,
    ),
    [],
  );
});

test("Claude Fast off explicitly overrides the CLI and cannot switch another model to Opus", () => {
  assert.ok(claudeModelArgs(ai).includes('{"fastMode":false}'));
  assert.ok(claudeModelArgs({ ...ai, claudeFast: true }).includes('{"fastMode":true}'));
  const haiku = claudeModelArgs({
    ...ai,
    claudeModel: "haiku",
    claudeEffort: "high",
    claudeFast: true,
  });
  assert.ok(haiku.includes('{"fastMode":false}'));
  assert.equal(haiku.includes("--effort"), false);
  // Claude Code's default resolves at run time, so the saved feature effort isn't sent to it.
  const claudeDefault = claudeModelArgs({ ...ai, claudeModel: "default", claudeEffort: "high" });
  assert.equal(claudeDefault.includes("--effort"), false);
  assert.equal(claudeDefault.includes("--model"), false);
  assert.deepEqual(
    claudeModelArgs({ ...ai, claudeModel: "sonnet", claudeEffort: "high" }).slice(0, 4),
    ["--model", "sonnet", "--effort", "high"],
  );
});

const { normalizeSettings } = await loadModule("../main/services/settings-store.ts");

test("Assistant effort keeps valid levels for known providers and drops everything else", () => {
  const settings = normalizeSettings({
    ai: {
      provider: "claude",
      assistantEffort: {
        claude: "high",
        codex: "ultra",
        openai: "",
        anthropic: "Bad Level",
        nobody: "high",
        google: 3,
      },
    },
  });
  assert.deepEqual(settings.ai.assistantEffort, { claude: "high", codex: "ultra" });
  assert.deepEqual(normalizeSettings({}).ai.assistantEffort, {});
  assert.deepEqual(normalizeSettings({ ai: { assistantEffort: "high" } }).ai.assistantEffort, {});
  // Normalizing a saved value again changes nothing.
  assert.deepEqual(normalizeSettings(settings).ai.assistantEffort, {
    claude: "high",
    codex: "ultra",
  });
});

test("API feature effort keeps a level per API provider and drops anything else", () => {
  const { apiEffort } = normalizeSettings({
    ai: { apiEffort: { openai: "high", anthropic: "max", claude: "low", xai: "Bad Level" } },
  }).ai;
  assert.deepEqual(apiEffort, { openai: "high", anthropic: "max" });
  assert.deepEqual(normalizeSettings({}).ai.apiEffort, {});
});

test("settings saved before the composer keep the Assistant's effort, once", () => {
  const upgraded = normalizeSettings({ ai: { claudeEffort: "max", codexEffort: "high" } });
  assert.deepEqual(upgraded.ai.assistantEffort, { claude: "max", codex: "high" });
  assert.equal(upgraded.ai.claudeEffort, "max");
  assert.deepEqual(
    normalizeSettings({ ai: { claudeEffort: "default", codexEffort: "" } }).ai.assistantEffort,
    {},
  );
  // Once saved, the Assistant's own record wins, including a reset to the model default.
  assert.deepEqual(
    normalizeSettings({ ai: { claudeEffort: "max", codexEffort: "high", assistantEffort: {} } }).ai
      .assistantEffort,
    {},
  );
});
