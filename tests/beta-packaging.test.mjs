import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";
import { verifyBetaApp, verifyBetaBuild } from "../scripts/verify-beta-package.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const client = { clientId: "fixture.apps.googleusercontent.com", clientSecret: "synthetic-only" };

async function fixture(t, clientContents = JSON.stringify(client)) {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-beta-path-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "scripts"));
  // Exercise the actual nested npm packaging commands; replace only the native
  // build/archive boundaries. Vite uses the repository's real configuration.
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      type: "module",
      main: pkg.main,
      scripts: {
        ...pkg.scripts,
        build: `node --import ${JSON.stringify(path.join(root, "node_modules/tsx/dist/loader.mjs"))} build.mjs`,
        postbuild: 'node -e ""',
      },
    }),
  );
  await writeFile(
    path.join(directory, "entry.ts"),
    `
    import { GOOGLE_APP_CLIENT_ID, GOOGLE_APP_CLIENT_SECRET } from ${JSON.stringify(path.join(root, "main/services/google-oauth-app-client.ts"))};
    import { isLicenseGatingDisabled } from ${JSON.stringify(path.join(root, "main/services/license/config.ts"))};
    export const configuration = {
      googleConfigured: Boolean(GOOGLE_APP_CLIENT_ID && GOOGLE_APP_CLIENT_SECRET),
      licensingDisabled: isLicenseGatingDisabled(),
      updatesEnabled: process.env.DAYBOARD_RELEASE === "1",
      testBuild: __DAYBOARD_TEST_BUILD__,
    };
    export const lazy = () => import("./lazy.ts");
  `,
  );
  await writeFile(path.join(directory, "lazy.ts"), "export const fixture = true;");
  await writeFile(
    path.join(directory, "build.mjs"),
    `
    import { appendFileSync } from "node:fs";
    import { build } from ${JSON.stringify(path.join(root, "node_modules/vite/dist/node/index.js"))};
    import config from ${JSON.stringify(path.join(root, "electron.vite.config.ts"))};
    appendFileSync("builds.jsonl", JSON.stringify({ license: process.env.DAYBOARD_LICENSE, google: process.env.DAYBOARD_REQUIRE_GOOGLE }) + "\\n");
    await build({
      configFile: false, logLevel: "silent", define: config.main.define, plugins: config.main.plugins,
      build: { outDir: "out/main", emptyOutDir: true, minify: false,
        rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } },
        lib: { entry: "entry.ts", formats: ["es"], fileName: () => "index.js" } }
    });
  `,
  );
  await writeFile(
    path.join(directory, "scripts/package-preview.mjs"),
    `
    import { readFileSync, writeFileSync } from "node:fs";
    import { verifyBetaBuild } from ${JSON.stringify(path.join(root, "scripts/verify-beta-package.mjs"))};
    verifyBetaBuild((name) => readFileSync("out/main/" + name));
    const { configuration } = await import("../out/main/index.js");
    writeFileSync("packaged.json", JSON.stringify(configuration));
  `,
  );
  const file = path.join(directory, "client.json");
  if (clientContents !== null) await writeFile(file, clientContents);
  const env = {
    PATH: process.env.PATH,
    npm_config_cache: path.join(directory, "npm-cache"),
    DAYBOARD_GOOGLE_OAUTH_FILE: file,
    DAYBOARD_LICENSE: "on",
    DAYBOARD_REQUIRE_GOOGLE: "0",
  };
  const run = (script, overrides = {}) =>
    spawnSync("npm", ["run", script], {
      cwd: directory,
      env: { ...env, ...overrides },
      encoding: "utf8",
      timeout: 30_000,
    });
  return { directory, run };
}

test("preview packaging independently rebuilds with beta flags and verifies its ASAR", async (t) => {
  const { directory, run } = await fixture(t);
  const first = run("build:beta");
  assert.equal(first.status, 0, first.stderr);
  // This is a new process: no flag assignments from the prior build survive.
  const packaged = run("package:preview");
  assert.equal(packaged.status, 0, packaged.stderr);
  assert.deepEqual(
    (await readFile(path.join(directory, "builds.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse),
    [
      { license: "off", google: "1" },
      { license: "off", google: "1" },
    ],
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "packaged.json"), "utf8")), {
    googleConfigured: true,
    licensingDisabled: true,
    updatesEnabled: false,
    testBuild: false,
  });
  const proof = await readFile(path.join(directory, "out/main/beta-build.json"), "utf8");
  assert.ok(!proof.includes(client.clientId) && !proof.includes(client.clientSecret));
  const app = path.join(directory, "DayBoard.app");
  const resources = path.join(app, "Contents/Resources");
  await mkdir(resources, { recursive: true });
  const source = path.join(directory, "asar-input");
  await cp(path.join(directory, "out"), path.join(source, "out"), { recursive: true });
  await writeFile(path.join(source, "package.json"), JSON.stringify({ main: pkg.main }));
  await createPackage(source, path.join(resources, "app.asar"));
  assert.match(verifyBetaApp(app), /^[a-f0-9]{64}$/);

  await writeFile(path.join(source, "out/main/index.js"), "unconfigured replacement");
  await createPackage(source, path.join(resources, "app.asar"));
  assert.throws(() => verifyBetaApp(app), /Beta configuration verification failed/);
});

for (const [name, contents, overrides, error] of [
  ["missing client", null, {}, /requires a valid Desktop OAuth client/],
  ["invalid client", "{}", {}, /requires a valid Desktop OAuth client/],
  ["malformed client", "private-sentinel", {}, /valid Desktop OAuth client JSON/],
  ["test mode", JSON.stringify(client), { DAYBOARD_TEST: "1" }, /cannot use DAYBOARD_TEST=1/],
  ["release mode", JSON.stringify(client), { DAYBOARD_RELEASE: "1" }, /Release packaging requires/],
]) {
  test(`packaging fails before archive creation for ${name}`, async (t) => {
    const { directory, run } = await fixture(t, contents);
    const result = run("package:preview", overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.ok(!result.stderr.includes("private-sentinel"));
    await assert.rejects(readFile(path.join(directory, "packaged.json")), { code: "ENOENT" });
  });
}

test("packaging rejects absent, unsafe or stale build proof without disclosing its contents", () => {
  for (const contents of [
    "private-sentinel",
    "{}",
    JSON.stringify({
      schema: 1,
      googleConfigured: true,
      licensingDisabled: true,
      updatesEnabled: false,
      testBuild: false,
      files: { "index.js": "0".repeat(64), "../escape.js": "0".repeat(64) },
    }),
  ]) {
    assert.throws(
      () => verifyBetaBuild(() => Buffer.from(contents)),
      (error) =>
        /Beta configuration verification failed/.test(error.message) &&
        !error.message.includes(contents),
    );
  }
});
