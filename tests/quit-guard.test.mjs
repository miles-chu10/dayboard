import assert from "node:assert/strict";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../main/services/quit-guard.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createSaveQuitGuard } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("normal quit waits for saved state and ignores duplicate quit requests", async () => {
  let finish;
  let prevented = 0;
  let resumed = 0;
  const saved = new Promise((resolve) => {
    finish = resolve;
  });
  const guard = createSaveQuitGuard({
    drain: () => saved,
    confirmUnfinished: () => assert.fail("completed saves must not show a warning"),
    resumeQuit: () => {
      resumed += 1;
    },
  });
  const event = {
    preventDefault() {
      prevented += 1;
    },
  };
  const first = guard(event);
  await guard(event);
  assert.equal(resumed, 0);
  finish();
  await first;
  assert.equal(resumed, 1);
  await guard(event);
  assert.equal(prevented, 2);
  assert.equal(resumed, 1);
});

test("unfinished saves keep the app open unless the user chooses to quit", async () => {
  let resumed = 0;
  let warnings = 0;
  let resumedOperations = 0;
  const guard = createSaveQuitGuard({
    drain: () => new Promise(() => {}),
    confirmUnfinished: async () => ++warnings === 2,
    resumeQuit: () => {
      resumed += 1;
    },
    onCancelled: () => {
      resumedOperations += 1;
    },
    timeoutMs: 5,
  });
  await guard({ preventDefault() {} });
  assert.equal(resumed, 0);
  assert.equal(resumedOperations, 1);
  await guard({ preventDefault() {} });
  assert.equal(warnings, 2);
  assert.equal(resumed, 1);
  assert.equal(resumedOperations, 1);
});

test("a prepared update owns its quit; a failed preparation uses the normal save guard", async () => {
  let phase = "downloaded";
  let prevented = 0;
  let drains = 0;
  let resumed = 0;
  const guard = createSaveQuitGuard({
    isUpdateInstallReady: () => phase === "installing",
    drain: async () => {
      drains += 1;
    },
    confirmUnfinished: () => assert.fail("completed saves must not warn"),
    resumeQuit: () => {
      resumed += 1;
    },
  });
  const event = {
    preventDefault() {
      prevented += 1;
    },
  };
  phase = "installing";
  await guard(event);
  assert.equal(prevented, 0);
  assert.equal(drains, 0);
  assert.equal(resumed, 0);
  phase = "error";
  await guard(event);
  assert.equal(prevented, 1);
  assert.equal(drains, 1);
  assert.equal(resumed, 1);
});
