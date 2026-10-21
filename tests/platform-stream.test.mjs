import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

async function loadStreamRegistry(file = "main/platform/stream-registry.ts") {
  const result = await build({
    entryPoints: [path.join(root, file)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

test("start() forwards chunks and resolves with the handler's result", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  registry.registerHandler("echo", async (payload, sendChunk) => {
    sendChunk({ type: "delta", text: "a" });
    sendChunk({ type: "delta", text: "b" });
    return { text: `${payload.text}!` };
  });

  const chunks = [];
  const result = await registry.start(
    { id: "s1", channel: "echo", args: { text: "hi" } },
    1,
    (chunk) => chunks.push(chunk),
  );

  assert.deepEqual(result, { text: "hi!" });
  assert.deepEqual(chunks, [
    { type: "delta", text: "a" },
    { type: "delta", text: "b" },
  ]);
  assert.equal(registry.runningCount, 0);
});

test("cancel() aborts a running stream's signal", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  let observedAborted = false;
  registry.registerHandler("slow", async (_payload, _sendChunk, { signal }) => {
    await new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        observedAborted = true;
        resolve();
      });
    });
    throw new Error("cancelled");
  });

  const started = registry.start({ id: "s2", channel: "slow", args: {} }, 7, () => {});
  // Give the handler a tick to register its abort listener before cancelling.
  await new Promise((resolve) => setImmediate(resolve));
  registry.cancel(7, "s2");

  await assert.rejects(started, /cancelled/);
  assert.equal(observedAborted, true);
});

test("a cancel that arrives before start() aborts immediately", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  registry.registerHandler("race", async (_payload, _sendChunk, { signal }) => {
    if (signal.aborted) throw new Error("aborted before handler ran");
    return "ok";
  });

  registry.cancel(3, "s3");
  await assert.rejects(
    registry.start({ id: "s3", channel: "race", args: {} }, 3, () => {}),
    /aborted before handler ran/,
  );
});

test("disposeSender aborts only that sender's running streams", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  const aborted = { a: false, b: false };
  registry.registerHandler("watch", async (payload, _sendChunk, { signal }) => {
    await new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted[payload.who] = true;
        resolve();
      });
    });
    throw new Error(`${payload.who} aborted`);
  });

  const a = registry.start({ id: "sa", channel: "watch", args: { who: "a" } }, 1, () => {});
  const b = registry.start({ id: "sb", channel: "watch", args: { who: "b" } }, 2, () => {});
  await new Promise((resolve) => setImmediate(resolve));

  registry.disposeSender(1);
  await assert.rejects(a, /a aborted/);
  assert.equal(aborted.a, true);
  assert.equal(aborted.b, false);

  registry.disposeSender(2);
  await assert.rejects(b, /b aborted/);
});

test("start() rejects for an unregistered channel", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  await assert.rejects(
    registry.start({ id: "s4", channel: "missing", args: {} }, 1, () => {}),
    /No stream handler registered for "missing"/,
  );
});

test("registering the same channel twice throws", async () => {
  const { StreamRegistry } = await loadStreamRegistry();
  const registry = new StreamRegistry();
  registry.registerHandler("dup", async () => "ok");
  assert.throws(() => registry.registerHandler("dup", async () => "ok"), /already registered/);
});

const loadStreamClient = () => loadStreamRegistry("shared/stream-client.ts");

test("a stream whose reply overtakes its chunks still delivers every chunk first", async () => {
  const { createStreamClient } = await loadStreamClient();
  const client = createStreamClient();
  const seen = [];
  // The invoke reply is already here; the chunks main sent before it arrive afterwards.
  const run = client.run(
    "s1",
    (chunk) => seen.push(chunk),
    async () => ({ text: "hi" }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  client.receive({ id: "s1", chunk: { type: "meta", model: "resolved" } });
  client.receive({ id: "other", chunk: { type: "delta", text: "not mine" } });
  client.receive({ id: "s1", chunk: { type: "delta", text: "hi" } });
  let settled = false;
  void run.then(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the stream waits for its end marker");
  client.receive({ id: "s1", end: true });
  assert.deepEqual(await run, { text: "hi" });
  assert.deepEqual(seen, [
    { type: "meta", model: "resolved" },
    { type: "delta", text: "hi" },
  ]);
  // Once settled, late messages for the stream are ignored and the ID can run again.
  client.receive({ id: "s1", chunk: { type: "delta", text: "late" } });
  assert.equal(seen.length, 2);
  const again = client.run(
    "s1",
    () => {},
    async () => "again",
  );
  client.receive({ id: "s1", end: true });
  assert.equal(await again, "again");
});

test("a failed stream rejects after its end marker, and IDs stay unique while running", async () => {
  const { createStreamClient } = await loadStreamClient();
  const client = createStreamClient();
  const seen = [];
  const run = client.run(
    "s2",
    (chunk) => seen.push(chunk),
    async () => {
      throw new Error("Provider failed");
    },
  );
  await assert.rejects(
    client.run(
      "s2",
      () => {},
      async () => "duplicate",
    ),
    /Stream s2 is already running/,
  );
  client.receive({ id: "s2", chunk: { type: "tool", id: "t1", status: "error" } });
  client.receive({ id: "s2", end: true });
  await assert.rejects(run, /Provider failed/);
  assert.deepEqual(seen, [{ type: "tool", id: "t1", status: "error" }]);
});

test(
  "a failure that never reached main rejects after a short wait for its end marker",
  { timeout: 5000 },
  async () => {
    const { createStreamClient } = await loadStreamClient();
    const client = createStreamClient(20);
    const failing = () =>
      client.run(
        "s3",
        () => {},
        async () => {
          throw new Error("An object could not be cloned.");
        },
      );
    await assert.rejects(failing(), /could not be cloned/);
    // The stream is gone, so the same ID can run again.
    await assert.rejects(failing(), /could not be cloned/);
  },
);

async function loadPreload() {
  const result = await build({
    entryPoints: [path.join(root, "electron/preload.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fixture-electron",
        setup(api) {
          api.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "fixture",
          }));
          api.onLoad({ filter: /^electron$/, namespace: "fixture" }, () => ({
            contents: `const f = globalThis.__dayboardPreloadFixture;
              export const contextBridge = f.contextBridge;
              export const ipcRenderer = f.ipcRenderer;`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const listeners = new Map();
  const invokes = [];
  const fixture = {
    exposed: {},
    contextBridge: { exposeInMainWorld: (name, api) => (fixture.exposed[name] = api) },
    ipcRenderer: {
      on: (channel, listener) => listeners.set(channel, listener),
      send: () => {},
      invoke: (channel, request) =>
        new Promise((resolve, reject) => invokes.push({ channel, request, resolve, reject })),
    },
  };
  globalThis.__dayboardPreloadFixture = fixture;
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const deliver = (message) => listeners.get("dayboard:stream:chunk")({}, message);
  return { bridge: fixture.exposed.dayboard, invokes, deliver };
}

test(
  "the preload's stream keeps chunks that arrive after its reply, and never hangs",
  { timeout: 5000 },
  async () => {
    const { bridge, invokes, deliver } = await loadPreload();
    const seen = [];
    const run = bridge.ipc.stream("ai:assistant", { system: "s" }, (chunk) => seen.push(chunk), {
      cancellationId: "p1",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(invokes[0].channel, "dayboard:stream:start");
    assert.deepEqual(invokes[0].request, {
      id: "p1",
      channel: "ai:assistant",
      args: { system: "s" },
    });
    invokes[0].resolve({ text: "hi" });
    await new Promise((resolve) => setImmediate(resolve));
    deliver({ id: "p1", chunk: { type: "meta", model: "resolved" } });
    deliver({ id: "p1", end: true });
    assert.deepEqual(await run, { text: "hi" });
    assert.deepEqual(seen, [{ type: "meta", model: "resolved" }]);

    // An invoke that fails in the renderer gets no end marker from main, and still rejects.
    const failed = bridge.ipc.stream("ai:assistant", {}, () => {}, { cancellationId: "p2" });
    await new Promise((resolve) => setImmediate(resolve));
    invokes[1].reject(new Error("An object could not be cloned."));
    await assert.rejects(failed, /could not be cloned/);
  },
);
