import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import test, { after } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(tmpdir(), "dayboard-effort-fixtures-"));
after(() => rm(temporary, { recursive: true, force: true }));
const root = fileURLToPath(new URL("../", import.meta.url));

// Offline stand-ins keyed by import file name, as in prompt-cache.test.mjs. Nothing here reads
// real settings, keys, CLIs or MCP servers; provider fetches are intercepted per test.
const stubs = {
  "api-keys.js": `export const API_PROVIDERS=['openai','anthropic','google','xai']; export const isApiProvider=p=>API_PROVIDERS.includes(p); export const getApiKey=async()=>'synthetic-key';`,
  "settings-store.js": `export const getSettings=async()=>globalThis.__effortFixture.settings; export const getMcpServers=async()=>[];`,
  "demo-data.js": `export const isDemoMode=()=>false; export const demoAssistantReply=()=>'';`,
  "attachments.js": `export const attachmentContext=async()=>'';`,
  "codex-models.js": `export const listCodexModels=async()=>globalThis.__effortFixture.codexModels;`,
  "cli-providers.js": `export const runCliCompletion=async(options)=>{globalThis.__effortFixture.cli.push(options); return 'CLI answer';};`,
  "assistant-mcp.js": `export const resolveAssistantMcpServers=()=>[];`,
  "mcp-client.js": `export const openMcpSession=async()=>{throw Error('MCP must not run')};`,
  "provider-resolution.js": `export const resolveConfiguredProvider=async p=>p;`,
};

function fixtures() {
  return {
    name: "effort-fixtures",
    setup(api) {
      api.onResolve({ filter: /^@glaze\/core\/ai$/ }, () => ({ path: "ai", namespace: "fixture" }));
      api.onLoad({ filter: /^ai$/, namespace: "fixture" }, () => ({
        contents: `export {streamText,stepCountIs,tool} from 'ai'; export class GlazeAIError extends Error {}; export const glaze=()=>{throw Error('Glaze provider must not run')};`,
        loader: "js",
        resolveDir: root,
      }));
      api.onResolve({ filter: /(?:@glaze\/core\/backend|platform\/index\.js)$/ }, () => ({
        path: "backend",
        namespace: "fixture",
      }));
      api.onLoad({ filter: /^backend$/, namespace: "fixture" }, () => ({
        contents: `export const app={getPath:()=>'/nonexistent-fixture'}; export const logger={error:()=>{},warn:()=>{}};`,
        loader: "js",
      }));
      api.onResolve({ filter: /\.js$/ }, (args) => {
        const key = args.path.split("/").at(-1);
        return stubs[key] ? { path: key, namespace: "service-fixture" } : undefined;
      });
      api.onLoad({ filter: /.*/, namespace: "service-fixture" }, (args) => ({
        contents: stubs[args.path],
        loader: "js",
      }));
    },
  };
}

let sequence = 0;
async function load(file) {
  const result = await build({
    entryPoints: [root + file],
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: `import {createRequire} from "node:module"; const require=createRequire(import.meta.url);`,
    },
    write: false,
    logLevel: "silent",
    plugins: [fixtures()],
  });
  const output = path.join(temporary, `module-${sequence++}.mjs`);
  await writeFile(output, result.outputFiles[0].text);
  return import(output);
}

const effort = await load("shared/ai-effort.ts");
const main = await load("main/services/ai/assistant-effort.ts");
const modelOptions = await load("main/services/ai/model-options.ts");
const promptCache = await load("main/services/ai/prompt-cache.ts");
const assistant = await load("main/services/ai/assistant.ts");

const lightToMax = ["low", "medium", "high", "xhigh", "max"];
const levels = (...args) => effort.effortOptions(...args).levels;
const catalogModel = (slug, name, efforts, defaultEffort) => ({
  slug,
  name,
  description: "",
  defaultEffort,
  efforts: efforts.map((level) => ({ effort: level, description: "" })),
  tiers: slug === "gpt-6-astra" ? [{ id: "priority", name: "Fast", description: "" }] : [],
  contextWindow: null,
});
const codexCatalog = [
  catalogModel("gpt-6-astra", "GPT-6 Astra", [...lightToMax, "ultra"], "medium"),
  catalogModel("gpt-5.6-terra", "GPT-5.6 Terra", [...lightToMax, "ultra"], "medium"),
  catalogModel("gpt-6-luna", "GPT-6 Luna", lightToMax, "high"),
];

test("effort levels follow the route and model table, including dated snapshots", () => {
  for (const model of ["default", "fable", "opus", "sonnet", "opus[1m]", "sonnet[1m]"])
    assert.deepEqual(levels("claude", model), lightToMax, model);
  assert.deepEqual(levels("claude", "haiku"), []);
  // On the OpenAI API only GPT-6 Astra and GPT-6.1 Sol offer effort, Light to Max.
  for (const model of [
    "gpt-6-astra",
    "gpt-6-astra-2026-09-20",
    "gpt-6.1-sol",
    "gpt-6.1-sol-2026-10-01",
  ])
    assert.deepEqual(levels("openai", model), lightToMax, model);
  for (const model of [
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-sol-2026-09-20",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna-2026-07-01",
    "gpt-5.5",
    "gpt-5.6",
    "gpt-6-terra",
    "gpt-6-sol-audio",
    "openai/gpt-6-sol",
    "o4-mini",
  ])
    assert.deepEqual(levels("openai", model), [], model);
  for (const model of [
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-haiku-5-5",
    "claude-opus-5-5-20260915",
  ])
    assert.deepEqual(levels("anthropic", model), lightToMax, model);
  for (const model of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-6-20260217"])
    assert.deepEqual(levels("anthropic", model), ["low", "medium", "high", "max"], model);
  for (const model of [
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-fixture",
  ])
    assert.deepEqual(levels("anthropic", model), [], model);
  for (const provider of [
    "google",
    "xai",
    "mistral",
    "deepseek",
    "groq",
    "openrouter",
    "gemini",
    "muse",
    "glaze",
  ])
    assert.deepEqual(levels(provider, "gpt-6-sol"), [], provider);
  assert.deepEqual(effort.effortOptions("codex", "gpt-6-astra", codexCatalog), {
    levels: [...lightToMax, "ultra"],
    defaultLevel: "medium",
  });
  assert.deepEqual(effort.effortOptions("codex", "removed-model", codexCatalog), {
    levels: [],
    defaultLevel: null,
  });
  assert.deepEqual(effort.effortOptions("codex", "gpt-6-astra"), {
    levels: [],
    defaultLevel: null,
  });
  assert.equal(effort.effortOptions("openai", "gpt-6-astra").defaultLevel, null);
  assert.equal(effort.effortOptions("claude", "opus").defaultLevel, null);
  // A caller can't change the shared table.
  effort.effortOptions("claude", "opus").levels.push("bogus");
  assert.deepEqual(levels("claude", "opus"), lightToMax);
});

test("Ultra availability comes from the Codex catalog, with the known models as fallback", () => {
  assert.equal(
    effort.ultraNote(),
    "Ultra is available with Codex on GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Sol or Terra.",
  );
  assert.equal(effort.ultraNote([]), effort.ULTRA_FALLBACK_NOTE);
  assert.equal(
    effort.ultraNote(codexCatalog),
    "Ultra is available with Codex on GPT-6 Astra and GPT-5.6 Terra.",
  );
  assert.equal(
    effort.ultraNote([
      ...codexCatalog,
      catalogModel("gpt-daybreak-blue-latest", "GPT Daybreak Blue", ["high", "ultra"], "high"),
    ]),
    "Ultra is available with Codex on GPT-6 Astra, GPT-5.6 Terra, and GPT Daybreak Blue.",
  );
  assert.equal(levels("codex", "gpt-6-luna", codexCatalog).includes("ultra"), false);
  assert.equal(
    effort.ULTRA_WARNING,
    "Runs several agents at once and uses your limit much faster.",
  );
});

test("labels, the picker selection and /effort arguments", () => {
  assert.deepEqual(
    ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "turbo"].map(
      effort.effortLabel,
    ),
    ["None", "Minimal", "Light", "Medium", "High", "Extra High", "Max", "Ultra", "Turbo"],
  );
  for (const [text, level] of [
    ["high", "high"],
    ["High", "high"],
    ["extra high", "xhigh"],
    ["Extra-High", "xhigh"],
    ["xhigh", "xhigh"],
    ["light", "low"],
    ["LOW", "low"],
    [" ultra ", "ultra"],
    ["none", "none"],
    ["minimal", "minimal"],
    ["max", "max"],
    ["huge", null],
    ["", null],
    ["constructor", null],
  ])
    assert.equal(effort.parseEffortArgument(text), level, text);
  const claude = effort.effortOptions("claude", "opus");
  assert.deepEqual(effort.effortSelection(claude, "high"), { level: "high", explicit: true });
  assert.deepEqual(effort.effortSelection(claude, ""), { level: null, explicit: false });
  assert.deepEqual(effort.effortSelection(claude, undefined), { level: null, explicit: false });
  assert.deepEqual(effort.effortSelection(claude, "ultra"), { level: null, explicit: false });
  assert.equal(effort.selectionLabel(null), "Default");
  assert.equal(effort.selectionLabel("xhigh"), "Extra High");
  const astra = effort.effortOptions("codex", "gpt-6-astra", codexCatalog);
  assert.deepEqual(effort.effortSelection(astra, undefined), { level: "medium", explicit: false });
  assert.equal(effort.supportedEffort(astra, "ultra"), "ultra");
  assert.equal(effort.supportedEffort(claude, "ultra"), "");
  assert.deepEqual(effort.effortCommand(claude, "extra high", "note"), { level: "xhigh" });
  assert.deepEqual(effort.effortCommand(claude, "Ultra", "note"), { message: "note" });
  const supported = { message: "This model supports Light, Medium, High, Extra High, Max." };
  assert.deepEqual(effort.effortCommand(claude, "none", "note"), supported);
  assert.deepEqual(effort.effortCommand(claude, "loud", "note"), supported);
  assert.deepEqual(effort.effortCommand(effort.effortOptions("claude", "haiku"), "high", "note"), {
    message: "This model doesn't have effort settings.",
  });
});

function aiSettings(overrides = {}) {
  return {
    enabled: true,
    providerChosen: true,
    provider: "claude",
    assistantProvider: "",
    claudeModel: "opus",
    claudeEffort: "default",
    claudeFast: false,
    codexModel: "",
    codexEffort: "",
    codexServiceTier: "",
    geminiModel: "",
    museModel: "",
    apiModels: { openai: "", anthropic: "", google: "", xai: "" },
    assistantEffort: {},
    useMcpInAssistant: false,
    assistantPermission: "ask",
    ...overrides,
  };
}

test("the saved Assistant effort is checked against the model that will run", () => {
  const resolve = (overrides, provider, catalog = [], apiModel) =>
    main.resolveAssistantEffort(aiSettings(overrides), provider, catalog, apiModel);
  assert.equal(resolve({ assistantEffort: { claude: "max" } }, "claude"), "max");
  assert.equal(resolve({ claudeModel: "haiku", assistantEffort: { claude: "max" } }, "claude"), "");
  // Codex runs the first catalog model when none is chosen; Ultra passes only where it's listed.
  assert.equal(resolve({ assistantEffort: { codex: "ultra" } }, "codex", codexCatalog), "ultra");
  assert.equal(
    resolve(
      { codexModel: "gpt-6-luna", assistantEffort: { codex: "ultra" } },
      "codex",
      codexCatalog,
    ),
    "",
  );
  assert.equal(resolve({ assistantEffort: { codex: "high" } }, "codex", []), "");
  assert.equal(resolve({ assistantEffort: { openai: "max" } }, "openai", [], "gpt-6.1-sol"), "max");
  assert.equal(resolve({ assistantEffort: { openai: "none" } }, "openai", [], "gpt-6-astra"), "");
  assert.equal(resolve({ assistantEffort: { openai: "high" } }, "openai", [], "gpt-6-sol"), "");
  assert.equal(
    resolve({ assistantEffort: { anthropic: "xhigh" } }, "anthropic", [], "claude-opus-4-6"),
    "",
  );
  assert.equal(
    resolve({ assistantEffort: { anthropic: "xhigh" } }, "anthropic", [], "claude-opus-5-5"),
    "xhigh",
  );
  // The one-click features' effort never leaks into the Assistant.
  assert.equal(resolve({ claudeEffort: "max" }, "claude"), "");
  const { assistantEffort: _unset, ...older } = aiSettings({ assistantEffort: { claude: "max" } });
  assert.equal(main.resolveAssistantEffort(older, "claude", []), "");
  assert.equal(
    main.effortModelId(aiSettings({ codexModel: "gone" }), "codex", codexCatalog),
    "gpt-6-astra",
  );
});

test("CLI arguments carry the Assistant effort while the feature path stays as saved", () => {
  const ai = aiSettings({ claudeEffort: "max", codexModel: "gpt-6-astra", codexEffort: "low" });
  assert.equal(main.withAssistantEffort(ai, "claude", undefined), ai);
  assert.deepEqual(
    modelOptions.claudeModelArgs(main.withAssistantEffort(ai, "claude", "high")).slice(0, 4),
    ["--model", "opus", "--effort", "high"],
  );
  assert.equal(
    modelOptions.claudeModelArgs(main.withAssistantEffort(ai, "claude", "")).includes("--effort"),
    false,
  );
  assert.deepEqual(modelOptions.claudeModelArgs(ai).slice(0, 4), [
    "--model",
    "opus",
    "--effort",
    "max",
  ]);
  assert.ok(
    modelOptions
      .codexModelArgs(main.withAssistantEffort(ai, "codex", "ultra"), codexCatalog)
      .includes('model_reasoning_effort="ultra"'),
  );
  assert.ok(
    modelOptions
      .codexModelArgs(main.withAssistantEffort(ai, "codex", ""), codexCatalog)
      .includes('model_reasoning_effort="medium"'),
  );
  assert.ok(modelOptions.codexModelArgs(ai, codexCatalog).includes('model_reasoning_effort="low"'));
  assert.equal(main.withAssistantEffort(ai, "openai", "high"), ai);
  // One-click features still fail fast on a level the model doesn't list.
  assert.throws(
    () =>
      modelOptions.codexModelArgs(
        { ...ai, codexModel: "gpt-6-luna", codexEffort: "ultra" },
        codexCatalog,
      ),
    /reasoning effort/,
  );
});

test("API effort options merge into the prompt-cache options without replacing them", () => {
  const messages = [{ role: "user", content: "test" }];
  const cached = promptCache.apiPromptOptions(
    "openai",
    "gpt-6-sol",
    "policy",
    messages,
    "implicit",
  );
  const merged = main.withProviderOptions(cached, main.effortProviderOptions("openai", "high"));
  assert.deepEqual(merged.providerOptions, {
    openai: { promptCacheOptions: { mode: "implicit", ttl: "30m" }, reasoningEffort: "high" },
  });
  assert.equal(merged.system, cached.system);
  assert.deepEqual(cached.providerOptions, {
    openai: { promptCacheOptions: { mode: "implicit", ttl: "30m" } },
  });
  const plain = promptCache.apiPromptOptions(
    "anthropic",
    "claude-opus-5-5",
    "policy",
    messages,
    "implicit",
  );
  assert.deepEqual(
    main.withProviderOptions(plain, main.effortProviderOptions("anthropic", "max")).providerOptions,
    { anthropic: { effort: "max" } },
  );
  assert.equal(main.withProviderOptions(cached, main.effortProviderOptions("openai", "")), cached);
  for (const provider of ["google", "xai", "claude", "codex"])
    assert.equal(main.effortProviderOptions(provider, "high"), undefined, provider);
});

function fixture(overrides, codexModels = []) {
  globalThis.__effortFixture = { settings: { ai: aiSettings(overrides) }, codexModels, cli: [] };
}

function eventStream(events) {
  return new globalThis.Response(
    events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function responsesStream(model) {
  const item = {
    type: "message",
    id: "fixture-message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Fixture answer", annotations: [] }],
  };
  const response = {
    id: "fixture-response",
    created_at: 1,
    model,
    status: "completed",
    output: [item],
    usage: {
      input_tokens: 100,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  return eventStream([
    [
      "response.created",
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    ],
    [
      "response.output_item.added",
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
    ],
    [
      "response.output_text.delta",
      {
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "Fixture answer",
      },
    ],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response }],
  ]);
}

function messagesStream(model) {
  return eventStream([
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 1 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Fixture answer" },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

async function apiRun(provider, model, assistantEffort) {
  fixture({
    provider,
    apiModels: { openai: "", anthropic: "", google: "", xai: "", [provider]: model },
    assistantEffort,
  });
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    // Model listings are GETs; every generation request is a POST.
    if (init?.method !== "POST") return globalThis.Response.json({ data: [] });
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    return provider === "openai" ? responsesStream(body.model) : messagesStream(body.model);
  };
  try {
    const value = await assistant.runAssistant(
      {
        system: "stable policy",
        messages: [{ role: "user", content: "hello" }],
        snapshot: "fresh snapshot",
      },
      () => {},
      new globalThis.AbortController().signal,
    );
    return { value, requests };
  } finally {
    globalThis.fetch = original;
  }
}

async function cliRun(overrides, codexModels) {
  fixture(overrides, codexModels);
  await assistant.runAssistant(
    { system: "stable policy", messages: [{ role: "user", content: "hello" }] },
    () => {},
    new globalThis.AbortController().signal,
  );
  return globalThis.__effortFixture.cli[0];
}

test("OpenAI requests send the Assistant effort beside the cache options and drop levels the model lacks", async () => {
  const astra = await apiRun("openai", "gpt-6-astra", { openai: "high" });
  assert.equal(astra.requests[0].url, "https://api.openai.com/v1/responses");
  assert.deepEqual(astra.requests[0].body.reasoning, { effort: "high" });
  assert.deepEqual(astra.requests[0].body.prompt_cache_options, { mode: "implicit", ttl: "30m" });
  assert.equal(astra.value.text, "Fixture answer");
  const sol = await apiRun("openai", "gpt-6.1-sol", { openai: "low" });
  assert.deepEqual(sol.requests[0].body.reasoning, { effort: "low" });
  const dropped = await apiRun("openai", "gpt-6-astra", { openai: "none" });
  assert.equal(dropped.requests[0].body.reasoning, undefined);
  const unlisted = await apiRun("openai", "gpt-6-sol", { openai: "high" });
  assert.equal(unlisted.requests[0].body.reasoning, undefined);
  const unknown = await apiRun("openai", "gpt-5.5", { openai: "high" });
  assert.equal(unknown.requests[0].body.reasoning, undefined);
  // Effort stays out of the stable policy, so changing it leaves the cached prefix alone.
  const max = await apiRun("openai", "gpt-6-astra", { openai: "max" });
  assert.deepEqual(max.requests[0].body.input[0], astra.requests[0].body.input[0]);
  assert.doesNotMatch(JSON.stringify(astra.requests[0].body.input[0]), /Reasoning effort/);
});

test("Anthropic requests send the Assistant effort as output_config.effort where the model has it", async () => {
  const opus = await apiRun("anthropic", "claude-opus-5-5", { anthropic: "xhigh" });
  assert.deepEqual(opus.requests[0].body.output_config, { effort: "xhigh" });
  assert.equal(opus.value.text, "Fixture answer");
  const older = await apiRun("anthropic", "claude-opus-4-6", { anthropic: "xhigh" });
  assert.equal(older.requests[0].body.output_config, undefined);
  const haiku = await apiRun("anthropic", "claude-haiku-4-5", { anthropic: "high" });
  assert.equal(haiku.requests[0].body.output_config, undefined);
  assert.doesNotMatch(JSON.stringify(opus.requests[0].body.system), /Reasoning effort/);
});

test("CLI routes pass the Assistant effort and describe it in the model note", async () => {
  const claude = await cliRun({
    provider: "claude",
    claudeEffort: "max",
    assistantEffort: { claude: "high" },
  });
  assert.equal(claude.effort, "high");
  assert.match(claude.system, /Reasoning effort: high\./);
  const haiku = await cliRun({
    provider: "claude",
    claudeModel: "haiku",
    claudeEffort: "max",
    assistantEffort: { claude: "high" },
  });
  assert.equal(haiku.effort, "");
  assert.doesNotMatch(haiku.system, /Reasoning effort/);
  const codex = await cliRun(
    { provider: "codex", assistantEffort: { codex: "ultra" } },
    codexCatalog,
  );
  assert.equal(codex.codexModel, "gpt-6-astra");
  assert.equal(codex.effort, "ultra");
  assert.match(codex.system, /Reasoning effort: ultra\./);
  // A level the catalog no longer lists falls back to the model default instead of failing.
  const luna = await cliRun(
    { provider: "codex", codexModel: "gpt-6-luna", assistantEffort: { codex: "ultra" } },
    codexCatalog,
  );
  assert.equal(luna.effort, "");
  assert.match(luna.system, /Reasoning effort: high\./);
});
