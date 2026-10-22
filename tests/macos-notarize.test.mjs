import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import notarizeApp, { stapleWithRetries } from "../scripts/notarize.mjs";

// Synthetic only: these tests never run xcrun or contact Apple.
const env = {
  APPLE_API_KEY: "/tmp/key.p8",
  APPLE_API_KEY_ID: "KEY1234567",
  APPLE_API_ISSUER: "issuer",
};
const context = {
  electronPlatformName: "darwin",
  appOutDir: "/build/mac-arm64",
  packager: { appInfo: { productFilename: "DayBoard" } },
};
const appPath = "/build/mac-arm64/DayBoard.app";

test("stapling retries with growing delays until it succeeds", async () => {
  const waits = [];
  let calls = 0;
  const attempt = await stapleWithRetries(appPath, {
    run: (path) => {
      assert.equal(path, appPath);
      calls += 1;
      return { ok: calls === 3, output: "The network connection was lost." };
    },
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(attempt, 3);
  assert.deepEqual(waits, [15_000, 30_000]);
});

test("stapling gives up after the last attempt with stapler's output", async () => {
  let calls = 0;
  await assert.rejects(
    stapleWithRetries(appPath, {
      attempts: 3,
      run: () => ({ ok: false, output: `Error 68 (${(calls += 1)})` }),
      wait: async () => undefined,
    }),
    /Stapling failed after 3 attempts\.\n\nError 68 \(3\)/,
  );
  assert.equal(calls, 3);
});

test("the hook notarizes the packaged app with the App Store Connect key", async () => {
  const submitted = [];
  await notarizeApp(context, {
    env,
    submit: async (options) => submitted.push(options),
    stapleApp: async () => assert.fail("an accepted, stapled app needs no retry"),
  });
  assert.deepEqual(submitted, [
    {
      tool: "notarytool",
      appPath,
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER,
    },
  ]);
});

test("only a failed staple is retried; a rejected notarization still fails the build", async () => {
  const stapled = [];
  await notarizeApp(context, {
    env,
    submit: async () => {
      throw new Error("Failed to staple your application with code: 68");
    },
    stapleApp: async (path) => stapled.push(path),
  });
  assert.deepEqual(stapled, [appPath]);

  await assert.rejects(
    notarizeApp(context, {
      env,
      submit: async () => {
        throw new Error("Failed to notarize via notarytool");
      },
      stapleApp: async () => assert.fail("a rejected submission must not be stapled"),
    }),
    /Failed to notarize/,
  );
});

test("the hook requires the notarization key and skips other platforms", async () => {
  await assert.rejects(
    notarizeApp(context, { env: { ...env, APPLE_API_ISSUER: "" }, submit: async () => undefined }),
    /requires APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER/,
  );
  await notarizeApp(
    { ...context, electronPlatformName: "linux" },
    { env: {}, submit: async () => assert.fail("only macOS builds are notarized") },
  );
});

test("both signed workflows notarize through the hook, not the built-in single staple", async () => {
  for (const name of ["macos-beta.yml", "macos-release.yml"]) {
    const workflow = await readFile(
      new URL(`../.github/workflows/${name}`, import.meta.url),
      "utf8",
    );
    assert.match(workflow, /--config\.afterSign=\.\/scripts\/notarize\.mjs/, name);
    assert.doesNotMatch(workflow, /--config\.mac\.notarize=true/, name);
  }
  const config = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(config, /^\s+notarize: false$/m);
});
