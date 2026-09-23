import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
let sequence = 0;

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(`${source}\n// fixture-${sequence++}`).toString("base64")}`;
}

function fileStoreStub() {
  return `
    import * as fs from "node:fs/promises";
    import * as path from "node:path";
    export async function readFileIfExists(target) {
      try { return await fs.readFile(target); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    }
    export async function writeFileAtomic(target, data) {
      if (globalThis.__assistantHistoryWriteFailure) throw new Error("synthetic disk failure");
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = target + ".tmp";
      try { await fs.writeFile(tmp, data); await fs.rename(tmp, target); }
      finally { await fs.rm(tmp, { force: true }).catch(() => undefined); }
    }
    export function createSerialQueue() {
      let tail = Promise.resolve();
      const enqueue = (operation) => {
        const run = tail.then(operation, operation);
        tail = run.catch(() => undefined);
        return run;
      };
      enqueue.drain = () => tail.then(() => undefined);
      return enqueue;
    }
  `;
}

function backendPlugin({ failWrites = false } = {}) {
  return {
    name: "assistant-history-backend",
    setup(api) {
      api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
        path: "backend",
        namespace: "assistant-history",
      }));
      api.onLoad({ filter: /^backend$/, namespace: "assistant-history" }, () => ({
        contents: "export const app = { getPath: () => globalThis.__assistantHistoryUserData };",
        loader: "js",
      }));
      api.onResolve({ filter: /demo-data\.js$/ }, () => ({
        path: "demo-data",
        namespace: "assistant-history",
      }));
      api.onLoad({ filter: /^demo-data$/, namespace: "assistant-history" }, () => ({
        contents: "export const isDemoMode = () => globalThis.__assistantHistoryDemo === true;",
        loader: "js",
      }));
      if (failWrites) {
        api.onResolve({ filter: /file-store\.js$/ }, () => ({
          path: "file-store",
          namespace: "assistant-history",
        }));
        api.onLoad({ filter: /^file-store$/, namespace: "assistant-history" }, () => ({
          contents: fileStoreStub(),
          loader: "js",
        }));
      }
    },
  };
}

async function load({ failWrites = false } = {}) {
  const result = await build({
    entryPoints: [path.join(root, "main/services/assistant-history-store.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [backendPlugin({ failWrites })],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function loadHandlers() {
  const result = await build({
    entryPoints: [path.join(root, "main/handlers/assistant-history.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "assistant-history-handler-fixture",
        setup(api) {
          api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
            path: "backend",
            namespace: "history-handler",
          }));
          api.onLoad({ filter: /^backend$/, namespace: "history-handler" }, () => ({
            contents:
              "export const ipcMain = { handle: (channel, handler) => globalThis.__assistantHistoryHandlers.set(channel, handler) };",
            loader: "js",
          }));
          api.onResolve({ filter: /assistant-history-store\.js$/ }, () => ({
            path: "store",
            namespace: "history-handler",
          }));
          api.onLoad({ filter: /^store$/, namespace: "history-handler" }, () => ({
            contents: `
            export const getAssistantHistory = async (scope) => globalThis.__assistantHistoryCalls.push(['get', scope]) && { scope, chats: [], activeChatId: null, legacyImported: false };
            export const saveAssistantChat = async (scope, chat) => globalThis.__assistantHistoryCalls.push(['save', scope, chat]) && { scope, chats: [], activeChatId: null, legacyImported: false };
            export const selectAssistantChat = async (scope, id) => globalThis.__assistantHistoryCalls.push(['select', scope, id]) && { scope, chats: [], activeChatId: id, legacyImported: false };
            export const importLegacyAssistantChat = async (scope, messages) => globalThis.__assistantHistoryCalls.push(['import', scope, messages]) && { scope, chats: [], activeChatId: null, legacyImported: false };
          `,
            loader: "js",
          }));
          api.onResolve({ filter: /pending-writes\.js$/ }, () => ({
            path: "pending",
            namespace: "history-handler",
          }));
          api.onLoad({ filter: /^pending$/, namespace: "history-handler" }, () => ({
            contents:
              "export const trackPendingWrite = (operation) => globalThis.__assistantHistoryTrack(operation);",
            loader: "js",
          }));
          api.onResolve({ filter: /productivity\.js$/ }, () => ({
            path: "productivity",
            namespace: "history-handler",
          }));
          api.onLoad({ filter: /^productivity$/, namespace: "history-handler" }, () => ({
            contents: `
            export const requireAgendaScope = async () => {
              const next = globalThis.__assistantHistoryScopes.shift();
              if (!next) throw new Error('account identity is still loading');
              return next;
            };
            export const requireExpectedAgendaScope = (input, scope, channel) => {
              if (input.expectedScope !== scope) throw new Error(channel + ': account changed before this save could be applied. Refresh and try again.');
            };
          `,
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(moduleUrl(result.outputFiles[0].text));
}

async function withStore(run) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "dayboard-assistant-history-"));
  globalThis.__assistantHistoryUserData = userData;
  globalThis.__assistantHistoryDemo = false;
  try {
    await run(userData);
  } finally {
    delete globalThis.__assistantHistoryUserData;
    delete globalThis.__assistantHistoryDemo;
    delete globalThis.__assistantHistoryWriteFailure;
    await rm(userData, { recursive: true, force: true });
  }
}

function message(id, content = "Hello") {
  return {
    id,
    role: "user",
    content,
    tools: [],
    actions: [],
    error: null,
    blocked: null,
  };
}

function chat(id, updatedAt, messages = [message(`${id}-message`)]) {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-09-22T08:00:00.000Z",
    updatedAt,
    messages,
  };
}

test("history survives a fresh backend process", async () => {
  await withStore(async (userData) => {
    const result = await build({
      entryPoints: [path.join(root, "main/services/assistant-history-store.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      logLevel: "silent",
      plugins: [backendPlugin()],
    });
    await writeFile(path.join(userData, "store.mjs"), result.outputFiles[0].text);
    await writeFile(
      path.join(userData, "driver.mjs"),
      `
        globalThis.__assistantHistoryUserData = process.argv[2];
        globalThis.__assistantHistoryDemo = false;
        const store = await import('./store.mjs');
        const scope = 'google:opaque-a';
        if (process.argv[3] === 'save') {
          await store.saveAssistantChat(scope, {
            id: 'chat-a', title: 'Saved chat', createdAt: '2026-09-22T08:00:00.000Z',
            updatedAt: '2026-09-22T09:00:00.000Z',
            messages: [{ id: 'message-a', role: 'assistant', content: 'Saved reply', tools: [], actions: [], error: null, blocked: null, provider: 'glaze' }]
          });
        }
        process.stdout.write(JSON.stringify(await store.getAssistantHistory(scope)));
      `,
    );
    const run = (action) => {
      const child = spawnSync(
        process.execPath,
        [path.join(userData, "driver.mjs"), userData, action],
        {
          encoding: "utf8",
          cwd: userData,
        },
      );
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    const saved = run("save");
    assert.deepEqual(run("read"), saved);
    assert.equal(saved.activeChatId, "chat-a");
  });
});

test("handlers reject missing or stale scopes before a history write and recheck slow reads", async () => {
  globalThis.__assistantHistoryHandlers = new Map();
  globalThis.__assistantHistoryCalls = [];
  globalThis.__assistantHistoryTrack = (operation) => operation();
  try {
    const handlerModule = await loadHandlers();
    handlerModule.registerAssistantHistoryHandlers();
    const save = globalThis.__assistantHistoryHandlers.get("assistant:saveChat");
    const get = globalThis.__assistantHistoryHandlers.get("assistant:getHistory");

    globalThis.__assistantHistoryScopes = ["google:current"];
    await assert.rejects(save({}, { chat: {} }), /account changed before this save/);
    assert.deepEqual(globalThis.__assistantHistoryCalls, []);

    globalThis.__assistantHistoryScopes = ["google:current"];
    await assert.rejects(
      save({}, { expectedScope: "google:stale", chat: {} }),
      /account changed before this save/,
    );
    assert.deepEqual(globalThis.__assistantHistoryCalls, []);

    globalThis.__assistantHistoryScopes = ["google:before", "google:after"];
    await assert.rejects(get({}), /account changed while history was loading/);
    assert.deepEqual(globalThis.__assistantHistoryCalls, [["get", "google:before"]]);
  } finally {
    delete globalThis.__assistantHistoryHandlers;
    delete globalThis.__assistantHistoryCalls;
    delete globalThis.__assistantHistoryScopes;
    delete globalThis.__assistantHistoryTrack;
  }
});

test("concurrent saves retain every chat and keep newest chats first", async () => {
  await withStore(async () => {
    const store = await load();
    await Promise.all(
      Array.from({ length: 40 }, (_value, index) =>
        store.saveAssistantChat(
          "google:opaque-a",
          chat(`chat-${index}`, `2026-09-22T${String(index % 24).padStart(2, "0")}:00:00.000Z`),
        ),
      ),
    );
    const history = await store.getAssistantHistory("google:opaque-a");
    assert.equal(history.chats.length, 40);
    assert.equal(history.chats[0].id, "chat-23");
    assert.equal(history.chats.at(-1).id, "chat-0");
  });
});

test("a history reload cannot overtake a save awaiting account resolution", async () => {
  globalThis.__assistantHistoryHandlers = new Map();
  globalThis.__assistantHistoryCalls = [];
  globalThis.__assistantHistoryTrack = (operation) => operation();
  let release;
  const scope = new Promise((resolve) => { release = resolve; });
  globalThis.__assistantHistoryScopes = [scope, "local", "local"];
  try {
    (await loadHandlers()).registerAssistantHistoryHandlers();
    const saving = globalThis.__assistantHistoryHandlers.get("assistant:saveChat")({}, { expectedScope: "local", chat: {} });
    const reading = globalThis.__assistantHistoryHandlers.get("assistant:getHistory")({});
    await Promise.resolve();
    assert.deepEqual(globalThis.__assistantHistoryCalls, []);
    release("local");
    await Promise.all([saving, reading]);
    assert.deepEqual(globalThis.__assistantHistoryCalls.map((call) => call[0]), ["save", "get"]);
  } finally {
    delete globalThis.__assistantHistoryHandlers;
    delete globalThis.__assistantHistoryCalls;
    delete globalThis.__assistantHistoryScopes;
    delete globalThis.__assistantHistoryTrack;
  }
});

test("selection can deliberately preserve a blank new chat without deleting records", async () => {
  await withStore(async (userData) => {
    const store = await load();
    const freshBlank = await store.selectAssistantChat("local", null);
    assert.equal(freshBlank.activeChatId, null);
    assert.equal(freshBlank.chats.length, 0);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(userData, "assistant-history.json"), "utf8")).histories,
      {},
    );

    await store.saveAssistantChat("local", chat("chat-a", "2026-09-22T09:00:00.000Z"));
    assert.equal((await store.selectAssistantChat("local", "chat-a")).activeChatId, "chat-a");
    const blank = await store.selectAssistantChat("local", null);
    assert.equal(blank.activeChatId, null);
    assert.equal(blank.chats.length, 1);
  });
});

test("legacy import is explicitly one-time across real account scopes", async () => {
  await withStore(async () => {
    const store = await load();
    const legacy = [
      {
        ...message("legacy-message", "Imported from previous conversation"),
        tools: [{ id: "interrupted", name: "Search", status: "running" }],
      },
    ];
    const first = await store.importLegacyAssistantChat("google:opaque-a", legacy);
    assert.equal(first.chats.length, 1);
    assert.equal(first.chats[0].messages[0].tools[0].status, "error");
    assert.equal(first.legacyImported, true);

    const second = await store.importLegacyAssistantChat("google:opaque-b", legacy);
    assert.equal(second.chats.length, 0);
    assert.equal(second.legacyImported, true);
    assert.equal((await store.getAssistantHistory("google:opaque-a")).chats.length, 1);
  });
});

test("demo history is isolated from every real account history", async () => {
  await withStore(async (userData) => {
    const real = await load();
    await real.saveAssistantChat("google:opaque-a", chat("real", "2026-09-22T09:00:00.000Z"));

    globalThis.__assistantHistoryDemo = true;
    const demo = await load();
    await demo.saveAssistantChat("demo", chat("demo", "2026-09-22T10:00:00.000Z"));
    assert.equal((await demo.getAssistantHistory("demo")).chats[0].id, "demo");
    assert.equal(
      (await readFile(path.join(userData, "demo-assistant-history.json"), "utf8")).includes("demo"),
      true,
    );

    globalThis.__assistantHistoryDemo = false;
    const freshReal = await load();
    const history = await freshReal.getAssistantHistory("google:opaque-a");
    assert.equal(history.chats.length, 1);
    assert.equal(history.chats[0].id, "real");
  });
});

test("malformed and failed saves preserve the last acknowledged file", async () => {
  await withStore(async (userData) => {
    const target = path.join(userData, "assistant-history.json");
    const malformed = '{"version":99,"histories":{}}\n';
    await writeFile(target, malformed);
    const malformedStore = await load();
    await assert.rejects(malformedStore.getAssistantHistory("local"), /unsupported schema/);
    assert.equal(await readFile(target, "utf8"), malformed);

    await rm(target);
    const store = await load({ failWrites: true });
    await store.saveAssistantChat("local", chat("saved", "2026-09-22T09:00:00.000Z"));
    globalThis.__assistantHistoryWriteFailure = true;
    await assert.rejects(
      store.saveAssistantChat("local", chat("not-saved", "2026-09-22T10:00:00.000Z")),
      /synthetic disk failure/,
    );
    globalThis.__assistantHistoryWriteFailure = false;
    const recovered = await store.getAssistantHistory("local");
    assert.deepEqual(
      recovered.chats.map((entry) => entry.id),
      ["saved"],
    );
  });
});
