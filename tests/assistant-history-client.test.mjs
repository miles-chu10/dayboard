import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

let sequence = 0;
const initial = { scope: "local", chats: [], activeChatId: null, legacyImported: false };
const message = {
  id: "message",
  role: "assistant",
  content: "Stopped reply",
  tools: [],
  actions: [],
  error: null,
  blocked: null,
};

async function fixture(invoke) {
  const calls = [];
  globalThis.__historyClient = {
    invoke: (channel, input) => {
      calls.push({ channel, input });
      return invoke(channel, input);
    },
  };
  const stubs = {
    react:
      "export const useState = init => [typeof init === 'function' ? init() : init, () => {}]; export const useRef = value => ({current: value}); export const useEffect = () => {};",
    "./ipc":
      "export const invoke = (channel, input) => globalThis.__historyClient.invoke(channel, input); export const errorMessage = error => error.message;",
  };
  const result = await build({
    entryPoints: [
      path.join(new URL("..", import.meta.url).pathname, "renderer/lib/assistant-history.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "history-client",
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) =>
            stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n//${sequence++}`).toString("base64")}`
  );
  return { client: module.useAssistantHistory(initial, false), calls };
}

test("message changes reach the backend immediately and selection waits for acknowledgement", async () => {
  let acknowledge;
  const pending = new Promise((resolve) => {
    acknowledge = resolve;
  });
  try {
    const { client, calls } = await fixture((channel) =>
      channel === "assistant:saveChat" ? pending : Promise.resolve(initial),
    );
    client.setMessages([message]);
    assert.equal(calls.length, 1, "no renderer debounce may hide a write from normal quit");
    assert.equal(calls[0].input.chat.messages[0].content, "Stopped reply");
    const switching = client.selectChat(null);
    await Promise.resolve();
    assert.equal(calls.length, 1);
    acknowledge(initial);
    assert.equal(await switching, true);
    assert.equal(calls[1].channel, "assistant:selectChat");
  } finally {
    delete globalThis.__historyClient;
  }
});

test("a failed save preserves the current draft and blocks switching until retry succeeds", async () => {
  let failing = true;
  try {
    const { client, calls } = await fixture(() =>
      failing ? Promise.reject(new Error("synthetic disk failure")) : Promise.resolve(initial),
    );
    client.setMessages([message]);
    assert.equal(await client.selectChat(null), false);
    assert.equal(
      calls.some((call) => call.channel === "assistant:selectChat"),
      false,
    );
    failing = false;
    await client.flush();
    assert.equal(calls.at(-1).input.chat.messages[0].content, "Stopped reply");
    assert.equal(await client.selectChat(null), true);
  } finally {
    delete globalThis.__historyClient;
  }
});
