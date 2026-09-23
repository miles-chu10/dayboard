import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [path.join(root, "main/services/runtime-activity.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
let sequence = 0;

async function loadGate() {
  const source = `${bundle.outputFiles[0].text}\n// instance ${sequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("pause prevents new operations and drains work that started synchronously", async () => {
  const gate = await loadGate();
  const waiting = deferred();
  let starts = 0;
  const old = gate.runAppOperation(() => {
    starts++;
    return waiting.promise;
  });
  assert.equal(starts, 1);
  let drained = false;
  const pause = gate.pauseAndDrainAppOperations(100).then(() => {
    drained = true;
  });
  await assert.rejects(
    gate.runAppOperation(() => {
      starts++;
    }),
    /preparing to install/,
  );
  assert.equal(starts, 1);
  assert.equal(drained, false);
  waiting.resolve("finished");
  assert.equal(await old, "finished");
  await pause;
  assert.equal(drained, true);
  await assert.rejects(
    gate.runAppOperation(() => {
      starts++;
    }),
    /preparing to install/,
  );
  gate.resumeAppOperations();
  await gate.runAppOperation(() => {
    starts++;
  });
  assert.equal(starts, 2);
});

test("a drain timeout resumes the app and does not lose the pending operation", async () => {
  const gate = await loadGate();
  const waiting = deferred();
  const old = gate.runAppOperation(() => waiting.promise);
  await assert.rejects(gate.pauseAndDrainAppOperations(5), /still in progress/);
  assert.equal(await gate.runAppOperation(() => "usable"), "usable");
  waiting.resolve("done");
  assert.equal(await old, "done");
});

test("synchronous operation failure releases its slot and explicit resume rejects a drain", async () => {
  const gate = await loadGate();
  await assert.rejects(
    gate.runAppOperation(() => {
      throw new Error("operation failed");
    }),
    /operation failed/,
  );
  await gate.pauseAndDrainAppOperations();
  gate.resumeAppOperations();

  const waiting = deferred();
  const old = gate.runAppOperation(() => waiting.promise);
  const pause = gate.pauseAndDrainAppOperations(100);
  gate.resumeAppOperations();
  await assert.rejects(pause, /cancelled/);
  assert.equal(await gate.runAppOperation(() => "usable"), "usable");
  waiting.resolve();
  await old;
});
