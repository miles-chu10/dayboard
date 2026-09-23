import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

async function loadStreamRegistry() {
  const result = await build({
    entryPoints: [path.join(root, "main/platform/stream-registry.ts")],
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
