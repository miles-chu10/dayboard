import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../shared/google-oauth-build.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createGoogleOAuthClientPlugin } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const moduleId = "/fixture/main/services/google-oauth-app-client.ts";
const fixture = { clientId: "fixture.apps.googleusercontent.com", clientSecret: "fixture-only" };

function withClient(contents, options, callback) {
  const directory = mkdtempSync(join(tmpdir(), "dayboard-google-build-"));
  const file = join(directory, "client.json");
  if (contents !== null) writeFileSync(file, contents);
  const warnings = [];
  const watched = [];
  const plugin = createGoogleOAuthClientPlugin({
    file,
    required: false,
    testBuild: false,
    ...options,
  });
  const context = {
    error(message) {
      throw new Error(message);
    },
    warn(message) {
      warnings.push(message);
    },
    addWatchFile(path) {
      watched.push(path);
    },
  };
  try {
    callback({ load: (id = moduleId) => plugin.load.call(context, id), warnings, watched, file });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a Google-enabled community beta embeds its existing Desktop client", () => {
  withClient(JSON.stringify(fixture), { required: true }, ({ load, watched, file }) => {
    const source = load();
    assert.equal(
      source,
      `export const GOOGLE_APP_CLIENT_ID = "${fixture.clientId}";\nexport const GOOGLE_APP_CLIENT_SECRET = "${fixture.clientSecret}";\n`,
    );
    assert.deepEqual(watched, [file]);
    assert.equal(load("/fixture/main/index.ts"), null);
  });
});

test("Google-enabled builds fail when the client is missing or invalid", () => {
  for (const contents of [
    null,
    "null",
    "{}",
    JSON.stringify({ ...fixture, clientSecret: " " }),
    JSON.stringify({ ...fixture, clientId: "invalid" }),
  ]) {
    withClient(contents, { required: true }, ({ load }) => {
      assert.throws(load, /requires a valid Desktop OAuth client/);
    });
  }
});

test("test builds never read or embed available client configuration", () => {
  withClient("malformed fixture", { testBuild: true }, ({ load, watched }) => {
    assert.equal(
      load(),
      'export const GOOGLE_APP_CLIENT_ID = ""; export const GOOGLE_APP_CLIENT_SECRET = "";',
    );
    assert.deepEqual(watched, []);
  });
});

test("Google-enabled builds reject the test mode", () => {
  withClient(null, { required: true, testBuild: true }, ({ load }) => {
    assert.throws(load, /cannot use DAYBOARD_TEST=1/);
  });
});

test("optional unconfigured builds warn once and malformed JSON never reaches diagnostics", () => {
  withClient(null, {}, ({ load, warnings }) => {
    assert.equal(load(), null);
    assert.equal(load(), null);
    assert.equal(warnings.length, 1);
  });
  withClient("private-fixture-text", { required: true }, ({ load }) => {
    assert.throws(
      load,
      (error) =>
        /valid Desktop OAuth client JSON/.test(error.message) &&
        !error.message.includes("private-fixture-text"),
    );
  });
});
