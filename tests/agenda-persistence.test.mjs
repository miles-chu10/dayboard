import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let sequence = 0;

const backendStub = `
export const app = { getPath: () => globalThis.__agendaStoreUserData };
const fixture = () => globalThis.__remindersFixture;
export const reminders = {
  status: () => fixture().status ?? "full-access",
  requestAccess: () => fixture().status ?? "full-access",
  getCalendars: () => fixture().getCalendars(),
  getReminders: (options) => fixture().getReminders(options),
  getReminder: () => fixture().updated,
  updateReminder: (reference, patch) => fixture().updateReminder(reference, patch),
  createReminder: () => fixture().updated,
};
export const systemPreferences = { openPrivacySettings: async () => {} };
`;

function backendPlugin() {
  return {
    name: "agenda-store-backend",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
        path: "backend-stub",
        namespace: "agenda-store-fixture",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "agenda-store-fixture" }, () => ({
        contents: backendStub,
        loader: "js",
      }));
    },
  };
}

async function load(entry) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [backendPlugin()],
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n// ${sequence++}`).toString("base64")}`);
}

async function withStore(run) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "dayboard-agenda-store-"));
  globalThis.__agendaStoreUserData = userData;
  try {
    await run(userData);
  } finally {
    delete globalThis.__agendaStoreUserData;
    await rm(userData, { recursive: true, force: true });
  }
}

test("agenda store persists concurrent saves without silently evicting records", async () => {
  await withStore(async () => {
    const store = await load("main/services/agenda-store.ts");
    await Promise.all(
      Array.from({ length: 320 }, (_value, index) =>
        store.setAgendaDuplicateLink("scope-a", {
          leftKey: `task:list:${index}`,
          rightKey: `reminder:${index}`,
          status: index % 2 ? "dismissed" : "accepted",
        }),
      ),
    );
    await store.drainAgendaStore();
    const fresh = await load("main/services/agenda-store.ts");
    const state = await fresh.getAgendaState("scope-a");
    assert.equal(state.duplicateLinks.length, 320);
    assert.equal(state.duplicateLinks[0].rightKey, "task:list:0");
    assert.equal(state.duplicateLinks.at(-1).leftKey, "reminder:319");
  });
});

test("separate opaque scopes remain isolated after a fresh store load", async () => {
  await withStore(async () => {
    const store = await load("main/services/agenda-store.ts");
    await store.setAgendaFocus("google:opaque-a", ["task:list:a"]);
    await store.setAgendaFocus("google:opaque-b", ["task:list:b"]);
    await store.drainAgendaStore();
    const fresh = await load("main/services/agenda-store.ts");
    assert.deepEqual((await fresh.getAgendaState("google:opaque-a")).focusKeys, ["task:list:a"]);
    assert.deepEqual((await fresh.getAgendaState("google:opaque-b")).focusKeys, ["task:list:b"]);
  });
});

test("separate processes restore accepted, dismissed, unlinked, pinned and calendar decisions", async () => {
  await withStore(async (userData) => {
    const bundle = await build({ entryPoints: [path.join(root, "main/services/agenda-store.ts")], bundle: true, platform: "node", format: "esm", write: false, plugins: [backendPlugin()], logLevel: "silent" });
    await writeFile(path.join(userData, "store.mjs"), bundle.outputFiles[0].text);
    const driver = path.join(userData, "driver.mjs");
    await writeFile(driver, `
      globalThis.__agendaStoreUserData = process.argv[2];
      const store = await import('./store.mjs');
      const block = { requestId: 'request-1', taskKey: 'task:a', eventId: 'fixture-event', date: '2026-09-22', startTime: '09:00', endTime: '09:30' };
      if (process.argv[3] === 'save') {
        await Promise.all([
          store.setAgendaDuplicateLink('account-a', {leftKey:'task:a', rightKey:'reminder:a', status:'accepted'}),
          store.setAgendaDuplicateLink('account-a', {leftKey:'task:b', rightKey:'reminder:b', status:'dismissed'}),
          store.setAgendaDuplicateLink('account-a', {leftKey:'task:c', rightKey:'reminder:c', status:'accepted'}),
          store.setAgendaFocus('account-a', ['task:a']),
          store.prepareAgendaBlock('account-a', block),
          store.setAgendaFocus('demo', ['reminder:demo'])
        ]);
        await store.removeAgendaDuplicateLink('account-a', 'task:c', 'reminder:c');
        await store.completeAgendaBlock('account-a', block);
      }
      if (process.argv[3] === 'retry') await store.completeAgendaBlock('account-a', block);
      await store.drainAgendaStore();
      process.stdout.write(JSON.stringify(await store.getAgendaState('account-a')));
    `);
    const run = action => {
      const child = spawnSync(process.execPath, [driver, userData, action], { encoding: "utf8", cwd: userData });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    const saved = run("save");
    assert.deepEqual(run("read"), saved);
    assert.deepEqual(run("retry"), saved);
    assert.deepEqual(saved.focusKeys, ["task:a"]);
    assert.deepEqual(saved.duplicateLinks.map(link => link.status), ["accepted", "dismissed"]);
    assert.equal(saved.scheduledBlocks.length, 1);
  });
});

test("legacy JSON is backed up byte-for-byte before normalization and exact ref migration", async () => {
  await withStore(async (userData) => {
    const original = '{\n  "version": 1,\n  "accounts": {\n    "scope-a": {\n      "focusKeys": ["reminder:old-ref"],\n      "duplicateLinks": [{"leftKey":"reminder:old-ref","rightKey":"task:list:1","status":"accepted"}],\n      "scheduledBlocks": [{"taskKey":"reminder:old-ref","eventId":"event-1","date":"2026-09-22","startTime":"09:00","endTime":"09:30"}]\n    }\n  }\n}\n';
    await writeFile(path.join(userData, "agenda-state.json"), original);
    const store = await load("main/services/agenda-store.ts");
    await store.getAgendaState("scope-a");
    assert.equal(
      await readFile(path.join(userData, "agenda-state.json.v1.bak"), "utf8"),
      original,
    );
    const migrated = await store.reconcileAgendaKeys("scope-a", [
      { previousKey: "reminder:old-ref", currentKey: "reminder:calendar:external" },
    ]);
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.state.focusKeys, ["reminder:calendar:external"]);
    assert.equal(migrated.state.duplicateLinks[0].leftKey, "reminder:calendar:external");
    assert.equal(migrated.state.scheduledBlocks[0].taskKey, "reminder:calendar:external");
  });
});

test("future and malformed schemas are preserved by rejection instead of overwritten", async () => {
  await withStore(async (userData) => {
    const target = path.join(userData, "agenda-state.json");
    await writeFile(target, '{"version":99,"accounts":{}}\n');
    const future = await load("main/services/agenda-store.ts");
    await assert.rejects(future.getAgendaState("scope-a"), /unsupported schema/);
    assert.equal(await readFile(target, "utf8"), '{"version":99,"accounts":{}}\n');

    await writeFile(target, '{"version":1,"accounts":[]}\n');
    const malformed = await load("main/services/agenda-store.ts");
    await assert.rejects(malformed.getAgendaState("scope-a"), /unsupported schema/);
    assert.equal(await readFile(target, "utf8"), '{"version":1,"accounts":[]}\n');
  });
});

test("failed persistence leaves the caller snapshot unchanged", async () => {
  const utils = await load("main/services/agenda-utils.ts");
  const before = { focusKeys: ["task:a"] };
  await assert.rejects(
    utils.mutateAndPersist(
      before,
      (draft) => {
        draft.focusKeys.push("task:b");
        return "result";
      },
      async () => {
        throw new Error("synthetic disk failure");
      },
    ),
    /synthetic disk failure/,
  );
  assert.deepEqual(before, { focusKeys: ["task:a"] });
});

test("reminder completion retains the canonical replacement ref and never masks a completed write", async () => {
  const native = (ref, completed = false) => ({
    ref: { value: ref }, externalId: "external", calendarId: "calendar", title: "Call Mom", notes: null,
    due: null, priority: 0, isCompleted: completed, completionDate: null, recurrenceRules: [],
  });
  let writes = 0;
  globalThis.__remindersFixture = {
    getCalendars: async () => [{ id: "calendar", title: "Home" }],
    getReminders: async () => ({ reminders: [], truncated: false }),
    updateReminder: async (reference, patch) => {
      writes += 1;
      assert.equal(reference.value, "old-ref");
      assert.equal(patch.isCompleted, true);
      return native("new-ref", true);
    },
    updated: native("new-ref", true),
  };
  try {
    const service = await load("main/services/apple-reminders.ts");
    const item = await service.setReminderCompleted("old-ref", true);
    assert.equal(writes, 1);
    assert.equal(item.ref, "new-ref");
    assert.equal(item.identity, "new-ref");

    globalThis.__remindersFixture.getCalendars = async () => {
      throw new Error("synthetic calendar metadata failure");
    };
    await assert.rejects(service.setReminderCompleted("old-ref", true), /metadata failure/);
    assert.equal(writes, 1);
  } finally {
    delete globalThis.__remindersFixture;
  }
});

test("link graph uses the same full component through chains, cycles, and hidden sources", async () => {
  const todos = await load("renderer/lib/todos.ts");
  const links = [
    { leftKey: "task:a", rightKey: "reminder:b", status: "accepted" },
    { leftKey: "reminder:b", rightKey: "task:c", status: "accepted" },
    { leftKey: "task:c", rightKey: "task:a", status: "accepted" },
  ];
  assert.deepEqual(new Set(todos.linkedGroupKeys(links, "task:a")), new Set(["task:a", "reminder:b", "task:c"]));
  const input = [
    { key: "task:a", source: "tasks", title: "A", notes: null, dueDate: null, dueTime: null, listTitle: "Tasks", completed: false, completedAt: null },
    { key: "reminder:b", source: "reminders", title: "B", notes: null, dueDate: null, dueTime: null, listTitle: "Reminders", completed: false, completedAt: null },
    { key: "task:c", source: "tasks", title: "C", notes: null, dueDate: "2026-09-22", dueTime: null, listTitle: "Tasks", completed: false, completedAt: null },
  ];
  const merged = todos.mergeLinkedTodos(input, links, { tasks: true, reminders: false });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, "task:c");
  assert.deepEqual(new Set(merged[0].linkedKeys), new Set(["task:a", "reminder:b", "task:c"]));
});

test("unique reminder identity survives canonical ref replacement and later truncated fetches", async () => {
  const native = ref => ({ ref: { value: ref }, externalId: "external", calendarId: "calendar", title: "Fixture", notes: null, due: null, priority: 0, isCompleted: false, completionDate: null, recurrenceRules: [] });
  globalThis.__remindersFixture = {
    getCalendars: async () => [{ id: "calendar", title: "Fixtures" }],
    getReminders: async () => ({ reminders: [native("old")], truncated: false }),
    updateReminder: async () => ({ ...native("new"), isCompleted: true }),
  };
  try {
    const service = await load("main/services/apple-reminders.ts");
    const [original] = await service.listReminders();
    const updated = await service.setReminderCompleted("old", true);
    assert.equal(updated.identity, original.identity);
    assert.equal(updated.ref, "new");
    globalThis.__remindersFixture.getReminders = async () => ({ reminders: [native("new")], truncated: true });
    const [truncated] = await service.listReminders();
    assert.equal(truncated.identity, original.identity);
  } finally { delete globalThis.__remindersFixture; }
});
