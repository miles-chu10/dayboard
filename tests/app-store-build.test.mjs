import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { verifyMasApp } from "../scripts/package-mas.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/loader.mjs");
let sequence = 0;

// Synthetic platform boundary; child_process throws so any spawn in the App Store edition fails.
const boundaries = {
  platform: `
    export const app = { getPath: () => "/synthetic-nonexistent-user-data" };
    export const safeStorage = { encryptString: async (v) => Buffer.from(v), decryptString: async (v) => String(v) };
    export const ipcMain = { handle() {}, handleStream() {}, broadcast() {} };
    export const logger = { error() {}, warn() {}, info() {} };`,
  child_process: `
    const refuse = () => { throw new Error("spawned a process"); };
    export const spawn = refuse;
    export const execFile = refuse;`,
};

async function load(entry, masBuild) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    define: { __DAYBOARD_MAS_BUILD__: String(masBuild) },
    // CommonJS dependencies (the MCP SDK's cross-spawn) require Node built-ins.
    banner: {
      js: `import { createRequire as __fixtureRequire } from "node:module"; const require = __fixtureRequire(${JSON.stringify(path.join(root, "package.json"))});`,
    },
    plugins: [
      {
        name: "app-store-boundaries",
        setup(api) {
          api.onResolve({ filter: /(?:^|\/)platform\/index\.(?:js|ts)$/ }, () => ({
            path: "platform",
            namespace: "app-store",
          }));
          if (masBuild) {
            api.onResolve({ filter: /^(?:node:)?child_process$/ }, () => ({
              path: "child_process",
              namespace: "app-store",
            }));
          }
          api.onLoad({ filter: /.*/, namespace: "app-store" }, (args) => ({
            contents: boundaries[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const source = `${result.outputFiles[0].text}\n// fixture-${sequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const savedSubscription = { ai: { enabled: true, providerChosen: true, provider: "claude" } };
const stdioServer = { name: "local", transport: "stdio", command: "npx", args: ["server"] };
const httpServer = { name: "remote", transport: "http", url: "https://mcp.example.invalid/mcp" };

test("the App Store edition offers API-key providers only and refuses stdio MCP servers", async () => {
  const store = await load("main/services/settings-store.ts", true);
  assert.equal(store.DEFAULT_SETTINGS.ai.provider, "openai");
  const settings = store.normalizeSettings(savedSubscription);
  assert.equal(settings.ai.provider, "openai");
  assert.equal(settings.ai.providerChosen, false);
  assert.equal(settings.ai.enabled, false);
  assert.equal(
    store.normalizeSettings({ ai: { assistantProvider: "codex" } }).ai.assistantProvider,
    "",
  );
  assert.throws(() => store.normalizeMcpServer(stdioServer), /by URL only/);
  assert.equal(store.normalizeMcpServer(httpServer).transport, "http");
});

test("the standalone edition keeps subscription providers and stdio MCP servers", async () => {
  const store = await load("main/services/settings-store.ts", false);
  assert.equal(store.DEFAULT_SETTINGS.ai.provider, "claude");
  const settings = store.normalizeSettings(savedSubscription);
  assert.equal(settings.ai.provider, "claude");
  assert.equal(settings.ai.providerChosen, true);
  assert.equal(store.normalizeMcpServer(stdioServer).transport, "stdio");
});

test("the App Store edition never spawns CLIs, a login shell or a preferences reader", async () => {
  const { resolveCli } = await load("main/services/ai/cli-binaries.ts", true);
  for (const provider of ["claude", "codex", "gemini", "muse"]) {
    assert.equal(await resolveCli(provider, true), null);
  }
  const shell = await load("main/services/shell-env.ts", true);
  assert.equal(await shell.runLoginShell("echo synthetic"), "");
  const { readSymbolicHotkeys } = await load("main/system-panels/symbolic-hotkeys.ts", true);
  assert.equal(await readSymbolicHotkeys(), null);
  const { testMcpServer } = await load("main/services/ai/mcp-client.ts", true);
  const result = await testMcpServer({
    ...stdioServer,
    id: "s",
    enabled: true,
    env: {},
    url: "",
    headers: {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /by URL only/);
});

test("updates name the App Store when the in-app updater is unavailable", async () => {
  const { createAppUpdates } = await load("main/services/app-updates.ts", true);
  const updates = createAppUpdates({
    isOfficialRelease: false,
    isPackaged: true,
    isDemo: () => false,
    currentVersion: "1.3.0",
    unavailableMessage: "The Mac App Store keeps DayBoard up to date.",
    loadUpdater: () => assert.fail("the updater must not load"),
    prepareForInstall: async () => {},
    resumeAfterInstallFailure: () => {},
  });
  const state = updates.status();
  assert.equal(state.phase, "unavailable");
  assert.equal(state.message, "The Mac App Store keeps DayBoard up to date.");
});

function loadConfig(env) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      tsx,
      "--input-type=module",
      "-e",
      `const { default: config } = await import(${JSON.stringify(path.join(root, "electron.vite.config.ts"))});
       console.log(JSON.stringify({ main: config.main.define, renderer: config.renderer.define }));`,
    ],
    { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 30_000 },
  );
}

test("App Store builds require licensing off and refuse release, test and QA flags", () => {
  for (const env of [
    { DAYBOARD_MAS: "1" },
    { DAYBOARD_MAS: "1", DAYBOARD_LICENSE: "off", DAYBOARD_RELEASE: "1" },
    { DAYBOARD_MAS: "1", DAYBOARD_LICENSE: "off", DAYBOARD_TEST: "1" },
    { DAYBOARD_MAS: "1", DAYBOARD_LICENSE: "off", DAYBOARD_QA: "1" },
  ]) {
    const result = loadConfig(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, /App Store builds require|QA builds cannot/);
  }
  const result = loadConfig({ DAYBOARD_MAS: "1", DAYBOARD_LICENSE: "off" });
  assert.equal(result.status, 0, result.stderr);
  const { main, renderer } = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(main.__DAYBOARD_MAS_BUILD__, "true");
  assert.equal(renderer.__DAYBOARD_MAS_BUILD__, "true");
  assert.equal(main["process.env.DAYBOARD_LICENSE"], '"off"');
  assert.equal(main["process.env.DAYBOARD_RELEASE"], '""');
  const standard = loadConfig({});
  assert.equal(standard.status, 0, standard.stderr);
  assert.equal(
    JSON.parse(standard.stdout.trim().split("\n").at(-1)).main.__DAYBOARD_MAS_BUILD__,
    "false",
  );
});

test("App Store packaging accepts only a sandboxed, profiled app without CLI or updater code", async (t) => {
  const app = await mkdtemp(path.join(tmpdir(), "dayboard-mas-"));
  t.after(() => rm(app, { recursive: true, force: true }));
  await mkdir(path.join(app, "Contents"));
  const sandboxed = "<dict><key>com.apple.security.app-sandbox</key><true/></dict>";
  const clean = { entitlements: sandboxed, asarEntries: ["/out/main/index.js"], unpacked: [] };
  assert.throws(() => verifyMasApp(app, clean), /no embedded provisioning profile/);
  await writeFile(path.join(app, "Contents", "embedded.provisionprofile"), "synthetic");
  verifyMasApp(app, clean);
  assert.throws(
    () => verifyMasApp(app, { ...clean, entitlements: "<dict></dict>" }),
    /App Sandbox entitlement/,
  );
  assert.throws(
    () => verifyMasApp(app, { ...clean, asarEntries: ["/node_modules/node-pty/package.json"] }),
    /must not bundle node-pty/,
  );
  assert.throws(
    () => verifyMasApp(app, { ...clean, unpacked: ["electron-updater"] }),
    /must not unpack electron-updater/,
  );
  assert.ok(
    (await readFile(path.join(root, "build/entitlements.mas.inherit.plist"), "utf8")).includes(
      "com.apple.security.inherit",
    ),
  );
});
