import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../main/services/quit-guard.ts", import.meta.url))],
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
  const saved = new Promise((resolve) => { finish = resolve; });
  const guard = createSaveQuitGuard({
    drain: () => saved,
    confirmUnfinished: () => assert.fail("completed saves must not show a warning"),
    resumeQuit: () => { resumed += 1; },
  });
  const event = { preventDefault() { prevented += 1; } };
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
  const guard = createSaveQuitGuard({
    drain: () => new Promise(() => {}),
    confirmUnfinished: async () => ++warnings === 2,
    resumeQuit: () => { resumed += 1; },
    timeoutMs: 5,
  });
  await guard({ preventDefault() {} });
  assert.equal(resumed, 0);
  await guard({ preventDefault() {} });
  assert.equal(warnings, 2);
  assert.equal(resumed, 1);
});
