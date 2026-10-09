import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

// The direct "Sign in with ChatGPT" provider ("chatgpt") was removed. These checks cover data the
// removed version may have saved: settings choosing it and Assistant replies attributed to it.

const root = fileURLToPath(new URL("..", import.meta.url));
let sequence = 0;

const CODEX_MISSING =
  "Codex CLI isn't installed. Install it with `npm i -g @openai/codex`, then run `codex login` in Terminal.";

const forbidden = (name) =>
  `() => { globalThis.__providerMigration.fallbacks.push(${JSON.stringify(name)}); throw new Error(${JSON.stringify(`${name} must not run`)}); }`;

// Synthetic platform boundaries. Relative imports are matched by file name, packages exactly.
const BOUNDARIES = {
  "@glaze/core/backend": `
    export const app = { getPath: () => globalThis.__providerMigration.userData };
    export const safeStorage = {
      encryptString: async (text) => Buffer.from("sealed:" + text),
      decryptString: async (data) => Buffer.from(data).toString("utf8").replace(/^sealed:/, ""),
    };
    export const ipcMain = {
      handle: (channel, handler) => globalThis.__providerMigration.handlers.set(channel, handler),
      handleStream: (channel, handler) => globalThis.__providerMigration.streams.set(channel, handler),
      broadcast() {},
    };
    export const logger = { error() {}, warn() {}, info() {} };
    export const clipboard = { writeText() {} };
    export const shell = { openExternal: ${forbidden("shell.openExternal")} };
    export const dialog = {};`,
  "demo-data.js": `
    export const isDemoMode = () => false;
    export const assertNotDemo = () => {};
    export const demoCompletion = () => "";
    export const demoAssistantReply = () => "";`,
};

// No CLI is installed, and every other route (API keys, Glaze AI, MCP, PTY) must stay untouched.
const AI_BOUNDARIES = {
  ...BOUNDARIES,
  "@glaze/core/ai": `
    export class GlazeAIError extends Error {}
    export const streamText = ${forbidden("streamText")};
    export const glaze = ${forbidden("glaze")};
    export const stepCountIs = ${forbidden("stepCountIs")};
    export const tool = ${forbidden("tool")};`,
  "cli-binaries.js": `
    export const resolveCli = async (provider) => {
      globalThis.__providerMigration.resolved.push(provider);
      return null;
    };`,
  "shell-env.js": `
    export const getToolEnv = async () => ({});
    export const toStringEnv = (env) => env;
    export const runLoginShell = ${forbidden("runLoginShell")};`,
  "node-pty": `export const spawn = ${forbidden("node-pty")}; export default { spawn };`,
  "api-providers.js": `
    export const API_LABEL = {};
    export const apiLanguageModel = ${forbidden("apiLanguageModel")};
    export const resolveApiModel = ${forbidden("resolveApiModel")};
    export const listApiModels = ${forbidden("listApiModels")};`,
  "attachments.js": `
    export const attachmentContext = ${forbidden("attachmentContext")};
    export const pickAttachments = ${forbidden("pickAttachments")};`,
  "dictation.js": `export const transcribe = ${forbidden("transcribe")};`,
  "mcp-client.js": `
    export const openMcpSession = ${forbidden("openMcpSession")};
    export const testMcpServer = ${forbidden("testMcpServer")};`,
  "assistant-mcp.js": `export const resolveAssistantMcpServers = () => [];`,
  "mcp-http-server.js": `
    export const checkAssistantMcpConnection = ${forbidden("checkAssistantMcpConnection")};
    export const getActiveAssistantMcpServerConfig = () => null;
    export const getAssistantMcpStatus = () => ({ state: "unavailable", ok: false, toolCount: 0 });
    export const getExternalMcpUrl = () => null;`,
  "mcp-access-key.js": `
    export const getMcpAccessKey = ${forbidden("getMcpAccessKey")};
    export const regenerateMcpAccessKey = ${forbidden("regenerateMcpAccessKey")};`,
};

const RENDERER_BOUNDARIES = {
  "@tanstack/react-query": `
    export const useQuery = () => ({});
    export const useMutation = () => ({});
    export const useQueryClient = () => ({});`,
  "@glaze/core/components": `export const toast = { error() {}, success() {} };`,
  ipc: `export const errorMessage = String; export const invoke = async () => undefined;`,
};

async function load(entry, boundaries) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "provider-migration-boundaries",
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) => {
            const key = args.path.startsWith(".")
              ? path.basename(args.path).replace(/\.ts$/, "")
              : args.path;
            return Object.hasOwn(boundaries, key)
              ? { path: key, namespace: "provider-migration" }
              : undefined;
          });
          api.onLoad({ filter: /.*/, namespace: "provider-migration" }, (args) => ({
            contents: boundaries[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  // Each import is a fresh instance with empty caches, like a relaunched app.
  const source = `${result.outputFiles[0].text}\n// instance ${sequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function withUserData(run) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "dayboard-provider-migration-"));
  globalThis.__providerMigration = {
    userData,
    handlers: new Map(),
    streams: new Map(),
    resolved: [],
    fallbacks: [],
  };
  try {
    await run(userData, globalThis.__providerMigration);
  } finally {
    delete globalThis.__providerMigration;
    await rm(userData, { recursive: true, force: true });
  }
}

/** AI settings as the removed version saved them, with every other choice set away from defaults. */
function legacyAI(defaults, overrides = {}) {
  return {
    ...defaults,
    enabled: false,
    provider: "chatgpt",
    chatgptModel: "direct-plan-model",
    claudeModel: "opus",
    claudeEffort: "high",
    claudeFast: true,
    codexModel: "fixture-codex-model",
    codexEffort: "high",
    codexServiceTier: "priority",
    apiModels: { ...defaults.apiModels, openai: "fixture-api-model" },
    assistantProvider: "",
    useMcpInAssistant: false,
    assistantPermission: "auto",
    features: { ...defaults.features, briefing: false, triage: false, meetingPrep: false },
    ...overrides,
  };
}

test("settings that chose the removed ChatGPT sign-in continue on Codex and keep every other choice", async () => {
  await withUserData(async () => {
    const store = await load("main/services/settings-store.ts", BOUNDARIES);
    const saved = legacyAI(store.DEFAULT_SETTINGS.ai);
    const upgraded = store.normalizeSettings({ ai: saved });

    assert.equal(upgraded.ai.provider, "codex");
    assert.equal("chatgptModel" in upgraded.ai, false, "the direct model ID is dropped");
    assert.equal(upgraded.ai.codexModel, "fixture-codex-model", "Codex keeps its own model");
    const kept = { ...upgraded.ai };
    const expected = { ...saved };
    delete kept.provider;
    delete expected.provider;
    delete expected.chatgptModel;
    assert.deepEqual(kept, expected, "AI enablement, features and other models are unchanged");
  });
});

test("Assistant overrides of the removed sign-in move to Codex; other provider choices stay", async () => {
  await withUserData(async () => {
    const { DEFAULT_SETTINGS, normalizeSettings } = await load(
      "main/services/settings-store.ts",
      BOUNDARIES,
    );
    const cases = [
      [{ provider: "claude", assistantProvider: "chatgpt" }, ["claude", "codex"]],
      [{ provider: "chatgpt", assistantProvider: "claude" }, ["codex", "claude"]],
      [{ provider: "chatgpt", assistantProvider: "chatgpt" }, ["codex", "codex"]],
      [{ provider: "codex", assistantProvider: "" }, ["codex", ""]],
      [{ provider: "claude", assistantProvider: "" }, ["claude", ""]],
      [{ provider: "glaze", assistantProvider: "openai" }, ["glaze", "openai"]],
      // Only the removed ID is mapped; unknown values keep the existing default fallback.
      [{ provider: "unknown-provider", assistantProvider: "unknown" }, ["glaze", ""]],
    ];
    for (const [choice, expected] of cases) {
      const { ai } = normalizeSettings({ ai: { ...DEFAULT_SETTINGS.ai, ...choice } });
      assert.deepEqual([ai.provider, ai.assistantProvider], expected, JSON.stringify(choice));
    }
  });
});

test("the upgraded choice survives reload and saving can't select the removed provider again", async () => {
  await withUserData(async (userData) => {
    const file = path.join(userData, "settings.json");
    const first = await load("main/services/settings-store.ts", BOUNDARIES);
    const legacy = `${JSON.stringify(
      { ai: legacyAI(first.DEFAULT_SETTINGS.ai, { enabled: true, assistantProvider: "chatgpt" }) },
      null,
      2,
    )}\n`;
    await writeFile(file, legacy);

    const read = await first.getSettings();
    assert.deepEqual([read.ai.provider, read.ai.assistantProvider], ["codex", "codex"]);
    assert.equal(await readFile(file, "utf8"), legacy, "reading alone never rewrites the file");

    await first.saveSettings({ ...read, general: { ...read.general, userName: "Fixture" } });
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual([written.ai.provider, written.ai.assistantProvider], ["codex", "codex"]);
    assert.equal("chatgptModel" in written.ai, false);

    const relaunched = await load("main/services/settings-store.ts", BOUNDARIES);
    const reloaded = await relaunched.getSettings();
    assert.deepEqual([reloaded.ai.provider, reloaded.ai.assistantProvider], ["codex", "codex"]);
    assert.equal(reloaded.general.userName, "Fixture");
    assert.equal(reloaded.ai.enabled, true);
    assert.equal(reloaded.ai.codexEffort, "high");

    // A stale window or crafted request still can't store the removed provider.
    const { settings } = await relaunched.saveSettings({
      ...reloaded,
      ai: { ...reloaded.ai, provider: "chatgpt", assistantProvider: "chatgpt" },
    });
    assert.deepEqual([settings.ai.provider, settings.ai.assistantProvider], ["codex", "codex"]);
    assert.doesNotMatch(await readFile(file, "utf8"), /chatgpt/);
  });
});

test("saved chats with replies from the removed sign-in still load, keep attribution and continue", async () => {
  await withUserData(async (userData) => {
    const scope = "google:fixture-scope";
    const reply = (id, provider, modelLabel) => ({
      id,
      role: "assistant",
      content: `Synthetic reply ${id}`,
      tools: [],
      actions: [],
      error: null,
      blocked: null,
      provider,
      modelLabel,
    });
    const question = (id) => ({ ...reply(id, undefined, undefined), role: "user" });
    const chat = {
      id: "chat-direct",
      title: "Synthetic chat",
      createdAt: "2026-10-09T08:00:00.000Z",
      updatedAt: "2026-10-09T09:00:00.000Z",
      messages: [
        question("q1"),
        reply("a1", "chatgpt", "Direct plan model"),
        question("q2"),
        reply("a2", "codex", "Codex model"),
      ].map(({ provider, modelLabel, ...message }) => ({
        ...message,
        ...(provider ? { provider, modelLabel } : {}),
      })),
    };
    // The file exactly as the removed version wrote it.
    await writeFile(
      path.join(userData, "assistant-history.json"),
      `${JSON.stringify(
        {
          version: 1,
          legacyImported: false,
          histories: { [scope]: { scope, chats: [chat], activeChatId: chat.id } },
        },
        null,
        2,
      )}\n`,
    );

    const store = await load("main/services/assistant-history-store.ts", BOUNDARIES);
    const history = await store.getAssistantHistory(scope);
    assert.equal(history.activeChatId, "chat-direct");
    const providers = (messages) => messages.map((message) => message.provider ?? null);
    assert.deepEqual(providers(history.chats[0].messages), [null, "chatgpt", null, "codex"]);
    assert.equal(history.chats[0].messages[1].modelLabel, "Direct plan model");

    // Continuing the chat on Codex keeps the earlier reply's attribution.
    await store.saveAssistantChat(scope, {
      ...history.chats[0],
      updatedAt: "2026-10-09T10:00:00.000Z",
      messages: [
        ...history.chats[0].messages,
        question("q3"),
        { ...reply("a3", "codex", "Codex model") },
      ],
    });
    const relaunched = await load("main/services/assistant-history-store.ts", BOUNDARIES);
    const continued = await relaunched.getAssistantHistory(scope);
    assert.deepEqual(providers(continued.chats[0].messages), [
      null,
      "chatgpt",
      null,
      "codex",
      null,
      "codex",
    ]);

    // Validation is otherwise unchanged: unknown providers are still refused without a write.
    await assert.rejects(
      relaunched.saveAssistantChat(scope, {
        ...chat,
        id: "chat-unknown",
        messages: [reply("x1", "unknown-provider", "Unknown")],
      }),
      /invalid message provider/,
    );
    assert.equal((await relaunched.getAssistantHistory(scope)).chats.length, 1);
  });
});

test("Codex is labeled ChatGPT again, saved direct replies stay ChatGPT, and the removed ID isn't offered", async () => {
  const labels = await load("renderer/lib/settings.ts", RENDERER_BOUNDARIES);
  assert.equal(labels.PROVIDER_LABEL.codex, "ChatGPT");
  assert.equal(
    labels.PROVIDER_DETAIL.codex,
    "Uses your ChatGPT subscription through the Codex CLI.",
  );
  assert.equal(labels.PROVIDER_LABEL.claude, "Claude");
  assert.equal("chatgpt" in labels.PROVIDER_LABEL, false);
  assert.equal("chatgpt" in labels.PROVIDER_DETAIL, false);
  assert.deepEqual([...labels.SUBSCRIPTION_PROVIDERS], ["claude", "codex", "gemini", "muse"]);
  assert.equal(labels.replyProviderLabel("chatgpt"), "ChatGPT");
  assert.equal(labels.replyProviderLabel("claude"), "Claude");
  assert.equal(labels.replyProviderLabel("codex"), "ChatGPT");
});

test("with the Codex CLI missing, upgraded choices show Codex's setup message and never fall back", async () => {
  await withUserData(async (userData, fixture) => {
    const file = path.join(userData, "settings.json");
    const defaults = (await load("main/services/settings-store.ts", BOUNDARIES)).DEFAULT_SETTINGS;
    const legacy = `${JSON.stringify(
      { ai: legacyAI(defaults.ai, { enabled: true, assistantProvider: "chatgpt" }) },
      null,
      2,
    )}\n`;
    await writeFile(file, legacy);
    const handlers = await load("main/handlers/ai.ts", AI_BOUNDARIES);
    handlers.registerAIHandlers();
    assert.equal(
      [...fixture.handlers.keys(), ...fixture.streams.keys()].some((channel) =>
        channel.startsWith("chatgpt:"),
      ),
      false,
    );

    const availability = await fixture.handlers.get("ai:availability")();
    assert.equal(availability.codex, false);
    assert.equal(availability.claude, false);
    assert.equal("chatgpt" in availability, false);
    assert.deepEqual(await fixture.handlers.get("ai:providerStatus")({}, { provider: "codex" }), {
      ok: false,
      reason: "missing",
      message: CODEX_MISSING,
    });
    await assert.rejects(
      fixture.handlers.get("ai:providerStatus")({}, { provider: "chatgpt" }),
      /provider must be claude, codex, gemini, or muse/,
    );

    // Availability legitimately looks up every CLI; requests below must look up only Codex.
    fixture.resolved.length = 0;
    const signal = new globalThis.AbortController().signal;
    const runChunks = [];
    await assert.rejects(
      fixture.streams.get("ai:run")(
        { system: "Synthetic policy", prompt: "Synthetic prompt" },
        (chunk) => runChunks.push(chunk),
        { signal },
      ),
      { message: CODEX_MISSING },
    );
    assert.deepEqual(runChunks, []);

    const assistantChunks = [];
    await assert.rejects(
      fixture.streams.get("ai:assistant")(
        { system: "Synthetic policy", messages: [{ role: "user", content: "Synthetic question" }] },
        (chunk) => assistantChunks.push(chunk),
        { signal },
      ),
      { message: CODEX_MISSING },
    );
    assert.deepEqual(
      assistantChunks.map((chunk) => [chunk.type, chunk.model?.provider]),
      [["meta", "codex"]],
    );

    assert.deepEqual([...new Set(fixture.resolved)], ["codex"], "only Codex was looked up");
    assert.deepEqual(fixture.fallbacks, [], "no API, Glaze AI, MCP or terminal fallback ran");
    assert.equal(await readFile(file, "utf8"), legacy, "the saved choice wasn't switched");
    const current = await fixture.handlers.get("settings:get")();
    assert.deepEqual([current.ai.provider, current.ai.assistantProvider], ["codex", "codex"]);
  });
});
