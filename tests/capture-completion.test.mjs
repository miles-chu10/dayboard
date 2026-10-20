import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { completeCapture } = await loadTs("main/services/capture/capture-completion.ts");

test("a stalled capture aborts and settles even if the provider ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const late = Promise.withResolvers();
  const pending = completeCapture((value) => {
    signal = value;
    return late.promise;
  });
  const rejected = assert.rejects(pending, /timed out.*manually/);
  t.mock.timers.tick(3 * 60_000);
  await rejected;
  assert.equal(signal.aborted, true);
  late.resolve({ text: "Late draft must not be created" });
  await assert.rejects(pending, /timed out/);
});

test("a provider that resolves on abort cannot turn timeout into success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = completeCapture(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ text: "late" }));
      }),
  );
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(3 * 60_000);
  await rejected;
});

test("a completed capture clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  assert.equal(
    await completeCapture(async (value) => {
      signal = value;
      return { text: "draft" };
    }),
    "draft",
  );
  t.mock.timers.tick(3 * 60_000);
  assert.equal(signal.aborted, false);
});

test("provider failure is preserved and clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  await assert.rejects(
    completeCapture(async (value) => {
      signal = value;
      throw new Error("Provider unavailable");
    }),
    /Provider unavailable/,
  );
  t.mock.timers.tick(3 * 60_000);
  assert.equal(signal.aborted, false);
});
