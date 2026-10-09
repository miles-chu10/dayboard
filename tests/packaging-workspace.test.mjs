import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  snapshotPackagingOutputs,
  withPackagingWorkspace,
} from "./helpers/packaging-workspace.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "dayboard-existing-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "package.json": JSON.stringify({ scripts: { "package:preview": "node build.mjs" } }),
    "build.mjs": `
      import fs from "node:fs";
      import path from "node:path";
      for (const [name, value] of Object.entries({
        "out/main/index.js": "synthetic build",
        "release/DayBoard-1.3.0-beta.11-arm64.dmg": "synthetic dmg",
        "release/DayBoard-1.3.0-beta.11-arm64-mac.zip": "synthetic zip",
        "resources/bin/reminders-helper": "synthetic native helper",
        "node_modules/fixture/native.node": "rebuilt native dependency"
      })) {
        fs.mkdirSync(path.dirname(name), {recursive:true});
        fs.writeFileSync(name, value);
      }
      process.exit(Number(process.env.FIXTURE_EXIT || 0));
    `,
    "out/main/index.js": "existing real build sentinel",
    "release/DayBoard-1.3.0-beta.11-arm64.dmg": "existing distributable dmg sentinel",
    "release/DayBoard-1.3.0-beta.11-arm64-mac.zip": "existing distributable zip sentinel",
    "resources/bin/reminders-helper": "existing native helper sentinel",
    "node_modules/fixture/native.node": "existing native dependency sentinel",
    "node_modules/fixture/cli.js": "console.log('fixture');",
    "google-oauth.local.json": "private file must not be copied",
    ".env.local": "private file must not be copied",
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  await mkdir(path.join(root, "node_modules/.bin"));
  await symlink("../fixture/cli.js", path.join(root, "node_modules/.bin/fixture"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  // Even accidentally tracked build outputs must not seed the fixture copy.
  execFileSync("git", ["add", "package.json", "build.mjs", "out", "release", "resources"], {
    cwd: root,
  });
  return root;
}

for (const status of [0, 9]) {
  test(`isolated packaging preserves same-named real outputs and cleans up after exit ${status}`, async (t) => {
    const root = await fixture(t);
    const before = await snapshotPackagingOutputs(root);
    const dependency = path.join(root, "node_modules/fixture/native.node");
    const nativeBefore = await readFile(dependency, "utf8");
    let temporary;
    const run = () =>
      withPackagingWorkspace(root, async ({ directory, workspace, run }) => {
        temporary = directory;
        assert.ok(!workspace.startsWith(root + path.sep));
        for (const name of [
          "out",
          "release",
          "resources/bin",
          ".git",
          ".env.local",
          "google-oauth.local.json",
        ]) {
          await assert.rejects(access(path.join(workspace, name)), { code: "ENOENT" });
        }
        assert.equal(
          await readlink(path.join(workspace, "node_modules/.bin/fixture")),
          "../fixture/cli.js",
        );
        assert.notEqual(
          (await lstat(dependency)).ino,
          (await lstat(path.join(workspace, "node_modules/fixture/native.node"))).ino,
        );
        const result = await run("npm", ["run", "package:preview"], {
          env: { PATH: process.env.PATH, FIXTURE_EXIT: String(status) },
          stdio: "ignore",
          signal: AbortSignal.timeout(10_000),
        });
        assert.equal(result, status);
        assert.equal(
          await readFile(path.join(workspace, "release/DayBoard-1.3.0-beta.11-arm64.dmg"), "utf8"),
          "synthetic dmg",
        );
        if (status !== 0) throw new Error("Expected packaging failure");
      });
    if (status === 0) await run();
    else await assert.rejects(run(), /Expected packaging failure/);
    assert.deepEqual(await snapshotPackagingOutputs(root), before);
    assert.equal(await readFile(dependency, "utf8"), nativeBefore);
    await assert.rejects(access(temporary), { code: "ENOENT" });
  });
}

test("fixture setup rejects dependency links back to the checkout", async (t) => {
  const root = await fixture(t);
  await symlink(path.join(root, "out"), path.join(root, "node_modules/unsafe-link"));
  let called = false;
  await assert.rejects(
    withPackagingWorkspace(root, () => {
      called = true;
    }),
    /cannot link outside/,
  );
  assert.equal(called, false);
});

test(
  "timeout waits for a TERM-resistant nested npm writer before workspace cleanup",
  { timeout: 8000 },
  async (t) => {
    const root = await fixture(t);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "package:preview": "npm run inner",
          inner: "node launcher.mjs",
        },
      }),
    );
    await writeFile(
      path.join(root, "launcher.mjs"),
      `
    import { spawn } from "node:child_process";
    process.on("SIGTERM", () => {});
    spawn(process.execPath, ["writer.mjs"], { stdio: "ignore" });
    setInterval(() => {}, 1000);
  `,
    );
    await writeFile(
      path.join(root, "writer.mjs"),
      `
    import { mkdirSync, renameSync, writeFileSync } from "node:fs";
    import path from "node:path";
    const output = path.resolve("release");
    process.on("SIGTERM", () => {});
    let ready = false;
    setInterval(() => {
      mkdirSync(output, { recursive: true });
      writeFileSync(path.join(output, "heartbeat"), String(Date.now()));
      if (!ready) {
        writeFileSync("writer-ready.tmp", JSON.stringify({ pid: process.pid }));
        renameSync("writer-ready.tmp", "writer-ready.json");
        ready = true;
      }
    }, 20);
  `,
    );
    execFileSync("git", ["add", "launcher.mjs", "writer.mjs"], { cwd: root });
    const before = await snapshotPackagingOutputs(root);
    const controller = new AbortController();
    let temporary;
    let writer;
    const task = withPackagingWorkspace(root, async ({ directory, workspace, run }) => {
      temporary = directory;
      const command = run("npm", ["run", "package:preview"], {
        env: { PATH: process.env.PATH },
        stdio: "ignore",
        signal: AbortSignal.any([controller.signal, t.signal]),
        termGraceMs: 100,
        killWaitMs: 1500,
      });
      const rejection = assert.rejects(command, { name: "AbortError" });
      let timeout;
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            writer = JSON.parse(await readFile(path.join(workspace, "writer-ready.json"), "utf8"));
            break;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await delay(20);
        }
        assert.ok(writer?.pid, "Nested writer must start within two seconds.");
        timeout = setTimeout(() => controller.abort(), 50);
        await rejection;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
      // Check before withPackagingWorkspace can enter its removal finally block.
      const heartbeat = path.join(workspace, "release/heartbeat");
      const stopped = await readFile(heartbeat, "utf8");
      await delay(100);
      assert.equal(await readFile(heartbeat, "utf8"), stopped, "Writer must stop before cleanup.");
      assert.ok(
        await lstat(workspace),
        "Workspace must still exist until command shutdown finishes.",
      );
    });
    await task;
    await assert.rejects(access(temporary), { code: "ENOENT" });
    await delay(1200);
    await assert.rejects(access(temporary), { code: "ENOENT" });
    assert.deepEqual(await snapshotPackagingOutputs(root), before);
  },
);
