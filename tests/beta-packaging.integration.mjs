import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  snapshotPackagingOutputs,
  withPackagingWorkspace,
} from "./helpers/packaging-workspace.mjs";

// Real macOS packaging, with a synthetic Desktop client and no live integrations.
// All source, dependency rebuilds and outputs live in a disposable private copy.
test(
  "beta app, DMG and ZIP retain their enforced configuration",
  {
    skip: process.platform !== "darwin" ? "Requires macOS packaging tools" : false,
    timeout: 900_000,
  },
  async (t) => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const before = await snapshotPackagingOutputs(root);
    try {
      await withPackagingWorkspace(root, async ({ directory, run }) => {
        const file = path.join(directory, "client.json");
        await writeFile(
          file,
          JSON.stringify({
            clientId: "packaging-fixture.apps.googleusercontent.com",
            clientSecret: "synthetic-only",
          }),
        );
        const status = await run("npm", ["run", "package:preview"], {
          env: {
            ...process.env,
            DAYBOARD_GOOGLE_OAUTH_FILE: file,
            DAYBOARD_LICENSE: "on",
            DAYBOARD_REQUIRE_GOOGLE: "0",
            DAYBOARD_TEST: "0",
            DAYBOARD_RELEASE: "0",
          },
          stdio: "inherit",
          signal: t.signal,
        });
        assert.equal(status, 0, "The real beta packaging/verification path must succeed.");
      });
    } finally {
      assert.deepEqual(
        await snapshotPackagingOutputs(root),
        before,
        "Fixture packaging must preserve the checkout's out/, release/ and native helper.",
      );
    }
    console.log(
      "Packaging isolation verified: original out/, release/ and resources/bin unchanged.",
    );
  },
);
