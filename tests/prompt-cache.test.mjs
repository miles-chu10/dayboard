import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import test, { after } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(tmpdir(), "dayboard-cache-fixtures-"));
after(() => rm(temporary, { recursive: true, force: true }));
const root = fileURLToPath(new URL("../", import.meta.url));
const stubs = {
  "api-keys.js": `export const API_PROVIDERS = ['openai','anthropic','xai']; export const isApiProvider = p => API_PROVIDERS.includes(p); export const getApiKey = async () => 'synthetic-key'; export const clearApiKey = async()=>{}; export const saveApiKey=async()=>{}; export const getApiKeyStatuses=async()=>({});`,
  "settings-store.js": `export const getSettings=async()=>globalThis.__cacheFixture.settings; export const getMcpServers=async()=>[]; export const deleteMcpServer=()=>{}; export const normalizeMcpServer=x=>x; export const saveMcpServer=()=>{}; export const saveSettings=()=>{}; export const settingsAffectData=()=>false;`,
  "demo-data.js": `export const isDemoMode=()=>false; export const assertNotDemo=()=>{}; export const demoAssistantReply=()=>''; export const demoCompletion=()=>'';`,
  "attachments.js": `export const attachmentContext=async()=>''; export const pickAttachments=async()=>[];`,
  "codex-models.js": `export const listCodexModels=async()=>[];`,
  "cli-providers.js": `export const runCliCompletion=async()=>{throw Error('CLI must not run')}; export const checkCliProvider=()=>{}; export const isCancelled=()=>false; export const listGeminiModels=()=>[]; export const resolveCli=async()=>null;`,
  "assistant-mcp.js": `export const resolveAssistantMcpServers=()=>globalThis.__cacheFixture.tools.length ? [{}] : [];`,
  "mcp-client.js": `export const testMcpServer=async()=>({}); export const openMcpSession=async()=>({tools:globalThis.__cacheFixture.tools,errors:[],close:async()=>{globalThis.__cacheFixture.closed++}});`,
  "provider-resolution.js": `export const resolveConfiguredProvider=async p=>p;`,
  "dictation.js": `export const transcribe=async()=>{throw Error('Transcription must not run')};`,
  "mcp-http-server.js": `export const checkAssistantMcpConnection=()=>{}; export const getActiveAssistantMcpServerConfig=()=>null; export const getAssistantMcpStatus=()=>({}); export const getExternalMcpUrl=()=>'';`,
  "mcp-access-key.js": `export const getMcpAccessKey=()=>''; export const regenerateMcpAccessKey=()=>'';`,
};
const backend = `export const app={getPath:()=>'/nonexistent-fixture'}; export const logger={error:()=>{},warn:()=>{}}; export const clipboard={}; export const ipcMain={handle:()=>{},broadcast:()=>{},handleStream:(name,handler)=>{globalThis.__cacheFixture.handlers[name]=handler}};`;
let sequence = 0;
async function load(file, { fixtures = false, exposeCli = false, mcpDiscovery = false } = {}) {
  const plugins = [
    {
      name: "cache-fixtures",
      setup(api) {
        api.onResolve({ filter: /^\.\/sources$/ }, () => ({
          path: "sources",
          namespace: "fixture",
        }));
        api.onLoad({ filter: /^sources$/, namespace: "fixture" }, () => ({
          contents: `export const SOURCE_META={tasks:{label:'Google Tasks'},reminders:{label:'Apple Reminders'},mail:{label:'Gmail'},calendar:{label:'Calendar'}};`,
          loader: "js",
        }));
        api.onResolve({ filter: /^@glaze\/core\/ai$/ }, () => ({
          path: "ai",
          namespace: "fixture",
        }));
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
          contents: backend,
          loader: "js",
        }));
        if (fixtures) {
          api.onResolve({ filter: /\.js$/ }, (args) => {
            const key = args.path.split("/").at(-1);
            return stubs[key] ? { path: key, namespace: "service-fixture" } : undefined;
          });
          api.onLoad({ filter: /.*/, namespace: "service-fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        }
        if (mcpDiscovery) {
          api.onResolve({ filter: /^@modelcontextprotocol\/sdk\/client\// }, (args) => ({
            path: args.path,
            namespace: "mcp-discovery",
          }));
          api.onLoad({ filter: /.*/, namespace: "mcp-discovery" }, () => ({
            contents: `
        export class Client {
          async connect(transport) { this.fixture=globalThis.__cacheDiscovery[transport.url]; await new Promise(resolve=>setTimeout(resolve,this.fixture.delay)); }
          async listTools() { return {tools:this.fixture.tools}; }
          async callTool() {return {content:[{type:'text',text:this.fixture.id}]}; }
          async close() {globalThis.__cacheDiscoveryClosed++;}
        }
        export class StdioClientTransport {}
        export class StreamableHTTPClientTransport { constructor(url) {this.url=String(url);} }
      `,
            loader: "js",
          }));
          api.onResolve({ filter: /shell-env\.js$/ }, () => ({
            path: "shell-env",
            namespace: "mcp-discovery-env",
          }));
          api.onLoad({ filter: /.*/, namespace: "mcp-discovery-env" }, () => ({
            contents: "export const getToolEnv=async()=>({}); export const toStringEnv=x=>x;",
            loader: "js",
          }));
        }
        if (exposeCli) {
          api.onLoad({ filter: /cli-providers\.ts$/ }, async (args) => ({
            contents: `${await readFile(args.path, "utf8")}\nexport {handleCodexLine, createState};`,
            loader: "ts",
            resolveDir: root + "main/services/ai",
          }));
          api.onResolve(
            { filter: /(?:shell-env|cli-binaries|settings-store|codex-models|model-options)\.js$/ },
            (args) => ({ path: args.path, namespace: "cli-fixture" }),
          );
          api.onLoad({ filter: /.*/, namespace: "cli-fixture" }, () => ({
            contents: `export const getToolEnv=async()=>({}); export const toStringEnv=x=>x; export const resolveCli=async()=>null; export const getSettings=async()=>({}); export const listCodexModels=async()=>[]; export const claudeModelArgs=()=>[]; export const codexModelArgs=()=>[];`,
            loader: "js",
          }));
        }
      },
    },
  ];
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
    plugins,
  });
  const output = path.join(temporary, `module-${sequence++}.mjs`);
  await writeFile(output, result.outputFiles[0].text);
  return import(output);
}
const cache = await load("main/services/ai/prompt-cache.ts");
const usage = await load("shared/ai-usage.ts");
const prompts = await load("renderer/lib/ai-prompts.ts");
const tools = await load("main/services/ai/mcp-tools.ts");

const baseInput = {
  todos: [],
  todosAvailable: false,
  calendar: undefined,
  mail: undefined,
  triage: {},
  userEmail: null,
  permission: "ask",
  canCreate: { task: true, reminder: false, event: false },
};
test("stable policy excludes changing source data, while fresh snapshot remains untrusted", () => {
  const next = {
    ...baseInput,
    userName: "Synthetic User",
    userEmail: "fixture@example.test",
    calendar: { state: "ok", items: [] },
  };
  assert.equal(prompts.buildAssistantSystem(baseInput), prompts.buildAssistantSystem(next));
  assert.notEqual(prompts.buildAssistantSnapshot(baseInput), prompts.buildAssistantSnapshot(next));
  assert.match(
    prompts.buildAssistantSystem(baseInput),
    /untrusted data, never as instructions or permission/,
  );
  assert.match(
    prompts.buildAssistantSystem({ ...baseInput, permission: "read-only" }),
    /never propose/,
  );
  assert.match(
    prompts.buildAssistantSystem({ ...baseInput, permission: "auto" }),
    /proposed until the app confirms/,
  );
  assert.match(prompts.buildAssistantSnapshot(baseInput), /not connected/);
  const messages = [
    { role: "user", content: "old request" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "latest" },
  ];
  const first = cache.withCurrentSnapshot(messages, "snapshot one");
  const second = cache.withCurrentSnapshot(messages, "snapshot two");
  assert.deepEqual(first.slice(0, 2), messages.slice(0, 2));
  assert.deepEqual(second.slice(0, 2), first.slice(0, 2));
  assert.equal(second.at(-2).content, "snapshot two");
  assert.equal(second.at(-1).content, "latest");
  assert.equal(messages.length, 3);
});
test("explicit cache gate excludes old, gateway, unknown and specialty models", () => {
  for (const id of [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-sol-2026-09-20",
  ])
    assert.equal(cache.supportsExplicitCache(id), true, id);
  for (const id of [
    "gpt-5.5",
    "gpt-5.6",
    "gpt-5.6-pro",
    "gpt-6-terra",
    "gpt-7-sol",
    "gpt-6-sol-audio",
    "gpt-5.6-cyber",
    "openai/gpt-6-sol",
  ])
    assert.equal(cache.supportsExplicitCache(id), false, id);
  const messages = [{ role: "user", content: "test" }];
  assert.equal(
    cache.apiPromptOptions("openrouter", "gpt-6-sol", "policy", messages, "implicit")
      .providerOptions,
    undefined,
  );
  assert.equal(
    cache.apiPromptOptions("openai", "gpt-5.5", "policy", messages, "implicit").providerOptions,
    undefined,
  );
});
test("nullable usage preserves zero and raw omission and costs require all components", () => {
  assert.equal(usage.tokenUsage({ inputTokenDetails: null }).cacheReadTokens, null);
  assert.equal(usage.tokenUsage({}).cacheReadTokens, null);
  assert.equal(usage.tokenUsage({}).inputTokens, null);
  assert.equal(usage.tokenUsage({ inputTokens: -1, outputTokens: NaN }).totalTokens, null);
  assert.equal(
    usage.inputCost(usage.tokenUsage({ cacheReadTokens: 0, cacheWriteTokens: 0 }), {
      input: 2,
      cached: 0.2,
      write: 2.5,
    }),
    null,
  );
  assert.equal(
    usage.tokenUsage({ inputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 0 }).cacheReadTokens,
    null,
  );
  assert.equal(
    usage.tokenUsage({ inputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 3 }).cacheWriteTokens,
    null,
  );
  assert.equal(usage.tokenUsage({ cacheReadTokens: 0, cacheWriteTokens: 0 }).cacheReadTokens, 0);
  assert.equal(
    usage.tokenUsage(
      { inputTokenDetails: { cacheReadTokens: 0 }, raw: { input_tokens: 5 } },
      "openai",
    ).cacheReadTokens,
    null,
  );
  assert.equal(
    usage.tokenUsage(
      {
        inputTokenDetails: { cacheReadTokens: 0 },
        raw: { input_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
      },
      "openai",
    ).cacheReadTokens,
    0,
  );
  assert.equal(usage.tokenUsage({ inputTokens: 5, outputTokens: 2 }).totalTokens, 7);
  assert.equal(
    usage.tokenUsage(
      {
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
        raw: { input_tokens: 50, cache_read_input_tokens: 40 },
      },
      "anthropic",
    ).cacheReadTokens,
    40,
  );
  assert.equal(
    usage.inputCost(
      { inputTokens: 100, cacheReadTokens: 40, cacheWriteTokens: 10 },
      { input: 2, cached: 0.2, write: 2.5 },
    ),
    0.000133,
  );
  assert.equal(
    usage.inputCost(
      { inputTokens: 100, cacheReadTokens: 40, cacheWriteTokens: null },
      { input: 2, cached: 0.2, write: 2.5 },
    ),
    null,
  );
  assert.equal(
    usage.inputCost(
      { inputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
      { input: 2, cached: 0.2, write: 2.5 },
    ),
    null,
  );
  const total = usage.tokenUsage({ inputTokens: 150, outputTokens: 8 });
  const steps = [
    usage.tokenUsage({ inputTokens: 100, cacheReadTokens: 40, cacheWriteTokens: 10 }),
    usage.tokenUsage({ inputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  ];
  assert.deepEqual(usage.withCacheTotals(total, steps), {
    ...total,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
  });
  assert.equal(
    usage.withCacheTotals(total, [...steps, usage.tokenUsage({})]).cacheReadTokens,
    null,
  );
});
test("tool order, nested schema order and collision assignment ignore randomized discovery", async () => {
  const handles = ["A B", "A_B", "A B"].map((server, index) => ({
    server,
    serverId: String(index),
    tool: "lookup",
    description: "fixture",
    inputSchema: {
      required: ["z"],
      properties: { z: { type: "string" }, a: { type: "number" } },
      type: "object",
    },
    call: async () => String(index),
  }));
  const expected = tools.orderMcpTools(handles);
  for (let i = 0; i < 25; i++) {
    const shuffled = [...handles]
      .sort(() => Math.random() - 0.5)
      .map((handle) => ({
        ...handle,
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, z: { type: "string" } },
          required: ["z"],
        },
      }));
    const ordered = tools.orderMcpTools(shuffled);
    assert.equal(JSON.stringify(ordered), JSON.stringify(expected));
    assert.deepEqual(await Promise.all(ordered.map((tool) => tool.call({}))), ["0", "2", "1"]);
  }
  assert.equal(new Set(expected.map((tool) => tool.qualifiedName)).size, 3);
});

function fixture(model = "gpt-6-sol", handles = []) {
  globalThis.__cacheFixture = {
    settings: {
      ai: {
        enabled: true,
        providerChosen: true,
        provider: "openai",
        assistantProvider: "openai",
        apiModels: { openai: model },
        useMcpInAssistant: handles.length > 0,
      },
    },
    handlers: {},
    tools: handles,
    closed: 0,
  };
}
function sse(model, counters, toolName) {
  const response = {
    id: "fixture-response",
    created_at: 1,
    model,
    status: "completed",
    output: [],
    usage: {
      input_tokens: 100,
      output_tokens: 4,
      input_tokens_details: counters,
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  const events = [{ type: "response.created", response: { ...response, status: "in_progress" } }];
  if (toolName) {
    const item = {
      type: "function_call",
      id: "fixture-tool",
      call_id: "fixture-call",
      name: toolName,
      arguments: "{}",
      status: "completed",
    };
    events.push(
      { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
      {
        type: "response.function_call_arguments.delta",
        item_id: item.id,
        output_index: 0,
        delta: "{}",
      },
      { type: "response.output_item.done", output_index: 0, item },
    );
    response.output = [item];
  } else {
    const item = {
      type: "message",
      id: "fixture-message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Fixture answer", annotations: [] }],
    };
    events.push(
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      {
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: "Fixture answer",
      },
      { type: "response.output_item.done", output_index: 0, item },
    );
    response.output = [item];
  }
  events.push({ type: "response.completed", response });
  return new globalThis.Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function withFetch(
  operation,
  {
    counters = { cached_tokens: 40, cache_write_tokens: 10 },
    toolFirst = false,
    fail = false,
  } = {},
) {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/models"))
      return globalThis.Response.json({
        data: [{ id: globalThis.__cacheFixture.settings.ai.apiModels.openai, created: 1 }],
      });
    assert.equal(String(url), "https://api.openai.com/v1/responses", "unexpected network request");
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (fail)
      return globalThis.Response.json(
        { error: { message: "synthetic bad request", type: "invalid_request_error" } },
        { status: 400 },
      );
    return sse(body.model, counters, toolFirst && bodies.length === 1 ? "lookup" : undefined);
  };
  try {
    return { value: await operation(), bodies };
  } finally {
    globalThis.fetch = original;
  }
}
test("actual Assistant request uses stable boundary, latest snapshot and aggregate cache usage once", async () => {
  fixture();
  const assistant = await load("main/services/ai/assistant.ts", { fixtures: true });
  const messages = [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "latest request" },
  ];
  const system = prompts.buildAssistantSystem(baseInput);
  const chunks = [];
  const first = await withFetch(() =>
    assistant.runAssistant(
      { system, messages, snapshot: "fresh snapshot one" },
      (chunk) => chunks.push(chunk),
      new globalThis.AbortController().signal,
    ),
  );
  const second = await withFetch(() =>
    assistant.runAssistant(
      { system, messages, snapshot: "fresh snapshot two" },
      () => {},
      new globalThis.AbortController().signal,
    ),
  );
  assert.deepEqual(first.bodies[0].prompt_cache_options, { mode: "implicit", ttl: "30m" });
  assert.deepEqual(first.bodies[0].input[0], second.bodies[0].input[0]);
  assert.deepEqual(first.bodies[0].input[0].content[0].prompt_cache_breakpoint, {
    mode: "explicit",
  });
  assert.deepEqual(first.bodies[0].input.slice(1, 3), second.bodies[0].input.slice(1, 3));
  assert.equal(first.bodies[0].input.at(-2).content[0].text, "fresh snapshot one");
  assert.equal(second.bodies[0].input.at(-2).content[0].text, "fresh snapshot two");
  assert.equal(first.bodies[0].input.at(-1).content[0].text, "latest request");
  assert.equal(first.value.text, "Fixture answer");
  assert.equal(first.value.usage.cacheReadTokens, 40);
  assert.equal(first.value.usage.cacheWriteTokens, 10);
  assert.equal(chunks.filter((chunk) => chunk.type === "usage").length, 1);
  assert.equal(first.value.usage.route, "openai");
  assert.equal(first.value.usage.requestedModelId, "gpt-6-sol");
  assert.equal(first.value.usage.modelId, "gpt-6-sol");
  assert.ok(first.value.usage.durationMs >= 0);
  assert.equal(first.bodies[0].prompt_cache_key, undefined);
});
test("Assistant tool steps count each usage once and close the session", async () => {
  fixture("gpt-6-sol", [
    {
      server: "fixture",
      tool: "lookup",
      qualifiedName: "lookup",
      description: "fixture lookup",
      inputSchema: { type: "object", properties: {} },
      call: async () => "synthetic result",
    },
  ]);
  const assistant = await load("main/services/ai/assistant.ts", { fixtures: true });
  const chunks = [];
  const result = await withFetch(
    () =>
      assistant.runAssistant(
        { system: "stable policy", messages: [{ role: "user", content: "Use lookup" }] },
        (chunk) => chunks.push(chunk),
        new globalThis.AbortController().signal,
      ),
    { toolFirst: true },
  );
  assert.equal(result.bodies.length, 2);
  assert.equal(result.value.usage.inputTokens, 200);
  assert.equal(result.value.usage.outputTokens, 8);
  assert.equal(result.value.usage.cacheReadTokens, 80);
  assert.equal(result.value.usage.cacheWriteTokens, 20);
  assert.equal(result.value.usage.totalTokens, 208);
  assert.equal(chunks.filter((chunk) => chunk.type === "usage").length, 1);
  assert.equal(globalThis.__cacheFixture.closed, 1);
});
test("actual one-shot handler sends explicit policy boundary and returns usage; old models omit fields", async () => {
  fixture();
  const handlers = await load("main/handlers/ai.ts", { fixtures: true });
  handlers.registerAIHandlers();
  const chunks = [];
  const first = await withFetch(() =>
    globalThis.__cacheFixture.handlers["ai:run"](
      { system: "stable one-shot policy", prompt: "changing question" },
      (chunk) => chunks.push(chunk),
      { signal: new globalThis.AbortController().signal },
    ),
  );
  assert.deepEqual(first.bodies[0].prompt_cache_options, { mode: "explicit", ttl: "30m" });
  assert.deepEqual(first.bodies[0].input[0].content[0].prompt_cache_breakpoint, {
    mode: "explicit",
  });
  assert.equal(first.bodies[0].input.at(-1).content[0].text, "changing question");
  assert.equal(first.value.usage.cacheReadTokens, 40);
  assert.equal(first.value.usage.cacheWriteTokens, 10);
  assert.equal(chunks.filter((chunk) => chunk.type === "usage").length, 1);
  globalThis.__cacheFixture.settings.ai.apiModels.openai = "gpt-5.5";
  const old = await withFetch(
    () =>
      globalThis.__cacheFixture.handlers["ai:run"](
        { system: "policy", prompt: "question" },
        () => {},
        { signal: new globalThis.AbortController().signal },
      ),
    { counters: { cached_tokens: 0 } },
  );
  assert.equal(old.bodies[0].prompt_cache_options, undefined);
  assert.equal(typeof old.bodies[0].input[0].content, "string");
  assert.equal(old.value.usage.cacheReadTokens, 0);
  assert.equal(old.value.usage.cacheWriteTokens, null);
});
test("one-shot omitted usage counters remain unknown and failed requests do not claim usage", async () => {
  fixture();
  const handlers = await load("main/handlers/ai.ts", { fixtures: true });
  handlers.registerAIHandlers();
  const run = (chunks) =>
    globalThis.__cacheFixture.handlers["ai:run"](
      { system: "policy", prompt: "question" },
      (chunk) => chunks.push(chunk),
      { signal: new globalThis.AbortController().signal },
    );
  const missing = await withFetch(() => run([]), { counters: undefined });
  // Explicit empty details exercise the provider SDK's zero fallback.
  const empty = await withFetch(() => run([]), { counters: {} });
  assert.equal(empty.value.usage.cacheReadTokens, null);
  assert.equal(empty.value.usage.cacheWriteTokens, null);
  assert.equal(missing.value.usage.inputTokens, 100);
  const chunks = [];
  await assert.rejects(
    withFetch(() => run(chunks), { fail: true }),
    /synthetic bad request/,
  );
  assert.equal(
    chunks.some((chunk) => chunk.type === "usage"),
    false,
  );
});
test("Codex subscription parser retains cached input without inventing write counters", async () => {
  const cli = await load("main/services/ai/cli-providers.ts", { exposeCli: true });
  const records = [];
  const options = {
    onUsage: (record) => records.push(record),
    onDelta: () => {},
    onTool: () => {},
  };
  cli.handleCodexLine(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 5, cached_input_tokens: 40 },
    }),
    cli.createState(),
    options,
  );
  cli.handleCodexLine(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 5, cached_input_tokens: 0 },
    }),
    cli.createState(),
    options,
  );
  cli.handleCodexLine(
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 5 } }),
    cli.createState(),
    options,
  );
  assert.deepEqual(
    records.map((record) => record.cacheReadTokens),
    [40, 0, null],
  );
  assert.ok(records.every((record) => record.cacheWriteTokens === null));
  assert.ok(records.every((record) => record.inputTokens === 100));
  cli.handleCodexLine(
    JSON.stringify({ type: "turn.completed", usage: { cached_input_tokens: 0 } }),
    cli.createState(),
    options,
  );
  assert.equal(records.at(-1).inputTokens, null);
  assert.equal(records.at(-1).outputTokens, null);
});

test("parallel MCP connections finalize stable names and schemas before exposing tools", async () => {
  const mcp = await load("main/services/ai/mcp-client.ts", { mcpDiscovery: true });
  const servers = [
    { id: "a", name: "A B", transport: "http", url: "https://fixture.invalid/a", headers: {} },
    { id: "b", name: "A_B", transport: "http", url: "https://fixture.invalid/b", headers: {} },
  ];
  let expected;
  for (let iteration = 0; iteration < 6; iteration++) {
    globalThis.__cacheDiscoveryClosed = 0;
    globalThis.__cacheDiscovery = Object.fromEntries(
      servers.map((server, index) => [
        server.url,
        {
          id: server.id,
          delay: (iteration % 2 ? 1 - index : index) * 5,
          tools: [
            {
              name: "lookup",
              description: "fixture",
              inputSchema:
                iteration % 2
                  ? { properties: { z: { type: "string" }, a: { type: "number" } }, type: "object" }
                  : {
                      type: "object",
                      properties: { a: { type: "number" }, z: { type: "string" } },
                    },
            },
          ],
        },
      ]),
    );
    const session = await mcp.openMcpSession(iteration % 2 ? [...servers].reverse() : servers);
    const wire = session.tools.map(({ qualifiedName, inputSchema }) => ({
      qualifiedName,
      inputSchema,
    }));
    expected ??= wire;
    assert.deepEqual(wire, expected);
    assert.deepEqual(await Promise.all(session.tools.map((tool) => tool.call({}))), ["a", "b"]);
    await session.close();
    assert.equal(globalThis.__cacheDiscoveryClosed, 2);
  }
});
