import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;

test("only AI channels require a license; everyday editing and Quick Capture stay free", async () => {
  const result = await build({
    entryPoints: [path.join(root, "shared/license-policy.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const { requiresLicenseAccess } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  for (const paid of ["ai:run", "ai:assistant", "assistant:transcribe", "memory:learn"]) {
    assert.equal(requiresLicenseAccess(paid), true, paid);
  }
  for (const free of [
    "tasks:create",
    "tasks:setCompleted",
    "reminders:update",
    "calendar:create",
    "agenda:createBlock",
    "agenda:setDuplicateLink",
    "mail:archive",
    // A manual capture never runs AI; capture-service.ts checks the license before an AI parse.
    "capture:submit",
    "capture:undo",
    "memory:add",
    "memory:delete",
    "notes:save",
    "usage:days",
  ]) {
    assert.equal(requiresLicenseAccess(free), false, free);
  }
});
