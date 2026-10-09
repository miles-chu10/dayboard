import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

async function temp(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-isolation-integration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function stubPlugin(stubs) {
  return {
    name: "synthetic-startup-interfaces",
    setup(api) {
      api.onResolve({ filter: /.*/ }, (args) =>
        stubs.has(args.path) ? { path: args.path, namespace: "synthetic" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "synthetic" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

for (const mode of ["compiled test", "runtime demo"]) {
  test(`${mode} main entry stops before handlers, stores, single-instance lock or windows`, async (t) => {
    const directory = await temp(t);
    const normal = path.join(directory, "normal");
    await mkdir(normal);
    await writeFile(path.join(normal, "settings.json"), "synthetic untouched preferences");
    const stubs = new Map([
      [
        "electron",
        `export const app = globalThis.__app; export const BrowserWindow = {}; export const clipboard = {}; export const dialog = {}; export const Menu = {}; export const nativeImage = {}; export const nativeTheme = {}; export const shell = {};`,
      ],
      [
        "./ipc.js",
        `export const ipcMain = {}; export function registerBridgeIpc() { globalThis.__calls.push("bridge"); }`,
      ],
      ["./safe-storage.js", `export const safeStorage = {};`],
      ["./system-preferences.js", `export const systemPreferences = {};`],
      ["./logger.js", `export const logger = {};`],
      ["./reminders.js", `export const reminders = {};`],
      [
        "./oauth.js",
        `globalThis.__calls.push("platform-module-initialization"); export class OAuthService {}; export class OAuthTokenStateChangedError extends Error {};`,
      ],
      [
        "./handlers/index.js",
        `export function registerHandlers() { globalThis.__calls.push("handlers"); }`,
      ],
      [
        "./window.js",
        `export function acquireSingleInstanceLock() { globalThis.__calls.push("lock"); return true; }; export const createMainWindow = async () => { globalThis.__calls.push("window"); }; export const getMainWindow = () => null; export const setupApplicationMenu = () => { globalThis.__calls.push("menu"); };`,
      ],
      [
        "./services/mcp-http-server.js",
        `export const startMcpHttpServer = () => { globalThis.__calls.push("mcp"); };`,
      ],
      ["./services/agenda-store.js", `export const drainAgendaStore = async () => {};`],
      ["./handlers/productivity.js", `export const drainProductivityWrites = async () => {};`],
      ["./services/quit-guard.js", `export const createSaveQuitGuard = () => () => {};`],
      ["./services/pending-writes.js", `export const drainPendingWrites = async () => {};`],
      ["./services/settings-store.js", `export const drainSettingsStores = async () => {};`],
      ["./services/ai/attachments.js", `export const clearAttachmentPicks = () => {};`],
      ["./services/apple-reminders.js", `export const clearReminderIdentities = () => {};`],
      [
        "./platform/native-theme.js",
        `export const drainNativeThemeWrites = async () => {}; export const loadNativeTheme = async () => { globalThis.__calls.push("theme"); };`,
      ],
      [
        "./handlers/updates.js",
        `export const registerUpdateHandlers = () => { globalThis.__calls.push("updates"); return {}; };`,
      ],
      [
        "./services/runtime-activity.js",
        `export const pauseAndDrainAppOperations = async () => {}; export const resumeAppOperations = () => {};`,
      ],
    ]);
    const result = await build({
      entryPoints: [path.join(root, "main/index.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      define: { __DAYBOARD_TEST_BUILD__: String(mode === "compiled test") },
      plugins: [stubPlugin(stubs)],
    });
    await writeFile(path.join(directory, "main-fixture.mjs"), result.outputFiles[0].text);
    const driver = path.join(directory, "driver.mjs");
    await writeFile(
      driver,
      `
      globalThis.__calls = [];
      const { writeSync } = await import("node:fs");
      globalThis.__app = { getPath: () => process.argv[2], setPath() { globalThis.__calls.push("setPath"); }, exit(code) { globalThis.__calls.push("exit:" + code); writeSync(1, JSON.stringify({ rejected: true, calls: globalThis.__calls }) + "\\n"); process.exit(code); }, on() {}, whenReady() { globalThis.__calls.push("ready"); return Promise.resolve(); } };
      try { await import("./main-fixture.mjs"); console.log(JSON.stringify({ rejected: false, calls: globalThis.__calls })); }
      catch (error) { globalThis.__calls.push("native-continuation"); console.log(JSON.stringify({ rejected: true, calls: globalThis.__calls, error: error.message })); }
    `,
    );
    const child = spawnSync(process.execPath, [driver, normal], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        ...(mode === "runtime demo" ? { DAYBOARD_DEMO: "1" } : {}),
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(child.status, 1, child.stderr);
    const actual = JSON.parse(child.stdout.trim());
    assert.equal(actual.rejected, true);
    assert.deepEqual(actual.calls, ["exit:1"]);
    assert.deepEqual(await readdir(normal), ["settings.json"]);
    assert.equal(
      await readFile(path.join(normal, "settings.json"), "utf8"),
      "synthetic untouched preferences",
    );
  });
}

test("startup exits when Electron keeps browser storage in the default directory", async (t) => {
  const directory = await temp(t);
  const normal = path.join(directory, "normal");
  const target = path.join(directory, "isolated");
  await mkdir(normal);
  await mkdir(target);
  await writeFile(path.join(normal, "Local State"), "synthetic browser-storage sentinel");
  const bundled = await build({
    entryPoints: [path.join(root, "main/platform/startup-profile.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    define: { __DAYBOARD_TEST_BUILD__: "true" },
    plugins: [stubPlugin(new Map([["electron", "export const app = globalThis.__app;"]]))],
  });
  await writeFile(path.join(directory, "startup-fixture.mjs"), bundled.outputFiles[0].text);
  const driver = path.join(directory, "driver.mjs");
  await writeFile(
    driver,
    `
    import { writeSync } from "node:fs";
    const paths = { userData: process.argv[2], sessionData: process.argv[2] };
    const calls = [];
    globalThis.__app = {
      getPath(name) { return paths[name]; },
      setPath(name, value) { calls.push("set:" + name); if (name !== "sessionData") paths[name] = value; },
      exit(code) { writeSync(1, JSON.stringify({ calls, code }) + "\\n"); process.exit(code); },
    };
    try { await import("./startup-fixture.mjs"); }
    catch { calls.push("native-continuation"); }
    console.log(JSON.stringify({ calls }));
  `,
  );
  const child = spawnSync(process.execPath, [driver, normal], {
    cwd: directory,
    env: { PATH: process.env.PATH, DAYBOARD_USER_DATA: target },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(child.status, 1, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), {
    calls: ["set:userData", "set:sessionData"],
    code: 1,
  });
  assert.deepEqual(await readdir(target), []);
  assert.equal(
    await readFile(path.join(normal, "Local State"), "utf8"),
    "synthetic browser-storage sentinel",
  );
});

test("the actual Vite configuration embeds test-build isolation without reading OAuth input", async (t) => {
  const directory = await temp(t);
  const result = await build({
    entryPoints: [path.join(root, "electron.vite.config.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      stubPlugin(
        new Map([
          ["electron-vite", "export const defineConfig = (config) => config;"],
          ["@tailwindcss/vite", "export default () => ({});"],
          ["@vitejs/plugin-react", "export default () => ({});"],
          ["node:os", "export const homedir = () => import.meta.dirname;"],
        ]),
      ),
    ],
  });
  await writeFile(path.join(directory, "config-fixture.mjs"), result.outputFiles[0].text);
  const driver = path.join(directory, "driver.mjs");
  await writeFile(
    driver,
    `
    const config = (await import("./config-fixture.mjs")).default;
    console.log(JSON.stringify(config.main.define));
  `,
  );
  for (const testBuild of ["1", "0"]) {
    const child = spawnSync(process.execPath, [driver], {
      cwd: directory,
      env: { PATH: process.env.PATH, DAYBOARD_TEST: testBuild },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr);
    const definitions = JSON.parse(child.stdout.trim());
    assert.equal(definitions.__DAYBOARD_TEST_BUILD__, String(testBuild === "1"));
    assert.equal(definitions["process.env.DAYBOARD_RELEASE"], '""');
    assert.equal(definitions["process.env.DAYBOARD_LICENSE_API_URL"], '""');
  }
});

async function launcher(t, behavior = "accept") {
  const directory = await temp(t);
  const home = path.join(directory, "home");
  const normal = path.join(home, "Library", "Application Support", "DayBoard");
  await mkdir(normal, { recursive: true });
  await writeFile(path.join(normal, "settings.json"), "synthetic personal-profile sentinel");
  const state = { requests: [], closed: 0, windows: 0 };
  const key = "__launcher" + Math.random().toString(36).slice(2);
  globalThis[key] = {
    home,
    directory,
    launch: async (request) => {
      state.requests.push(request);
      return {
        on() {},
        evaluate: async (callback) => {
          if (behavior === "throw") throw new Error("synthetic evaluation failure");
          return callback({
            app: {
              getPath: (name) =>
                behavior === "ignore" || (behavior === "ignore-session" && name === "sessionData")
                  ? normal
                  : request.env.DAYBOARD_USER_DATA,
            },
          });
        },
        close: async () => {
          state.closed++;
        },
        firstWindow: async () => {
          state.windows++;
          return { on() {}, waitForLoadState: async () => {} };
        },
      };
    },
  };
  t.after(() => {
    delete globalThis[key];
  });
  const result = await build({
    entryPoints: [path.join(root, "e2e/fixtures.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      stubPlugin(
        new Map([
          [
            "@playwright/test",
            `export const _electron = { launch: globalThis[${JSON.stringify(key)}].launch };`,
          ],
          [
            "node:os",
            `export const homedir = () => globalThis[${JSON.stringify(key)}].home; export const tmpdir = () => globalThis[${JSON.stringify(key)}].directory;`,
          ],
        ]),
      ),
    ],
  });
  const file = path.join(directory, "launcher-fixture.mjs");
  await writeFile(file, result.outputFiles[0].text);
  return { module: await import(pathToFileURL(file).href), state, normal, directory };
}

test("demo launcher supplies a marked profile and an explicit test flag", async (t) => {
  const f = await launcher(t);
  const demo = await f.module.launchDemo();
  const request = f.state.requests[0];
  assert.equal(request.env.DAYBOARD_TEST, "1");
  assert.equal(request.env.DAYBOARD_DEMO, "1");
  assert.equal(request.env.DAYBOARD_USER_DATA, demo.profile);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(demo.profile, ".dayboard-isolated-profile.json"), "utf8")),
    { version: 1, mode: "demo" },
  );
  assert.equal(f.state.windows, 1);
  await demo.close();
  assert.equal(f.state.closed, 1);
  assert.deepEqual(await readdir(f.normal), ["settings.json"]);
});

test("empty normal launcher marks its profile and disables every integration before launch", async (t) => {
  const f = await launcher(t);
  const demo = await f.module.launchEmptyProfile();
  const request = f.state.requests[0];
  assert.equal(request.env.DAYBOARD_TEST, "1");
  assert.equal(request.env.DAYBOARD_DEMO, undefined);
  const settings = JSON.parse(await readFile(path.join(demo.profile, "settings.json"), "utf8"));
  for (const source of Object.values(settings.sources)) assert.equal(source.enabled, false);
  assert.equal(settings.ai.enabled, false);
  assert.equal(settings.mcpServer.enabled, false);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(demo.profile, ".dayboard-isolated-profile.json"), "utf8")),
    { version: 1, mode: "test" },
  );
  await demo.close();
  assert.deepEqual(await readdir(f.normal), ["settings.json"]);
});

test("screenshot callers can seed an explicitly owned demo profile before launch", async (t) => {
  const f = await launcher(t);
  const profile = await f.module.createTestProfile();
  await writeFile(path.join(profile, "demo-settings.json"), '{"general":{"accent":"blue"}}');
  const demo = await f.module.launchDemo(profile);
  assert.equal(demo.profile, profile);
  assert.deepEqual(JSON.parse(await readFile(path.join(profile, "demo-settings.json"), "utf8")), {
    general: { accent: "blue" },
  });
  await demo.close();
  assert.deepEqual(await readdir(f.normal), ["settings.json"]);
});

test("launcher rejects the default or an unmarked populated profile before calling Electron", async (t) => {
  const f = await launcher(t);
  await assert.rejects(f.module.launchDemo(f.normal));
  const populated = path.join(f.directory, "populated");
  await mkdir(populated);
  await writeFile(path.join(populated, "settings.json"), "synthetic alternate preferences");
  await assert.rejects(f.module.launchDemo(populated));
  assert.deepEqual(f.state.requests, []);
  assert.deepEqual(await readdir(f.normal), ["settings.json"]);
  assert.deepEqual(await readdir(populated), ["settings.json"]);
});

for (const behavior of ["ignore", "ignore-session", "throw"]) {
  test(`launcher closes a synthetic app when profile verification returns ${behavior}`, async (t) => {
    const f = await launcher(t, behavior);
    await assert.rejects(f.module.launchDemo());
    assert.equal(f.state.closed, 1);
    assert.equal(f.state.windows, 0);
    assert.deepEqual(await readdir(f.normal), ["settings.json"]);
  });
}
