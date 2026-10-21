import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPackage } from "@electron/asar";
import { build } from "esbuild";
import { verifyQaApp, verifyQaBuild } from "../scripts/verify-qa-package.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-qa-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  await writeFile(path.join(directory, "client.json"), "invalid-private-input-must-not-be-read");
  await writeFile(
    path.join(directory, "entry.ts"),
    `
    import { GOOGLE_APP_CLIENT_ID, GOOGLE_APP_CLIENT_SECRET } from ${JSON.stringify(path.join(root, "main/services/google-oauth-app-client.ts"))};
    export const configuration = { qa: __DAYBOARD_QA_BUILD__, test: __DAYBOARD_TEST_BUILD__,
      google: Boolean(GOOGLE_APP_CLIENT_ID || GOOGLE_APP_CLIENT_SECRET),
      license: process.env.DAYBOARD_LICENSE, release: process.env.DAYBOARD_RELEASE,
      licenseUrl: process.env.DAYBOARD_LICENSE_API_URL };
    export const lazy = () => import("./lazy.ts");
  `,
  );
  await writeFile(path.join(directory, "lazy.ts"), "export const value = true;");
  await writeFile(
    path.join(directory, "build.mjs"),
    `
    import { build } from ${JSON.stringify(path.join(root, "node_modules/vite/dist/node/index.js"))};
    import config from ${JSON.stringify(path.join(root, "electron.vite.config.ts"))};
    await build({ configFile:false, logLevel:"silent", define:config.main.define, plugins:config.main.plugins,
      build:{ outDir:"out/main", emptyOutDir:true, minify:false,
        rollupOptions:{ output:{ chunkFileNames:"chunks/[name]-[hash].js" } },
        lib:{ entry:"entry.ts", formats:["es"], fileName:()=>"index.js" } } });
  `,
  );
  return {
    directory,
    run(overrides = {}) {
      return spawnSync(
        process.execPath,
        ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), "build.mjs"],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            DAYBOARD_QA: "1",
            DAYBOARD_GOOGLE_OAUTH_FILE: path.join(directory, "client.json"),
            DAYBOARD_LICENSE_API_URL: "https://private-license-sentinel.example",
            ...overrides,
          },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
    },
  };
}

test("actual QA build omits credentials and verifies exact packaged main code", async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const main = path.join(f.directory, "out/main");
  const configuration = (await import(pathToFileURL(path.join(main, "index.js")))).configuration;
  assert.deepEqual(configuration, {
    qa: true,
    test: false,
    google: false,
    license: "off",
    release: "",
    licenseUrl: "",
  });
  const files = new Map();
  const proof = JSON.parse(await readFile(path.join(main, "qa-build.json"), "utf8"));
  files.set("qa-build.json", Buffer.from(JSON.stringify(proof)));
  for (const name of Object.keys(proof.files))
    files.set(name, await readFile(path.join(main, name)));
  verifyQaBuild((name) => files.get(name));
  assert.doesNotMatch(files.get("index.js").toString(), /private.*sentinel|invalid-private-input/);
  const source = path.join(f.directory, "asar-input");
  await cp(path.join(f.directory, "out"), path.join(source, "out"), { recursive: true });
  const metadata = { main: "out/main/index.js", name: "dayboard-qa", productName: "DayBoard QA" };
  await writeFile(path.join(source, "package.json"), JSON.stringify(metadata));
  const app = path.join(f.directory, "DayBoard QA.app");
  const resources = path.join(app, "Contents/Resources");
  await mkdir(resources, { recursive: true });
  await createPackage(source, path.join(resources, "app.asar"));
  verifyQaApp(app);
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ ...metadata, productName: "DayBoard" }),
  );
  await createPackage(source, path.join(resources, "app.asar"));
  assert.throws(() => verifyQaApp(app), /Unexpected QA application entry or identity/);
  await writeFile(path.join(source, "package.json"), JSON.stringify(metadata));
  await writeFile(path.join(source, "out/main/index.js"), "ordinary-production-replacement");
  await createPackage(source, path.join(resources, "app.asar"));
  assert.throws(() => verifyQaApp(app), /QA isolation verification failed/);
});

for (const flag of ["DAYBOARD_TEST", "DAYBOARD_RELEASE", "DAYBOARD_REQUIRE_GOOGLE"]) {
  test(`QA build rejects ${flag}`, async (t) => {
    const f = await fixture(t);
    const result = f.run({ [flag]: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /QA builds cannot enable/);
    await assert.rejects(readFile(path.join(f.directory, "out/main/qa-build.json")), {
      code: "ENOENT",
    });
  });
}

test("QA packaging rejects missing, malformed and mismatched proofs", () => {
  for (const proof of [
    null,
    "private-sentinel",
    {},
    {
      schema: 1,
      qaBuild: false,
      demoOnly: true,
      googleConfigured: false,
      licensingDisabled: true,
      updatesEnabled: false,
      files: { "index.js": "0".repeat(64) },
    },
  ]) {
    assert.throws(
      () => verifyQaBuild(() => Buffer.from(JSON.stringify(proof))),
      (error) =>
        /QA isolation verification failed/.test(error.message) &&
        !error.message.includes("private-sentinel"),
    );
  }
});

test("QA packaging preflights before builder and preserves its separate identity", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-qa-orchestration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  globalThis.__qaPackageCalls = calls;
  globalThis.__qaPackageReject = true;
  t.after(() => {
    delete globalThis.__qaPackageCalls;
    delete globalThis.__qaPackageReject;
  });
  const stubs = new Map([
    ["node:fs", 'export const readFileSync = () => Buffer.from("synthetic proof");'],
    [
      "node:child_process",
      `export const execFileSync = (...args) => { globalThis.__qaPackageCalls.push({verifySignature:args}); };
      export const spawnSync = () => ({status:0,stderr:"Signature=adhoc\\nTeamIdentifier=not set\\n"});`,
    ],
    [
      "@electron/osx-sign",
      "export const signAsync = async (options) => { globalThis.__qaPackageCalls.push({sign:options}); };",
    ],
    [
      "electron-builder",
      `export const Arch={arm64:"arm64"}; export const Platform={MAC:{createTarget:(target)=>target}};
      export const build=async(options)=>{globalThis.__qaPackageCalls.push({build:options});return [];};`,
    ],
    [
      "./verify-beta-package.mjs",
      `export function verifyBetaBuild(){throw Error("unexpected beta");} export const verifyBetaApp=verifyBetaBuild; export const verifyBetaArtifacts=verifyBetaBuild;`,
    ],
    [
      "./verify-qa-package.mjs",
      `export function verifyQaBuild(read){globalThis.__qaPackageCalls.push("preflight");read("qa-build.json");if(globalThis.__qaPackageReject)throw Error("synthetic stale proof");}
      export function verifyQaApp(app){globalThis.__qaPackageCalls.push({verifyApp:app});}`,
    ],
  ]);
  const result = await build({
    entryPoints: [path.join(root, "scripts/package-preview.mjs")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "qa-native-boundaries",
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) =>
            stubs.has(args.path) ? { path: args.path, namespace: "qa" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "qa" }, (args) => ({
            contents: stubs.get(args.path),
            loader: "js",
          }));
        },
      },
    ],
    define: { "process.platform": '"darwin"' },
  });
  const modulePath = path.join(directory, "package.mjs");
  await writeFile(modulePath, result.outputFiles[0].text);
  const { packagePreview } = await import(pathToFileURL(modulePath));
  await assert.rejects(packagePreview(false, true), /synthetic stale proof/);
  assert.deepEqual(calls, ["preflight"]);
  calls.length = 0;
  globalThis.__qaPackageReject = false;
  await packagePreview(false, true);
  assert.equal(calls[0], "preflight");
  assert.equal(calls.filter((call) => call.build).length, 1);
  const options = calls[1].build;
  assert.equal(options.publish, "never");
  assert.equal(options.config.appId, "com.mileschu.dayboard.qa");
  assert.equal(options.config.productName, "DayBoard QA");
  assert.deepEqual(options.config.extraMetadata, {
    name: "dayboard-qa",
    productName: "DayBoard QA",
  });
  assert.deepEqual(options.config.directories, { output: "release-qa" });
  assert.equal(options.config.mac.identity, null);
  assert.equal(options.config.mac.notarize, false);
  assert.match(calls[2].verifyApp, /release-qa\/mac-arm64\/DayBoard QA\.app$/);
  assert.equal(calls[3].sign.identity, "-");
});
