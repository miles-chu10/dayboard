import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const handlers = new Map();
const added = [];
globalThis.__agentLearn = { handlers, added, reply: "" };

const stubs = {
  name: "agent-stubs",
  setup(build) {
    const map = {
      "../platform/index.js": `export const ipcMain = {
        handle: (channel, fn) => globalThis.__agentLearn.handlers.set(channel, fn),
        broadcast() {},
      };`,
      "../services/agent-stores.js": `const noop = async () => [];
      export const addMemoryEntry = async (text, source) => {
        globalThis.__agentLearn.added.push([text, source]);
        return [];
      };
      export const deleteMemoryEntry = noop, deleteNote = noop, getNote = noop, listActivity = noop,
        listMemories = noop, listNotes = noop, listUsage = noop, putNote = noop, recordUsage = () => {};`,
      "../services/ai/completion.js": `export const runCompletion = async () => ({
        text: globalThis.__agentLearn.reply,
      });`,
      "../services/ai/usage-events.js": "export const onRequestUsage = () => () => {};",
      "../services/demo-data.js": `export const isDemoMode = () => false;
      export const demoCompletion = () => "NONE";`,
      "../services/settings-store.js": `export const getSettings = async () => ({
        ai: { enabled: true, memory: true },
      });`,
    };
    build.onResolve({ filter: /.*/ }, (args) =>
      map[args.path] ? { path: args.path, namespace: "agent-stub" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "agent-stub" }, (args) => ({
      contents: map[args.path],
      loader: "js",
    }));
  },
};

const agent = await loadTs("main/handlers/agent.ts", [stubs]);
agent.registerAgentHandlers();
const invoke = (channel, payload) => handlers.get(channel)({}, payload);

test("memory:learn suggests a preference but saves nothing until the user confirms", async () => {
  globalThis.__agentLearn.reply = "Skip the greeting.";
  const result = await invoke("memory:learn", {
    draft: "Hi Sam, thanks so much for reaching out about lunch! Today works great.",
    sent: "Today works.",
  });
  assert.deepEqual(result, { learned: "Skip the greeting." });
  assert.deepEqual(added, []);

  await invoke("memory:add", { text: "Skip the greeting.", source: "learned" });
  assert.deepEqual(added, [["Skip the greeting.", "learned"]]);
});

test("memory:add records the user as the source unless it confirms a learned one", async () => {
  added.length = 0;
  await invoke("memory:add", { text: "Call me Alex" });
  await invoke("memory:add", { text: "Be terse", source: "agent" });
  assert.deepEqual(added, [
    ["Call me Alex", "you"],
    ["Be terse", "you"],
  ]);
});
