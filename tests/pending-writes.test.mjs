import assert from "node:assert/strict";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../main/services/pending-writes.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const pendingWrites = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("pending write drain waits for all writes and releases synchronous failures", async () => {
  let finish;
  const delayed = pendingWrites.trackPendingWrite(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(pendingWrites.hasPendingWrites(), true);
  let drained = false;
  const drain = pendingWrites.drainPendingWrites().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  await assert.rejects(
    pendingWrites.trackPendingWrite(() => {
      throw new Error("validation failed");
    }),
    /validation failed/,
  );
  assert.equal(pendingWrites.hasPendingWrites(), true);
  finish();
  await delayed;
  await drain;
  assert.equal(pendingWrites.hasPendingWrites(), false);
});

test("account changes exclude later writes and normal quit waits for the change", async () => {
  let finish;
  let providerCalls = 0;
  const changing = pendingWrites.trackAccountChange(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(pendingWrites.hasPendingWrites(), true);
  await assert.rejects(
    pendingWrites.trackPendingWrite(async () => {
      providerCalls++;
    }),
    /account connection/,
  );
  await assert.rejects(
    pendingWrites.trackAccountChange(async () => {}),
    /account connection/,
  );
  let drained = false;
  const drain = pendingWrites.drainPendingWrites().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(providerCalls, 0);
  finish();
  await changing;
  await drain;
  assert.equal(drained, true);
  assert.equal(
    await pendingWrites.trackPendingWrite(async () => "new-account-write"),
    "new-account-write",
  );
});

test("an existing provider write prevents account replacement and failure releases the gate", async () => {
  let finish;
  const saving = pendingWrites.trackPendingWrite(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await assert.rejects(
    pendingWrites.trackAccountChange(async () => {}),
    /current save/,
  );
  finish();
  await saving;
  await assert.rejects(
    pendingWrites.trackAccountChange(async () => {
      throw new Error("cancelled");
    }),
    /cancelled/,
  );
  assert.equal(pendingWrites.hasPendingWrites(), false);
  assert.equal(await pendingWrites.trackPendingWrite(async () => "still-usable"), "still-usable");
});
