import assert from "node:assert/strict";
import { URL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let sequence = 0;

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(`${source}\n// fixture-${sequence++}`).toString("base64")}`;
}

function backendPlugin() {
  return {
    name: "demo-backend",
    setup(api) {
      api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({ path: "backend", namespace: "demo" }));
      api.onLoad({ filter: /.*/, namespace: "demo" }, () => ({
        contents: `
          export const app = { getPath: () => globalThis.__demoUserData };
          export const safeStorage = { encryptString: async (value) => Buffer.from(value), decryptString: async (value) => Buffer.from(value).toString("utf8") };
          export const ipcMain = globalThis.__demoIpc ?? { handle() {}, handleStream() {}, broadcast() {} };
          export const clipboard = { writeText() {} };
          export const logger = { error() {}, warn() {}, info() {} };
        `,
        loader: "js",
      }));
    },
  };
}

async function loadSettings(userData) {
  globalThis.__demoUserData = userData;
  const result = await build({
    entryPoints: [path.join(root, "main/services/settings-store.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [backendPlugin()],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function loadDemoData(userData) {
  globalThis.__demoUserData = userData;
  const result = await build({
    entryPoints: [path.join(root, "main/services/demo-data.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [backendPlugin()],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function loadRendererDemo() {
  const result = await build({
    stdin: {
      contents: `
        export { initializeDemoMode, isRendererDemoMode } from "./renderer/lib/demo.ts";
        export { readStored, storedKey } from "./renderer/lib/storage.ts";
      `,
      resolveDir: root,
      sourcefile: "renderer-demo-fixture.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
    plugins: [{
      name: "renderer-demo-ipc",
      setup(api) {
        api.onResolve({ filter: /^\.\/ipc$/ }, () => ({ path: "ipc", namespace: "renderer-demo" }));
        api.onLoad({ filter: /.*/, namespace: "renderer-demo" }, () => ({
          contents: `export const invoke = async () => { if (globalThis.__rendererDemoMode instanceof Error) throw globalThis.__rendererDemoMode; return globalThis.__rendererDemoMode; };`,
          loader: "js",
        }));
      },
    }],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function loadTriagePrompt() {
  const result = await build({
    stdin: {
      contents: `export { TRIAGE_SYSTEM, buildTriagePrompt } from "./renderer/lib/ai-prompts.ts";`,
      resolveDir: root,
      sourcefile: "triage-prompt-fixture.ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
    plugins: [{
      name: "triage-prompt-components",
      setup(api) {
        api.onResolve({ filter: /^@glaze\/core\/components$/ }, () => ({ path: "components", namespace: "triage-prompt" }));
        api.onLoad({ filter: /.*/, namespace: "triage-prompt" }, () => ({
          contents: `export const toast = { error() {} };`,
          loader: "js",
        }));
      },
    }],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "dayboard-demo-"));
}

test("demo mode is latched per backend session and marker inspection errors fail closed", async () => {
  const userData = await fixture();
  try {
    const normal = await loadDemoData(userData);
    assert.equal(normal.isDemoMode(), false);
    await writeFile(path.join(userData, "demo-mode"), "");
    assert.equal(normal.isDemoMode(), false, "a marker change needs a full restart");

    const demo = await loadDemoData(userData);
    assert.equal(demo.isDemoMode(), true);
    await rm(path.join(userData, "demo-mode"));
    assert.equal(demo.isDemoMode(), true, "a removed marker cannot expose real data mid-session");

    const notDirectory = path.join(userData, "not-a-directory");
    await writeFile(notDirectory, "x");
    const broken = await loadDemoData(notDirectory);
    assert.throws(() => broken.isDemoMode(), /Couldn't determine whether DayBoard is in demo mode/);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("renderer demo initialization never reads personal storage and rejects invalid mode responses", async () => {
  const previousStorage = globalThis.localStorage;
  const reads = [];
  globalThis.localStorage = {
    getItem(key) {
      reads.push(key);
      return key === "demo:isolated-v2:dashboard:assistant:v1" ? JSON.stringify([{ id: "sample" }]) : JSON.stringify([{ id: "personal" }]);
    },
    setItem() {},
  };
  try {
    globalThis.__rendererDemoMode = true;
    const demo = await loadRendererDemo();
    await demo.initializeDemoMode();
    assert.equal(demo.isRendererDemoMode(), true);
    assert.deepEqual(demo.readStored("dashboard:assistant:v1", Array.isArray), [{ id: "sample" }]);
    assert.deepEqual(reads, ["demo:isolated-v2:dashboard:assistant:v1"]);

    reads.length = 0;
    globalThis.__rendererDemoMode = new Error("backend unavailable");
    const failed = await loadRendererDemo();
    await assert.rejects(() => failed.initializeDemoMode(), /backend unavailable/);
    assert.deepEqual(reads, [], "a detection failure must not inspect personal storage");

    globalThis.__rendererDemoMode = "true";
    const invalid = await loadRendererDemo();
    await assert.rejects(() => invalid.initializeDemoMode(), /invalid demo-mode state/);
    assert.deepEqual(reads, [], "an invalid IPC response must fail before cache access");
  } finally {
    globalThis.localStorage = previousStorage;
    delete globalThis.__rendererDemoMode;
  }
});

test("demo settings are isolated from real settings and keep synthetic sources available", async () => {
  const userData = await fixture();
  try {
    const real = {
      general: { launchView: "mail", refreshMinutes: 30, accent: "pink", density: "compact", detailView: "sidebar" },
      sources: {
        tasks: { enabled: false, color: "red" },
        reminders: { enabled: false, color: "red" },
        mail: { enabled: false, color: "red" },
        calendar: { enabled: false, color: "red" },
      },
      mail: { maxMessages: 50 },
      calendar: { range: "next-2-weeks", visibility: { private: false } },
      mcpServer: { enabled: true, allowWrites: true },
      ai: { enabled: false, provider: "codex", useMcpInAssistant: true, features: {} },
    };
    const realText = `${JSON.stringify(real, null, 2)}\n`;
    await writeFile(path.join(userData, "settings.json"), realText);
    await writeFile(path.join(userData, "demo-mode"), "");

    const settings = await loadSettings(userData);
    const initial = await settings.getSettings();
    assert.equal(initial.general.accent, "system");
    assert.equal(initial.ai.enabled, true);
    assert.equal(initial.mcpServer.enabled, false);
    assert.equal(initial.mcpServer.allowWrites, false);
    assert.equal(initial.ai.useMcpInAssistant, false);
    assert.deepEqual(Object.values(initial.sources).map((source) => source.enabled), [true, true, true, true]);
    assert.deepEqual(await settings.getMcpServers(), []);

    const next = globalThis.structuredClone(initial);
    next.general.accent = "graphite";
    next.general.density = "compact";
    await settings.saveSettings(next);
    assert.equal(await readFile(path.join(userData, "settings.json"), "utf8"), realText);
    const demoSaved = JSON.parse(await readFile(path.join(userData, "demo-settings.json"), "utf8"));
    assert.equal(demoSaved.general.accent, "graphite");
    assert.equal(demoSaved.mcpServer.enabled, false);
    assert.throws(() => settings.saveMcpServer({ name: "live", transport: "http", url: "https://example.test" }), /demo mode/);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("demo fixture outputs follow the renderer prompt schemas", async () => {
  const userData = await fixture();
  try {
    const demo = await loadDemoData(userData);
    const { TRIAGE_SYSTEM, buildTriagePrompt } = await loadTriagePrompt();
    const messages = Array.from({ length: 7 }, (_value, index) => ({
      id: `mail-${index + 1}`,
      threadId: `mail-${index + 1}`,
      from: `Sender ${index + 1}`,
      fromEmail: `sender${index + 1}@example.com`,
      subject: `Subject ${index + 1}`,
      snippet: "Sample inbox context",
      date: "2026-09-22T12:00:00.000Z",
      unread: index < 3,
    }));
    const triage = JSON.parse(
      demo.demoCompletion(
        TRIAGE_SYSTEM,
        buildTriagePrompt(messages.map((message, index) => ({ key: `m${index + 1}`, message }))),
      ),
    );
    assert.deepEqual(triage.emails.map((entry) => entry.key), ["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
    for (const entry of triage.emails) {
      assert.ok(["needs-reply", "fyi", "ignore"].includes(entry.category));
      assert.equal(typeof entry.reason, "string");
      assert.equal(typeof entry.task, "string");
    }

    const priorities = JSON.parse(
      demo.demoCompletion("You are a productivity coach.", "Open items:\n- task-1 | Task / Work | due today\n- task-2 | Task / Work | due tomorrow"),
    );
    assert.deepEqual(priorities.items.map((item) => item.key), ["task-1", "task-2"]);
    assert.deepEqual(
      JSON.parse(demo.demoCompletion("You turn one short sentence into a single task, reminder, or calendar event.", 'Sentence: "Call Mom"')),
      { kind: "task", title: "Call Mom", notes: "", date: "", time: "", endTime: "" },
    );
    assert.match(demo.demoCompletion("You draft email replies on the user's behalf.", ""), /^Hi Priya,/);
    assert.match(demo.demoCompletion("You prepare the user for an upcoming meeting", ""), /Sample meeting prep/);
    assert.match(demo.demoCompletion("You write the user's weekly review", ""), /Sample weekly review/);
    assert.match(demo.demoCompletion("You are a concise executive assistant writing the user's daily briefing", ""), /Schedule/);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("demo mode blocks the startup-item write before native settings are touched", async () => {
  const handlers = new Map();
  globalThis.__demoIpc = { handle: (channel, handler) => handlers.set(channel, handler) };
  globalThis.__startupWrites = 0;
  globalThis.__startupReads = 0;
  const plugin = {
    name: "demo-startup-boundary",
    setup(api) {
      const stubs = new Map([
        ["@glaze/core/backend", `export const ipcMain = globalThis.__demoIpc;`],
        ["../services/demo-data.js", `export const isDemoMode = () => true; export const assertNotDemo = (channel) => { throw new Error(channel + ": changes are turned off in demo mode."); };`],
        ["../services/startup-settings.js", `export const getStartAtLogin = () => { globalThis.__startupReads += 1; return { openAtLogin: true }; }; export const setStartAtLogin = () => { globalThis.__startupWrites += 1; return { openAtLogin: true }; };`],
      ]);
      api.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: "demo-startup" } : undefined);
      api.onLoad({ filter: /.*/, namespace: "demo-startup" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
    },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/handlers/startup.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [plugin],
  });
  const module = await import(moduleUrl(result.outputFiles[0].text));
  module.registerStartupHandlers();
  assert.deepEqual(await handlers.get("startup:getLoginItem")(), { openAtLogin: false, status: "not-registered" });
  assert.equal(globalThis.__startupReads, 0);
  assert.throws(
    () => handlers.get("startup:setLoginItem")({}, { openAtLogin: true }),
    /demo mode/,
  );
  assert.equal(globalThis.__startupWrites, 0);
  delete globalThis.__demoIpc;
  delete globalThis.__startupWrites;
  delete globalThis.__startupReads;
});

test("demo Assistant replies locally without CLI, Glaze AI, or MCP access", async () => {
  globalThis.__demoLiveCalls = 0;
  const plugin = {
    name: "demo-assistant-boundary",
    setup(api) {
      const stubs = new Map([
        ["@glaze/core/ai", `export class GlazeAIError extends Error {}; export const glaze = () => { globalThis.__demoLiveCalls += 1; }; export const stepCountIs = () => { globalThis.__demoLiveCalls += 1; }; export const streamText = () => { globalThis.__demoLiveCalls += 1; }; export const tool = () => { globalThis.__demoLiveCalls += 1; };`],
        ["@glaze/core/backend", `export const logger = { error() {} };`],
        ["../demo-data.js", `export const isDemoMode = () => true; export const demoAssistantReply = () => "local sample";`],
        ["../settings-store.js", `export const getSettings = async () => { globalThis.__demoLiveCalls += 1; }; export const getMcpServers = async () => { globalThis.__demoLiveCalls += 1; };`],
        ["./cli-providers.js", `export const runCliCompletion = async () => { globalThis.__demoLiveCalls += 1; };`],
        ["./assistant-mcp.js", `export const resolveAssistantMcpServers = () => { globalThis.__demoLiveCalls += 1; };`],
        ["./mcp-client.js", `export const openMcpSession = async () => { globalThis.__demoLiveCalls += 1; };`],
        ["./api-keys.js", `export const isApiProvider = () => { globalThis.__demoLiveCalls += 1; return false; };`],
        ["./api-providers.js", `export const apiLanguageModel = () => { globalThis.__demoLiveCalls += 1; }; export const resolveApiModel = () => { globalThis.__demoLiveCalls += 1; }; export const API_LABEL = {};`],
        ["./attachments.js", `export const attachmentContext = async () => { globalThis.__demoLiveCalls += 1; };`],
      ]);
      api.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: "demo-assistant" } : undefined);
      api.onLoad({ filter: /.*/, namespace: "demo-assistant" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
    },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/services/ai/assistant.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [plugin],
  });
  const module = await import(moduleUrl(result.outputFiles[0].text));
  const chunks = [];
  const answer = await module.runAssistant(
    { messages: [{ role: "user", content: "What is next?" }], system: "ignored" },
    (chunk) => chunks.push(chunk),
    new globalThis.AbortController().signal,
  );
  assert.deepEqual(answer, { text: "local sample" });
  assert.deepEqual(chunks, [{ type: "delta", text: "local sample" }]);
  assert.equal(globalThis.__demoLiveCalls, 0);
  delete globalThis.__demoLiveCalls;
});

test("demo ai:run handler returns a fixture without provider, settings, or CLI access", async () => {
  const handlers = new Map();
  const streams = new Map();
  globalThis.__aiCounters = { provider: 0, settings: 0, cli: 0, models: 0 };
  globalThis.__aiIpc = {
    handle: (channel, handler) => handlers.set(channel, handler),
    handleStream: (channel, handler) => streams.set(channel, handler),
    broadcast() {},
  };
  const plugin = {
    name: "demo-ai-handler-boundary",
    setup(api) {
      const stubs = new Map([
        ["@glaze/core/backend", `export const ipcMain = globalThis.__aiIpc; export const logger = { error() {} }; export const clipboard = { writeText() {} };`],
        ["../services/demo-data.js", `export const isDemoMode = () => true; export const assertNotDemo = (channel) => { throw new Error(channel + ": demo mode"); }; export const demoCompletion = () => "fixture completion";`],
        ["../services/ai/assistant.js", `export const runAssistant = async () => { throw new Error("assistant should not run"); };`],
        ["../services/ai/cli-providers.js", `export const checkCliProvider = async () => { globalThis.__aiCounters.provider += 1; }; export const isCancelled = () => false; export const listGeminiModels = async () => { globalThis.__aiCounters.models += 1; }; export const resolveCli = async () => { globalThis.__aiCounters.cli += 1; }; export const runCliCompletion = async () => { globalThis.__aiCounters.cli += 1; };`],
        ["../services/ai/codex-models.js", `export const listCodexModels = async () => { globalThis.__aiCounters.models += 1; };`],
        ["../services/ai/mcp-client.js", `export const testMcpServer = async () => { throw new Error("MCP should not run"); };`],
        ["../services/mcp-http-server.js", `export const checkAssistantMcpConnection = async () => { throw new Error("MCP should not run"); }; export const getActiveAssistantMcpServerConfig = () => { throw new Error("MCP should not run"); }; export const getAssistantMcpStatus = () => ({ state: "unavailable", ok: false, toolCount: 0 }); export const getExternalMcpUrl = () => null;`],
        ["../services/mcp-access-key.js", `export const getMcpAccessKey = async () => { throw new Error("key should not load"); }; export const regenerateMcpAccessKey = async () => { throw new Error("key should not write"); };`],
        ["../services/ai/assistant-mcp.js", `export const resolveAssistantMcpServers = () => [];`],
        ["@glaze/core/ai", `export const streamText = () => { globalThis.__aiCounters.provider += 1; };`],
        ["../services/ai/attachments.js", `export const pickAttachments = async () => { throw new Error("attachments should not open"); };`],
        ["../services/ai/dictation.js", `export const transcribe = async () => { throw new Error("dictation should not run"); };`],
        ["../services/ai/api-keys.js", `export const API_PROVIDERS = []; export const isApiProvider = () => false; export const clearApiKey = async () => { throw new Error("keys should not write"); }; export const getApiKeyStatuses = async () => { throw new Error("keys should not load"); }; export const saveApiKey = async () => { throw new Error("keys should not write"); };`],
        ["../services/ai/api-providers.js", `export const apiLanguageModel = () => { globalThis.__aiCounters.provider += 1; }; export const listApiModels = async () => { globalThis.__aiCounters.models += 1; }; export const resolveApiModel = () => { globalThis.__aiCounters.provider += 1; };`],
        ["../services/settings-store.js", `export const deleteMcpServer = async () => { globalThis.__aiCounters.settings += 1; }; export const getMcpServers = async () => { globalThis.__aiCounters.settings += 1; }; export const getSettings = async () => { globalThis.__aiCounters.settings += 1; }; export const normalizeMcpServer = () => ({}); export const saveMcpServer = async () => { globalThis.__aiCounters.settings += 1; }; export const saveSettings = async () => { globalThis.__aiCounters.settings += 1; }; export const settingsAffectData = () => false;`],
      ]);
      api.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: "demo-ai-handler" } : undefined);
      api.onLoad({ filter: /.*/, namespace: "demo-ai-handler" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
    },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/handlers/ai.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [plugin],
  });
  const module = await import(moduleUrl(result.outputFiles[0].text));
  module.registerAIHandlers();
  const chunks = [];
  const response = await streams.get("ai:run")(
    { system: "system", prompt: "prompt" },
    (chunk) => chunks.push(chunk),
    { signal: new globalThis.AbortController().signal },
  );
  assert.deepEqual(response, { text: "fixture completion" });
  assert.deepEqual(chunks, [{ type: "delta", text: "fixture completion" }]);
  assert.deepEqual(globalThis.__aiCounters, { provider: 0, settings: 0, cli: 0, models: 0 });
  delete globalThis.__aiCounters;
  delete globalThis.__aiIpc;
});

function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "POST",
      headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
    });
    client.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    client.on("error", reject);
    client.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  });
}

test("demo MCP endpoints reject before any source service can run", async () => {
  const sourceStub = `
    export const createEvent = async () => { throw new Error("live source called"); };
    export const createReplyDraft = createEvent; export const createTask = createEvent;
    export const getMessageBody = createEvent; export const listCompletedTasks = createEvent;
    export const listEvents = createEvent; export const listEventsBetween = createEvent;
    export const listInbox = createEvent; export const listTasks = createEvent;
    export const modifyMessage = createEvent; export const setTaskCompleted = createEvent;
  `;
  const plugin = {
    name: "demo-mcp-boundary",
    setup(api) {
      const stubs = new Map([
        ["@glaze/core/backend", `export const ipcMain = { broadcast() {} }; export const logger = { error() {}, warn() {}, info() {} };`],
        ["./google-api.js", sourceStub],
        ["./google-auth.js", `export class GoogleAuthError extends Error {}; export const getGoogleStatus = async () => ({ connected: false, email: null });`],
        ["./apple-reminders.js", `export const createReminder = async () => { throw new Error("live source called"); }; export const getRemindersAccess = async () => "full-access"; export const listCompletedReminders = createReminder; export const listReminders = createReminder; export const setReminderCompleted = createReminder;`],
        ["./calendar-range.js", `export const calendarRangeDays = () => 7;`],
        ["./demo-data.js", `export const isDemoMode = () => true;`],
        ["./mcp-access-key.js", `export const isValidMcpBearer = async () => true;`],
        ["./settings-store.js", `export const getSettings = async () => ({ mcpServer: { enabled: true, allowWrites: true }, sources: { tasks: { enabled: true }, reminders: { enabled: true }, mail: { enabled: true }, calendar: { enabled: true } }, mail: { maxMessages: 25 }, calendar: { range: "next-7-days", visibility: {} } });`],
        ["./agenda-store.js", `export const reconcileAgendaKeys = async () => ({ changed: false, state: {} });`],
        ["../../shared/agenda-identities.js", `export const replacementAgendaKey = () => null;`],
      ]);
      api.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: "demo-mcp" } : undefined);
      api.onLoad({ filter: /.*/, namespace: "demo-mcp" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
    },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/services/mcp-http-server.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [plugin],
  });
  const module = await import(moduleUrl(result.outputFiles[0].text));
  const server = module.createMcpHttpServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  try {
    const port = server.address().port;
    assert.equal(await rawRequest(port, "/mcp"), 403);
    assert.equal(await rawRequest(port, "/assistant-mcp"), 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
