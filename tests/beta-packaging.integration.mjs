import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Real macOS packaging, with a synthetic Desktop client and no live integrations.
// The fixture archives stay on the runner and must never be distributed.
test(
  "beta app, DMG and ZIP retain their enforced configuration",
  {
    skip: process.platform !== "darwin" ? "Requires macOS packaging tools" : false,
    timeout: 900_000,
  },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "dayboard-beta-fixture-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "client.json");
    await writeFile(
      file,
      JSON.stringify({
        clientId: "packaging-fixture.apps.googleusercontent.com",
        clientSecret: "synthetic-only",
      }),
    );
    const status = await new Promise((resolve, reject) => {
      const child = spawn("npm", ["run", "package:preview"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          DAYBOARD_GOOGLE_OAUTH_FILE: file,
          DAYBOARD_LICENSE: "on",
          DAYBOARD_REQUIRE_GOOGLE: "0",
          DAYBOARD_TEST: "0",
          DAYBOARD_RELEASE: "0",
        },
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(status, 0, "The real beta packaging/verification path must succeed.");
  },
);
