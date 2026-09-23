import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test(
  "Swift input helpers validate dates and list selection without Reminders access",
  { skip: process.platform !== "darwin" && "EventKit fixture requires macOS" },
  () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "dayboard-reminders-test-"));
    try {
      const output = path.join(tmp, "fixture");
      const compile = spawnSync(
        "xcrun",
        [
          "swiftc",
          path.join(root, "native/reminders-helper/RemindersInput.swift"),
          path.join(root, "tests/native-reminders-fixture.swift"),
          "-o",
          output,
        ],
        { encoding: "utf8" },
      );
      assert.equal(compile.status, 0, compile.stderr);
      const run = spawnSync(output, [], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /native Reminders input fixture passed/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);
