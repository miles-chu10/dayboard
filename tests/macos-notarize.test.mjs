import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import notarizeApp, { notarizeAndStaple, stapleWithRetries } from "../scripts/notarize.mjs";

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

test("the DMG is submitted and stapled with the same key and staple retry", async () => {
  const dmg = "/build/DayBoard-1.3.0-arm64.dmg";
  const submitted = [];
  await notarizeAndStaple(dmg, {
    env,
    submit: async (options) => submitted.push(options),
    staple: async () => assert.fail("an accepted, stapled DMG needs no retry"),
  });
  assert.deepEqual(submitted, [
    {
      tool: "notarytool",
      appPath: dmg,
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER,
    },
  ]);

  const stapled = [];
  await notarizeAndStaple(dmg, {
    env,
    submit: async () => {
      throw new Error("Failed to staple your application with code: 65");
    },
    staple: async (path) => stapled.push(path),
  });
  assert.deepEqual(stapled, [dmg]);

  await assert.rejects(
    notarizeAndStaple(dmg, {
      env,
      submit: async () => {
        throw new Error("Failed to notarize via notarytool: Invalid");
      },
      staple: async () => assert.fail("a rejected DMG must not be stapled"),
    }),
    /Failed to notarize via notarytool/,
  );
  await assert.rejects(
    notarizeAndStaple(dmg, {
      env: { ...env, APPLE_API_KEY: "" },
      submit: async () => assert.fail("nothing is submitted without the key"),
    }),
    /requires APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER/,
  );
});

test("both signed workflows notarize the app through the hook and then the DMG", async () => {
  for (const name of ["macos-beta.yml", "macos-release.yml"]) {
    const workflow = await readFile(
      new URL(`../.github/workflows/${name}`, import.meta.url),
      "utf8",
    );
    assert.match(workflow, /--config\.afterSign=\.\/scripts\/notarize\.mjs/, name);
    assert.doesNotMatch(workflow, /--config\.mac\.notarize=true/, name);
    // The DMG is notarized in the signing step, while the notarization key still exists.
    assert.match(
      workflow,
      /--config\.dmg\.sign=true\n\s+node scripts\/macos-release\.mjs notarize-dmg\n\s+- name: Remove temporary signing inputs\n/,
      name,
    );
  }
  const config = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(config, /^\s+notarize: false$/m);
});
