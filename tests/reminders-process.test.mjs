import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let moduleNumber = 0;

async function loadReminders() {
  const result = await build({
    entryPoints: [path.join(root, "main/platform/reminders.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fake-native-process",
        setup(plugin) {
          plugin.onResolve({ filter: /^(electron|node:child_process)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "electron"
                ? 'export const app = { isPackaged: false, getAppPath: () => "/fake" };'
                : "export const spawn = (...args) => globalThis.__remindersFakeSpawn(...args);",
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${++moduleNumber}`
  );
}

function fakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.killCount = 0;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.killCount++;
    child.killSignals.push(signal);
    return true;
  };
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.sent = [];
  child.writeCallbacks = [];
  child.stdin = {
    write(line, callback) {
      child.sent.push(JSON.parse(line));
      child.writeCallbacks.push(callback);
      return true;
    },
  };
  child.respond = (index, result) => {
    child.stdout.emit(
      "data",
      `${JSON.stringify({ id: child.sent[index].id, ok: true, result })}\n`,
    );
  };
  return child;
}

async function fixture(t, createChild = fakeChild) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const children = [];
  globalThis.__remindersFakeSpawn = () => {
    const child = createChild();
    children.push(child);
    return child;
  };
  t.after(() => {
    delete globalThis.__remindersFakeSpawn;
  });
  return { children, reminders: (await loadReminders()).reminders };
}

test("normal response and permission prompt use their own active timeouts", async (t) => {
  const { children, reminders } = await fixture(t);
  const status = reminders.status();
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["status"],
  );
  t.mock.timers.tick(14_999);
  children[0].respond(0, "not-determined");
  assert.equal(await status, "not-determined");

  const permission = reminders.requestAccess();
  const queuedStatus = reminders.status();
  children[0].writeCallbacks[0](new Error("late completed write"));
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["status", "requestAccess"],
  );
  t.mock.timers.tick(16_000);
  assert.equal(children[0].killCount, 0);
  children[0].respond(1, "full-access");
  assert.equal(await permission, "full-access");
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["status", "requestAccess", "status"],
  );
  t.mock.timers.tick(14_999);
  children[0].respond(2, "full-access");
  assert.equal(await queuedStatus, "full-access");
  assert.equal(children[0].killCount, 0);
});

test("timeout retires child and rejects queued mutations without replay", async (t) => {
  const { children, reminders } = await fixture(t);
  const stalled = reminders.createReminder({ title: "fixture" });
  const remove = reminders.deleteReminder({ value: "fixture" });
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["createReminder"],
  );

  t.mock.timers.tick(15_000);
  assert.equal(children[0].killCount, 1);
  assert.deepEqual(children[0].killSignals, ["SIGKILL"]);
  await assert.rejects(stalled, /timed out waiting for "createReminder"/);
  await assert.rejects(remove, /timed out waiting for "createReminder"/);
  assert.equal(children.length, 1);

  const next = reminders.status();
  assert.equal(children.length, 2);
  assert.deepEqual(
    children[1].sent.map(({ op }) => op),
    ["status"],
  );
  children[1].respond(0, "full-access");
  assert.equal(await next, "full-access");
  assert.deepEqual(
    children[1].sent.map(({ op }) => op),
    ["status"],
  );
});

test("old callbacks and partial stdout cannot affect the replacement child", async (t) => {
  const { children, reminders } = await fixture(t);
  const stalled = reminders.status();
  children[0].stdout.emit("data", '{"id":"partial');
  t.mock.timers.tick(15_000);
  await assert.rejects(stalled, /timed out/);

  const next = reminders.getCalendars();
  children[0].stdout.emit("data", '","ok":true,"result":"old"}\n');
  children[0].respond(0, "old");
  children[0].stderr.emit("data", "late diagnostic");
  children[0].emit("error", new Error("old error"));
  children[0].emit("exit", 1);
  children[0].writeCallbacks[0](new Error("old stdin error"));
  assert.equal(children[1].killCount, 0);
  children[1].respond(0, []);
  assert.deepEqual(await next, []);
});

test("permission timeout retires child only after five minutes and rejects queued reads", async (t) => {
  const { children, reminders } = await fixture(t);
  const permission = reminders.requestAccess();
  const queuedRead = reminders.getCalendars();
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.equal(children[0].killCount, 0);
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["requestAccess"],
  );
  t.mock.timers.tick(1);
  assert.equal(children[0].killCount, 1);
  await assert.rejects(permission, /timed out waiting for "requestAccess"/);
  await assert.rejects(queuedRead, /timed out waiting for "requestAccess"/);
  const next = reminders.status();
  assert.equal(children.length, 2);
  children[1].respond(0, "denied");
  assert.equal(await next, "denied");
});

test("synchronous spawn failure rejects the request and the next request starts a helper", async (t) => {
  let failSpawn = true;
  const { children, reminders } = await fixture(t, () => {
    if (failSpawn) {
      failSpawn = false;
      throw new Error("fixture spawn failure");
    }
    return fakeChild();
  });
  await assert.rejects(reminders.createReminder({ title: "fixture" }), /fixture spawn failure/);
  assert.equal(children.length, 0);

  const next = reminders.status();
  assert.equal(children.length, 1);
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["status"],
  );
  children[0].respond(0, "full-access");
  assert.equal(await next, "full-access");
});

for (const event of ["error", "exit"]) {
  test(`current-child ${event} rejects active and queued mutations without replay`, async (t) => {
    const { children, reminders } = await fixture(t);
    const active = reminders.createReminder({ title: "fixture" });
    const queued = reminders.deleteReminder({ value: "fixture" });
    if (event === "error") children[0].emit("error", new Error("fixture process error"));
    else children[0].emit("exit", 7);

    const message = event === "error" ? /fixture process error/ : /exited unexpectedly \(code 7\)/;
    await assert.rejects(active, message);
    await assert.rejects(queued, message);
    assert.equal(children[0].killCount, event === "error" ? 1 : 0);
    assert.deepEqual(
      children[0].sent.map(({ op }) => op),
      ["createReminder"],
    );

    const next = reminders.status();
    assert.equal(children.length, 2);
    assert.deepEqual(
      children[1].sent.map(({ op }) => op),
      ["status"],
    );
    children[1].respond(0, "denied");
    assert.equal(await next, "denied");
  });
}

test("current active stdin callback error rejects active and queued mutations", async (t) => {
  const { children, reminders } = await fixture(t);
  const active = reminders.createReminder({ title: "fixture" });
  const queued = reminders.deleteReminder({ value: "fixture" });
  children[0].writeCallbacks[0](new Error("fixture stdin failure"));
  await assert.rejects(active, /fixture stdin failure/);
  await assert.rejects(queued, /fixture stdin failure/);
  assert.equal(children[0].killCount, 1);
  assert.deepEqual(
    children[0].sent.map(({ op }) => op),
    ["createReminder"],
  );

  const next = reminders.status();
  assert.equal(children.length, 2);
  assert.deepEqual(
    children[1].sent.map(({ op }) => op),
    ["status"],
  );
  children[1].respond(0, "full-access");
  assert.equal(await next, "full-access");
});

test("synchronous stdin write throw retires helper and allows a fresh request", async (t) => {
  let failWrite = true;
  const { children, reminders } = await fixture(t, () => {
    const child = fakeChild();
    if (failWrite) {
      failWrite = false;
      child.stdin.write = () => {
        throw new Error("fixture write throw");
      };
    }
    return child;
  });
  await assert.rejects(reminders.createReminder({ title: "fixture" }), /fixture write throw/);
  assert.equal(children[0].killCount, 1);
  assert.deepEqual(children[0].sent, []);

  const next = reminders.status();
  assert.equal(children.length, 2);
  assert.deepEqual(
    children[1].sent.map(({ op }) => op),
    ["status"],
  );
  children[1].respond(0, "full-access");
  assert.equal(await next, "full-access");
});
