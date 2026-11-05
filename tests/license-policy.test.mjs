import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;

const result = await build({
  entryPoints: [path.join(root, "shared/license-policy.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { LicenseRequiredError, aiLockState, requiresLicenseAccess } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("only AI channels require a license; everyday editing and Quick Capture stay free", () => {
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

test("a license-guard rejection names the lock state; other errors name none", () => {
  for (const state of ["expired", "invalid", "network-error"]) {
    const error = new LicenseRequiredError(state);
    assert.equal(
      error.message,
      "License required for this action. Open Settings → License to continue.",
    );
    assert.equal(aiLockState(error), state);
  }
  // Checked by code, so an error from another bundle's copy of the class still counts.
  assert.equal(aiLockState({ code: "license-required", state: "expired" }), "expired");
  assert.equal(aiLockState({ code: "license-required", state: "trial" }), null);
  assert.equal(aiLockState(new Error("License status is not ready. Try again shortly.")), null);
  assert.equal(aiLockState("License required"), null);
  assert.equal(aiLockState(null), null);
});
