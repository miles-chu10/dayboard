import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "../scripts/with-timeout.mjs";

test("a Settings IPC that never settles fails within the screenshot timeout", async () => {
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 20, "Settings startup timed out"),
    /Settings startup timed out/,
  );
});

test("a completed Settings request retains its result", async () => {
  assert.equal(await withTimeout(async () => "opened", 1000, "timeout"), "opened");
});

test("a failed Settings request preserves the failure", async () => {
  const failure = new Error("Fixture renderer load failed");
  await assert.rejects(
    withTimeout(() => Promise.reject(failure), 1000, "timeout"),
    (error) => error === failure,
  );
});
