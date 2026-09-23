import { fixtureImport } from "./fixture-imports.mjs";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import process from "node:process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

function settings() {
  return {
    sources: {
      tasks: { enabled: true },
      reminders: { enabled: true },
      mail: { enabled: true },
      calendar: { enabled: true },
    },
    calendar: { visibility: {}, range: "next-7-days" },
    mail: { maxMessages: 25 },
  };
}

function fixture(userData) {
  return {
    userData,
    handlers: new Map(),
    broadcasts: [],
    settings: settings(),
    email: "agenda@example.test",
    tasks: new Set(["list-1:task-1"]),
    reminders: new Set(["reminder-1"]),
    calendarItems: [],
    remoteEvents: new Map(),
    calls: { calendarRanges: [], creates: 0, finds: 0 },
    failCreateOnce: false,
    failNextWrite: false,
  };
}

const backendStub = `
const fixture = () => globalThis.__agendaFixture;
export const app = { getPath: () => fixture().userData };
export const ipcMain = {
  handle(channel, handler) { fixture().handlers.set(channel, handler); },
  broadcast(channel, payload) { fixture().broadcasts.push({ channel, payload }); },
};
export const logger = { error() {}, warn() {}, info() {} };
export const clipboard = { writeText() {} };
export const shell = { openExternal: async () => {} };
`;

const googleStub = `
const fixture = () => globalThis.__agendaFixture;
const key = (listId, taskId) => listId + ":" + taskId;
export async function getTaskInList(listId, taskId) {
  if (!fixture().tasks.has(key(listId, taskId))) throw new Error("missing task");
}
export async function listEventsBetweenWithCoverage(start, end) {
  fixture().calls.calendarRanges.push({ start: new Date(start), end: new Date(end) });
  return { items: fixture().calendarItems, coverage: { complete: true, loaded: fixture().calendarItems.length } };
}
export async function createAgendaEvent(input, requestId) {
  const state = fixture();
  state.calls.creates += 1;
  if (state.failCreateOnce) { state.failCreateOnce = false; throw new Error("synthetic transient remote failure"); }
  const id = "event-" + requestId;
  state.remoteEvents.set(requestId, { id, input });
  if (state.failNextWrite === "after-event") state.failNextWrite = true;
  return { id };
}
export async function findAgendaEvent(requestId) {
  fixture().calls.finds += 1;
  return fixture().remoteEvents.get(requestId) ?? null;
}
export async function listTasksWithCoverage() { return { items: [], coverage: { complete: true, loaded: 0 } }; }
export async function listEventsWithCoverage() { return { items: [], coverage: { complete: true, loaded: 0 } }; }
export async function createEvent() {}
export async function createReplyDraft() { return { draftId: "draft" }; }
export async function createTask() {}
export async function getMessageBody() { return ""; }
export async function listCalendars() { return { calendars: [], limited: false }; }
export async function listCompletedTasks() { return []; }
export async function listEventsBetween() { return []; }
export async function listInbox() { return []; }
export async function modifyMessage() {}
export async function searchRelatedMail() { return []; }
export async function setTaskCompleted() {}
`;

const authStub = `
const fixture = () => globalThis.__agendaFixture;
export const GOOGLE_REDIRECT_URI = "https://example.test/callback";
export class GoogleAuthError extends Error { constructor(reason, message) { super(message); this.reason = reason; } }
export async function getGoogleStatus() { return { hasCredentials: true, connected: true, email: fixture().email, clientIdHint: null }; }
export async function clearGoogleCredentials() {}
export async function connectGoogle() {}
export async function disconnectGoogle() {}
export async function saveGoogleCredentials() {}
`;

const remindersStub = `
const fixture = () => globalThis.__agendaFixture;
export async function getReminder(ref) { if (!fixture().reminders.has(ref)) throw new Error("missing reminder"); }
export async function getRemindersAccess() { return "full-access"; }
export async function createReminder() {}
export async function listCompletedReminders() { return []; }
export async function listReminders() { return []; }
export async function openRemindersPrivacySettings() {}
export async function requestRemindersAccess() { return "full-access"; }
export async function setReminderCompleted() {}
`;

const settingsStub = `export async function getSettings() { return globalThis.__agendaFixture.settings; }`;

const fileStoreStub = `
import * as fs from "node:fs/promises";
import * as path from "node:path";
const fixture = () => globalThis.__agendaFixture;
export async function readFileIfExists(target) {
  try { return await fs.readFile(target); } catch (error) { if (error && error.code === "ENOENT") return null; throw error; }
}
export async function writeFileAtomic(target, data) {
  const state = fixture();
  if (state.failNextWrite === true) { state.failNextWrite = false; throw new Error("synthetic local write failure"); }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".test.tmp";
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, target);
}
export function createSerialQueue() {
  let tail = Promise.resolve();
  return (operation) => { const run = tail.then(operation, operation); tail = run.catch(() => undefined); return run; };
}
`;

function providerPlugin() {
  const stubs = new Map([
    ["dayboard:platform", backendStub],
    ["../services/google-api.js", googleStub],
    ["../services/google-auth.js", authStub],
    ["../services/apple-reminders.js", remindersStub],
    ["../services/settings-store.js", settingsStub],
    ["./file-store.js", fileStoreStub],
  ]);
  return {
    name: "agenda-offline-fixtures",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (stubs.has(fixtureImport(args.path)))
          return { path: fixtureImport(args.path), namespace: "agenda-fixture" };
        return undefined;
      });
      buildApi.onLoad({ filter: /.*/, namespace: "agenda-fixture" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function loadHarness(state) {
  globalThis.__agendaFixture = state;
  const result = await build({
    entryPoints: [path.join(root, "main/handlers/productivity.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [providerPlugin()],
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const module = await import(url);
  module.registerProductivityHandlers();
  return async (channel, payload) => {
    const handler = state.handlers.get(channel);
    assert.ok(handler, `missing handler ${channel}`);
    if (channel.startsWith("agenda:") && !channel.startsWith("agenda:get")) {
      payload = { expectedScope: await state.handlers.get("agenda:getScope")({}), ...payload };
    }
    return handler({}, payload);
  };
}

async function withFixture(run) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "dashboard-agenda-test-"));
  try {
    return await run(fixture(userData), userData);
  } finally {
    delete globalThis.__agendaFixture;
    await rm(userData, { recursive: true, force: true });
  }
}

test("stale or unresolved account scope cannot save relationships or complete items", async () => {
  await withFixture(async (state) => {
    const invoke = await loadHarness(state);
    const scope = await invoke("agenda:getScope");
    await invoke("agenda:setFocus", { focusKeys: ["task:list-1:task-1"] });
    state.email = "second@example.test";
    await assert.rejects(
      invoke("agenda:setFocus", { focusKeys: [], expectedScope: scope }),
      /account changed/,
    );
    await assert.rejects(
      invoke("tasks:setCompleted", {
        listId: "list-1",
        taskId: "task-1",
        completed: true,
        expectedScope: scope,
      }),
      /account changed/,
    );
    await assert.rejects(
      invoke("reminders:setCompleted", {
        ref: "reminder-1",
        completed: true,
        expectedScope: scope,
      }),
      /account changed/,
    );
    state.email = null;
    await assert.rejects(invoke("agenda:getScope"), /identity is still loading/);
    await assert.rejects(invoke("agenda:setFocus", { focusKeys: [] }), /identity is still loading/);
  });
});

const requestId = "11111111-1111-4111-8111-111111111111";
function blockInput(overrides = {}) {
  return {
    requestId,
    task: { key: "task:list-1:task-1", source: "tasks", listId: "list-1", taskId: "task-1" },
    title: "Invented planning block",
    date: "2027-03-14",
    startTime: "09:00",
    endTime: "09:30",
    timeZone: "America/Los_Angeles",
    ...overrides,
  };
}

test("calendar:listRange covers selected local dates across Los Angeles DST and Tokyo", async () => {
  await withFixture(async (state) => {
    const invoke = await loadHarness(state);
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      await invoke("calendar:listRange", { startDate: "2026-03-08", days: 1 });
      const la = state.calls.calendarRanges.at(-1);
      assert.equal(la.start.getHours(), 0);
      assert.equal(la.end.getHours(), 0);
      assert.equal(la.end.getDate(), 9);
      assert.equal(la.end.getTime() - la.start.getTime(), 23 * 60 * 60 * 1000);

      process.env.TZ = "Asia/Tokyo";
      await invoke("calendar:listRange", { startDate: "2026-03-08", days: 1 });
      const tokyo = state.calls.calendarRanges.at(-1);
      assert.equal(tokyo.start.getHours(), 0);
      assert.equal(tokyo.end.getHours(), 0);
      assert.equal(tokyo.end.getDate(), 9);
      assert.equal(tokyo.end.getTime() - tokyo.start.getTime(), 24 * 60 * 60 * 1000);
    } finally {
      process.env.TZ = previous;
    }
  });
});

test("agenda focus is durable and isolated by account scope", async () => {
  await withFixture(async (state) => {
    const invoke = await loadHarness(state);
    await invoke("agenda:setFocus", { focusKeys: ["task:list-1:task-1"] });
    state.email = "other@example.test";
    assert.deepEqual((await invoke("agenda:getState")).state, {
      focusKeys: [],
      duplicateLinks: [],
      scheduledBlocks: [],
    });
    await invoke("agenda:setFocus", { focusKeys: ["reminder:reminder-1"] });
    state.email = "agenda@example.test";

    const afterRestart = await loadHarness(state);
    assert.deepEqual((await afterRestart("agenda:getState")).state.focusKeys, [
      "task:list-1:task-1",
    ]);
    const saved = JSON.parse(
      await readFile(path.join(state.userData, "agenda-state.json"), "utf8"),
    );
    assert.equal(Object.keys(saved.accounts).length, 2);
  });
});

test("agenda block is idempotent, linked, and only reaches synthetic providers", async () => {
  await withFixture(async (state) => {
    const invoke = await loadHarness(state);
    const first = await invoke("agenda:createBlock", blockInput());
    const retry = await invoke("agenda:createBlock", blockInput());
    assert.deepEqual(retry, first);
    assert.equal(state.calls.creates, 1);
    assert.equal(state.remoteEvents.size, 1);
    assert.deepEqual((await invoke("agenda:getState")).state.scheduledBlocks, [first]);
    assert.ok(state.broadcasts.some((event) => event.channel === "data:changed"));
  });
});

test("a transient synthetic remote error leaves a retryable request without duplicates", async () => {
  await withFixture(async (state) => {
    state.failCreateOnce = true;
    const invoke = await loadHarness(state);
    await assert.rejects(
      invoke("agenda:createBlock", blockInput()),
      /synthetic transient remote failure/,
    );
    const block = await invoke("agenda:createBlock", blockInput());
    assert.equal(state.calls.creates, 2);
    assert.equal(state.remoteEvents.size, 1);
    assert.equal((await invoke("agenda:getState")).state.scheduledBlocks[0].eventId, block.eventId);
  });
});

test("calendar conflicts release the pending reservation deterministically", async () => {
  await withFixture(async (state) => {
    state.calendarItems = [
      {
        id: "fixture-conflict",
        title: "Fixture meeting",
        start: "2027-03-14T09:00:00-07:00",
        end: "2027-03-14T10:00:00-07:00",
        allDay: false,
      },
    ];
    const invoke = await loadHarness(state);
    await assert.rejects(invoke("agenda:createBlock", blockInput()), /overlaps/);
    state.calendarItems = [];
    await invoke("agenda:createBlock", blockInput());
    assert.equal(state.calls.creates, 1);
  });
});

test("a local save failure after event creation recovers from the persisted request marker", async () => {
  await withFixture(async (state) => {
    state.failNextWrite = "after-event";
    const invoke = await loadHarness(state);
    await assert.rejects(invoke("agenda:createBlock", blockInput()), /may exist/);
    const block = await invoke("agenda:createBlock", blockInput());
    assert.equal(state.calls.creates, 1);
    assert.equal(state.remoteEvents.size, 1);
    assert.equal((await invoke("agenda:getState")).state.scheduledBlocks[0].eventId, block.eventId);
  });
});

test("agenda and range handlers reject malformed input before any synthetic write", async () => {
  await withFixture(async (state) => {
    const invoke = await loadHarness(state);
    await assert.rejects(
      invoke("calendar:listRange", { startDate: "2026-02-30", days: 1 }),
      /real date/,
    );
    await assert.rejects(
      invoke("calendar:listRange", { startDate: "2026-03-08", days: 43 }),
      /1 through 42/,
    );
    await assert.rejects(invoke("agenda:createBlock", blockInput({ endTime: "09:00" })), /after/);
    await assert.rejects(
      invoke(
        "agenda:createBlock",
        blockInput({
          task: { key: "task:list-1:task-1", source: "tasks", listId: "list-1", taskId: "wrong" },
        }),
      ),
      /does not match/,
    );
    assert.equal(state.calls.creates, 0);
    assert.equal(state.remoteEvents.size, 0);
  });
});
