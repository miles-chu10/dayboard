import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

// Every Electron API and profile below is synthetic; child processes are plain Node, never Electron.
async function fixture(t, testBuild = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "dayboard-startup-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const appData = path.join(directory, "home", "Library", "Application Support");
  const normal = path.join(appData, "DayBoard");
  const isolated = path.join(directory, "isolated");
  await mkdir(normal, { recursive: true });
  await mkdir(isolated);
  await writeFile(path.join(normal, "settings.json"), "synthetic personal-profile sentinel");
  const result = await build({
    entryPoints: [path.join(root, "main/platform/user-data.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    define: { __DAYBOARD_TEST_BUILD__: String(testBuild) },
    plugins: [
      {
        name: "synthetic-electron-app",
        setup(api) {
          api.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "startup",
          }));
          api.onLoad({ filter: /.*/, namespace: "startup" }, () => ({
            contents: "export const app = globalThis.__startupApp;",
            loader: "js",
          }));
        },
      },
    ],
  });
  await writeFile(path.join(directory, "user-data-fixture.mjs"), result.outputFiles[0].text);
  const driver = path.join(directory, "driver.mjs");
  await writeFile(
    driver,
    `
    import path from "node:path";
    const normal = process.argv[2];
    let current = normal;
    let session = normal;
    let calls = 0;
    globalThis.__startupApp = {
      getPath(name) { return name === "appData" ? path.dirname(normal) : name === "sessionData" ? session : current; },
      setPath(name, value) {
        calls++;
        if (process.argv[3] === "throw") throw new Error("synthetic setPath failure");
        if (process.argv[3] === "ignore" || (process.argv[3] === "ignore-session" && name === "sessionData")) return;
        if (name === "sessionData") session = value;
        else current = value;
      },
    };
    const module = await import("./user-data-fixture.mjs");
    try {
      module.configureUserData();
      module.configureUserData();
      console.log(JSON.stringify({ ok: true, current, session, calls }));
    } catch (error) {
      let retryRejected = false;
      try { module.configureUserData(); } catch { retryRejected = true; }
      console.log(JSON.stringify({ ok: false, current, session, calls, retryRejected, error: error.message }));
    }
  `,
  );
  return {
    directory,
    normal,
    isolated,
    appData,
    run(env = {}, behavior = "accept") {
      const child = spawnSync(process.execPath, [driver, normal, behavior], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          TMPDIR: directory,
          ...env,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout.trim());
    },
    async assertNormalUntouched() {
      assert.deepEqual(await readdir(normal), ["settings.json"]);
      assert.equal(
        await readFile(path.join(normal, "settings.json"), "utf8"),
        "synthetic personal-profile sentinel",
      );
    },
  };
}

test("demo startup requires an explicit profile before it can mark the default profile", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run({ DAYBOARD_DEMO: "1" }).ok, false);
  await f.assertNormalUntouched();
});

test("a test build fails closed even when runtime test environment variables are absent", async (t) => {
  const f = await fixture(t, true);
  assert.equal(f.run().ok, false);
  await f.assertNormalUntouched();
});

test("an explicit demo target cannot be the default profile", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.normal }).ok, false);
  await f.assertNormalUntouched();
});

test("an empty test override cannot fall back to the default profile", async (t) => {
  const f = await fixture(t);
  assert.equal(f.run({ DAYBOARD_TEST: "1", DAYBOARD_USER_DATA: "" }).ok, false);
  await f.assertNormalUntouched();
});

test("a symlink alias cannot direct demo startup into the default profile", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.directory, "alias");
  await symlink(f.normal, alias);
  assert.equal(f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: alias }).ok, false);
  await f.assertNormalUntouched();
});

test("an ignored profile override fails before writing a demo marker", async (t) => {
  const f = await fixture(t);
  const result = f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.isolated }, "ignore");
  assert.equal(result.ok, false);
  assert.equal(result.retryRejected, true);
  await f.assertNormalUntouched();
  assert.deepEqual(await readdir(f.isolated), []);
});

test("ordinary non-test startup retains the existing default profile", async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.ok, true);
  assert.equal(result.current, f.normal);
  assert.equal(result.calls, 0);
  await f.assertNormalUntouched();
});

test("compiled test isolation cannot be disabled by DAYBOARD_TEST=0", async (t) => {
  const f = await fixture(t, true);
  assert.equal(f.run({ DAYBOARD_TEST: "0" }).ok, false);
  await f.assertNormalUntouched();
});

for (const [name, env] of [
  ["relative profile", { DAYBOARD_USER_DATA: "isolated" }],
  ["whitespace profile", { DAYBOARD_USER_DATA: "   " }],
  ["invalid demo flag", { DAYBOARD_DEMO: "true" }],
  ["invalid test flag", { DAYBOARD_TEST: "true" }],
])
  test(`startup refuses a ${name}`, async (t) => {
    const f = await fixture(t);
    const result = f.run({ DAYBOARD_TEST: "1", DAYBOARD_USER_DATA: f.isolated, ...env });
    assert.equal(result.ok, false);
    assert.equal(result.calls, 0);
    await f.assertNormalUntouched();
    assert.deepEqual(await readdir(f.isolated), []);
  });

test("test/demo profiles cannot contain or sit inside the default profile", async (t) => {
  const f = await fixture(t);
  const nested = path.join(f.normal, "child");
  await mkdir(nested);
  const before = await readdir(f.normal);
  for (const target of [f.appData, nested, path.parse(f.directory).root]) {
    const result = f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: target });
    assert.equal(result.ok, false);
    assert.equal(result.calls, 0);
    assert.deepEqual(await readdir(f.normal), before);
  }
  assert.deepEqual(await readdir(nested), []);
});

test("test startup rejects missing, file and populated unmarked destinations", async (t) => {
  const f = await fixture(t);
  const populated = path.join(f.directory, "unmarked");
  await mkdir(populated);
  await writeFile(path.join(populated, "settings.json"), "synthetic alternate-profile sentinel");
  for (const target of [
    path.join(f.directory, "missing"),
    path.join(f.normal, "settings.json"),
    populated,
  ]) {
    const result = f.run({ DAYBOARD_TEST: "1", DAYBOARD_USER_DATA: target });
    assert.equal(result.ok, false);
    assert.equal(result.calls, 0);
    assert.equal(result.retryRejected, true);
    await f.assertNormalUntouched();
  }
  assert.deepEqual(await readdir(populated), ["settings.json"]);
});

test("a failed setPath cannot turn a retry into successful default-profile startup", async (t) => {
  const f = await fixture(t);
  const result = f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.isolated }, "throw");
  assert.equal(result.ok, false);
  assert.equal(result.retryRejected, true);
  assert.equal(result.calls, 1);
  await f.assertNormalUntouched();
  assert.deepEqual(await readdir(f.isolated), []);
});

test("a fresh demo profile is explicitly marked and survives a second synthetic launch", async (t) => {
  const f = await fixture(t, true);
  const env = { DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.isolated };
  for (let launch = 0; launch < 2; launch++) {
    const result = f.run(env);
    assert.equal(result.ok, true);
    assert.equal(result.calls, 2);
    assert.equal(result.session, result.current);
    assert.equal(path.basename(result.current), "isolated");
    await f.assertNormalUntouched();
  }
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.isolated, ".dayboard-isolated-profile.json"), "utf8")),
    { version: 1, mode: "demo" },
  );
  assert.deepEqual((await readdir(f.isolated)).sort(), [
    ".dayboard-isolated-profile.json",
    "demo-mode",
  ]);
  await writeFile(path.join(f.isolated, "demo-settings.json"), "synthetic cached theme");
  assert.equal(f.run(env).ok, true);
  assert.equal(
    await readFile(path.join(f.isolated, "demo-settings.json"), "utf8"),
    "synthetic cached theme",
  );
});

test("normal test profiles are marked without enabling demo or changing ordinary custom profiles", async (t) => {
  const f = await fixture(t, true);
  const env = { DAYBOARD_USER_DATA: f.isolated };
  assert.equal(f.run(env).ok, true);
  await writeFile(
    path.join(f.isolated, "settings.json"),
    '{"sources":{"tasks":{"enabled":false}}}',
  );
  assert.equal(f.run(env).ok, true);
  assert.deepEqual((await readdir(f.isolated)).sort(), [
    ".dayboard-isolated-profile.json",
    "settings.json",
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.isolated, ".dayboard-isolated-profile.json"), "utf8")),
    { version: 1, mode: "test" },
  );
  await f.assertNormalUntouched();
  const ordinary = await fixture(t);
  await writeFile(
    path.join(ordinary.isolated, "settings.json"),
    "synthetic existing custom profile",
  );
  assert.equal(ordinary.run({ DAYBOARD_USER_DATA: ordinary.isolated }).ok, true);
  assert.deepEqual(await readdir(ordinary.isolated), ["settings.json"]);
});

test("a marked demo profile cannot silently become a normal test profile", async (t) => {
  const f = await fixture(t, true);
  assert.equal(f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.isolated }).ok, true);
  assert.equal(f.run({ DAYBOARD_USER_DATA: f.isolated }).ok, false);
  await f.assertNormalUntouched();
});

for (const kind of ["invalid", "mode", "symlink"]) {
  test(`startup rejects a ${kind} isolated-profile marker`, async (t) => {
    const f = await fixture(t, true);
    const marker = path.join(f.isolated, ".dayboard-isolated-profile.json");
    if (kind === "symlink") await symlink(path.join(f.normal, "settings.json"), marker);
    else await writeFile(marker, kind === "invalid" ? "not JSON" : '{"version":1,"mode":"demo"}');
    assert.equal(f.run({ DAYBOARD_USER_DATA: f.isolated }).ok, false);
    await f.assertNormalUntouched();
  });
}

test("browser session storage cannot remain in the default profile after a userData override", async (t) => {
  const f = await fixture(t, true);
  const result = f.run({ DAYBOARD_DEMO: "1", DAYBOARD_USER_DATA: f.isolated }, "ignore-session");
  assert.equal(result.ok, false);
  assert.equal(result.retryRejected, true);
  assert.equal(result.session, f.normal);
  assert.deepEqual(await readdir(f.isolated), []);
  await f.assertNormalUntouched();
});
