import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function loadModule(file) {
  const result = await build({
    entryPoints: [new URL(file, import.meta.url).pathname],
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
          api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const getToolEnv = async () => ({}); export const resolveCli = async () => null;",
            loader: "js",
          }));
          api.onResolve({ filter: /platform\/index\.js$/ }, (args) => ({
            path: args.path,
            namespace: "platform-fixture",
          }));
          api.onLoad({ filter: /.*/, namespace: "platform-fixture" }, () => ({
            contents:
              'export const app = { getPath: () => "/tmp" }; export const safeStorage = { encryptString: async (s) => Buffer.from(s), decryptString: async (b) => b.toString("utf8") };',
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
const { normalizeSettings } = await loadModule("../main/services/settings-store.ts");

async function loadProviderResolution() {
  const result = await build({
    entryPoints: [new URL("../main/services/ai/provider-resolution.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "offline-provider-fixture",
        setup(api) {
          api.onResolve({ filter: /(?:api-keys|cli-binaries)\.js$/ }, (args) => ({
            path: args.path,
            namespace: "provider-fixture",
          }));
          api.onLoad({ filter: /api-keys\.js$/, namespace: "provider-fixture" }, () => ({
            contents: `export const isApiProvider = (value) => ["openai", "anthropic"].includes(value);
              export const getApiKey = async (provider) => provider === "anthropic" ? "fixture-key" : null;`,
            loader: "js",
          }));
          api.onLoad({ filter: /cli-binaries\.js$/, namespace: "provider-fixture" }, () => ({
            contents:
              'export const resolveCli = async (provider) => provider === "codex" ? "/fixture/codex" : null;',
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
const { resolveConfiguredProvider } = await loadProviderResolution();
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
});

test("legacy Glaze choice stays disabled until a standalone provider is chosen", () => {
  const migrated = normalizeSettings({
    ai: { enabled: true, provider: "glaze", assistantProvider: "glaze" },
  });
  assert.equal(migrated.ai.enabled, false);
  assert.equal(migrated.ai.providerChosen, false);
  assert.equal(migrated.ai.assistantProvider, "");
  assert.notEqual(migrated.ai.provider, "glaze");
});

test("existing supported provider and assistant override survive migration", () => {
  const migrated = normalizeSettings({
    ai: { enabled: true, provider: "codex", assistantProvider: "anthropic" },
  });
  assert.equal(migrated.ai.enabled, true);
  assert.equal(migrated.ai.providerChosen, true);
  assert.equal(migrated.ai.provider, "codex");
  assert.equal(migrated.ai.assistantProvider, "anthropic");
});

test("new settings require an explicit provider selection", () => {
  const initial = normalizeSettings({});
  assert.equal(initial.ai.enabled, false);
  assert.equal(initial.ai.providerChosen, false);
});

test("unavailable chosen providers never fall back to another configured provider", async () => {
  assert.equal(await resolveConfiguredProvider("claude"), null);
  assert.equal(await resolveConfiguredProvider("openai"), null);
  assert.equal(await resolveConfiguredProvider("glaze"), null);
});

test("supported chosen providers resolve only to themselves", async () => {
  assert.equal(await resolveConfiguredProvider("codex"), "codex");
  assert.equal(await resolveConfiguredProvider("anthropic"), "anthropic");
});
