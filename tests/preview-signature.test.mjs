import assert from "node:assert/strict";
import test from "node:test";
import { assertAdHocSignature } from "../scripts/package-preview.mjs";

const adHoc = "CodeDirectory v=20400 flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set\n";

test("preview accepts a literal ad-hoc signature", () => {
  assert.doesNotThrow(() => assertAdHocSignature(adHoc));
});

test("preview rejects a hyphenated Developer ID signature", () => {
  assert.throws(
    () =>
      assertAdHocSignature(
        "Authority=Developer ID Application: Preview-Test (EXAMPLE)\nTeamIdentifier=EXAMPLE\n",
      ),
    /ad-hoc signature/,
  );
});

test("preview rejects missing signatures and hardened runtime", () => {
  assert.throws(() => assertAdHocSignature(""), /ad-hoc signature/);
  assert.throws(
    () => assertAdHocSignature(adHoc.replace("0x2(adhoc)", "0x10002(adhoc,runtime)")),
    /hardened runtime/,
  );
});

test("preview rejects a signing team even when an ad-hoc marker is present", () => {
  assert.throws(() => assertAdHocSignature(adHoc.replace("not set", "EXAMPLE")), /signing team/);
});
