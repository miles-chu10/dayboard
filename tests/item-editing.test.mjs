import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let sequence = 0;

function fixture() {
  return {
    handlers: new Map(),
    broadcasts: [],
    calls: [],
    scope: "google:fixture",
    demo: false,
    reconcileFails: false,
    calendarForbidden: false,
  };
}

const backendStub = `
const state = () => globalThis.__itemEditFixture;
export const ipcMain = {
  handle(channel, fn) { state().handlers.set(channel, fn); },
  broadcast(channel, payload) { state().broadcasts.push({ channel, payload }); },
};`;

const googleStub = `
const state = () => globalThis.__itemEditFixture;
export class GoogleApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function updateTask(input) { state().calls.push(["task:update", input]); return { id: input.taskId, listId: input.listId, listTitle: "List", title: input.title, notes: input.notes || null, due: input.due, completed: false, completedAt: null }; }
export async function deleteTask(listId, taskId) { state().calls.push(["task:delete", { listId, taskId }]); }
export async function updateEvent(input) { state().calls.push(["event:update", input]); if (state().calendarForbidden) throw new GoogleApiError(403, "forbidden"); return { id: input.eventId, calendarId: input.calendarId, calendarName: "Work", calendarColor: "#123", title: input.title, description: input.description || null, location: input.location || null, start: input.start, end: input.end, allDay: input.allDay, htmlLink: null, meetLink: null, attendees: [] }; }
export async function getEventForEditing(calendarId, eventId) { state().calls.push(["event:get", { calendarId, eventId }]); return { id: eventId, calendarId, calendarName: "Work", calendarColor: "#123", title: "Event", description: "", location: null, start: "2026-10-02T09:00:00-07:00", end: "2026-10-02T10:00:00-07:00", allDay: false, htmlLink: null, meetLink: null, attendees: [] }; }
export async function deleteEvent(calendarId, eventId) { state().calls.push(["event:delete", { calendarId, eventId }]); if (state().calendarForbidden) throw new GoogleApiError(403, "forbidden"); }
export async function listCalendars() { return { calendars: [{id: 'primary', primary: true}], limited: false }; }
`;

const remindersStub = `
const state = () => globalThis.__itemEditFixture;
export async function updateReminder(input) { state().calls.push(["reminder:update", input]); return { identity: "stable", ref: "replacement-ref", listTitle: "Reminders", title: input.title, notes: input.notes || null, dueDate: input.dueDate, dueTime: input.dueTime, priority: input.priority, completed: false, completedAt: null, recurring: false }; }
export async function deleteReminder(ref) { state().calls.push(["reminder:delete", { ref }]); }
`;

const demoStub = `
const state = () => globalThis.__itemEditFixture;
export function assertNotDemo(channel) { if (state().demo) throw new Error(channel + ": changes are turned off in demo mode."); }
export function isDemoMode() { return state().demo; }
export function demoEventsForDays() { return { state: "ok", items: [] }; }
`;

const pendingStub = `export async function trackPendingWrite(operation) { return Promise.resolve().then(operation); }`;
const agendaStub = `export async function removeDeletedAgendaEvent(scope, eventId) { const state = globalThis.__itemEditFixture; state.calls.push(['event:unlink', {scope,eventId}]); if (state.reconcileFails) throw new Error('disk unavailable'); return {focusKeys: [], duplicateLinks: [], scheduledBlocks: []}; }`;
const productivityStub = `
const state = () => globalThis.__itemEditFixture;
export async function requireAgendaScope() { return state().scope; }
export function requireExpectedAgendaScope(input, scope, channel) { if (input.expectedScope !== scope) throw new Error(channel + ": account changed before this save could be applied. Refresh and try again."); }
export async function reconcileReminderAgendaState(items, previousRefs, scope) { state().calls.push(["reconcile", { items, previousRefs, scope }]); if (state().reconcileFails) throw new Error("disk unavailable"); }
`;

function plugin() {
  const stubs = new Map([
    ["@glaze/core/backend", backendStub],
    ["../services/agenda-store.js", agendaStub],
    ["../services/google-api.js", googleStub],
    ["../services/apple-reminders.js", remindersStub],
    ["../services/demo-data.js", demoStub],
    ["../services/pending-writes.js", pendingStub],
    ["./productivity.js", productivityStub],
  ]);
  return {
    name: "item-editing-fixtures",
    setup(api) {
      api.onResolve({ filter: /.*/ }, (args) =>
        stubs.has(args.path) ? { path: args.path, namespace: "fixture" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function harness(state) {
  globalThis.__itemEditFixture = state;
  const result = await build({
    entryPoints: [path.join(root, "main/handlers/item-editing.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [plugin()],
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// fixture-${sequence++}`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  module.registerItemEditingHandlers();
  return async (channel, payload) => {
    const handler = state.handlers.get(channel);
    assert.ok(handler, `handler ${channel} is registered`);
    return handler({}, { expectedScope: state.scope, ...payload });
  };
}

test("task editing sends a date-only clear and returns the provider's canonical task", async () => {
  const state = fixture();
  const invoke = await harness(state);
  const result = await invoke("tasks:update", {
    listId: "inbox",
    taskId: "task-1",
    title: "Updated task",
    notes: "",
    due: null,
  });
  assert.equal(result.due, null);
  assert.deepEqual(state.calls[0], ["task:update", { listId: "inbox", taskId: "task-1", title: "Updated task", notes: "", due: null }]);
  assert.deepEqual(state.broadcasts, [{ channel: "data:changed", payload: { source: "tasks" } }]);
});

test("reminder editing retains canonical replacement refs when link reconciliation fails", async () => {
  const state = fixture();
  state.reconcileFails = true;
  const invoke = await harness(state);
  const result = await invoke("reminders:update", {
    ref: "old-ref",
    title: "Updated reminder",
    notes: "",
    dueChanged: true,
    dueDate: "2026-10-02",
    dueTime: null,
    priority: 5,
  });
  assert.equal(result.ref, "replacement-ref");
  assert.match(result.agendaSaveError, /could not save its updated item link/);
  assert.equal(state.calls.at(-1)[0], "reconcile");
  assert.equal(state.calls.at(-1)[1].items[0].ref, "replacement-ref");
  assert.deepEqual(state.calls.at(-1)[1].previousRefs, ["old-ref"]);
  assert.equal(state.calls.at(-1)[1].scope, state.scope);
  assert.equal(state.broadcasts.at(-1).payload.source, "reminders");
});

test("calendar editing validates exclusive all-day bounds and preserves the exact selected event ID", async () => {
  const state = fixture();
  const invoke = await harness(state);
  await assert.rejects(
    invoke("calendar:update", {
      calendarId: "work",
      eventId: "instance-1",
      title: "Bad range",
      description: "",
      location: "",
      start: "2026-10-02",
      end: "2026-10-02",
      allDay: true,
      timeZone: "America/Los_Angeles",
      timesChanged: true,
    }),
    /must be after/,
  );
  const result = await invoke("calendar:update", {
    calendarId: "work",
    eventId: "instance-1",
    title: "One occurrence",
    description: "Details",
    location: "Room 3",
    start: "2026-10-02T09:00:00-07:00",
    end: "2026-10-02T10:00:00-07:00",
    allDay: false,
    timeZone: "America/Los_Angeles",
    timesChanged: true,
  });
  assert.equal(result.id, "instance-1");
  assert.equal(state.calls.at(0)[1].eventId, "instance-1");
  assert.equal(state.broadcasts.at(-1).payload.source, "calendar");
});

test("scope and demo guards prevent all provider writes", async () => {
  const state = fixture();
  const invoke = await harness(state);
  await assert.rejects(
    invoke("tasks:delete", { listId: "inbox", taskId: "task-1", expectedScope: "stale" }),
    /account changed/,
  );
  state.demo = true;
  await assert.rejects(
    invoke("calendar:delete", { calendarId: "work", eventId: "event-1" }),
    /turned off in demo mode/,
  );
  assert.deepEqual(state.calls, []);
});

test("delete targets one provider record and calendar permission failures are explicit", async () => {
  const state = fixture();
  const invoke = await harness(state);
  await invoke("tasks:delete", { listId: "inbox", taskId: "task-1" });
  await invoke("reminders:delete", { ref: "current-ref" });
  await invoke("calendar:delete", { calendarId: "work", eventId: "instance-1" });
  assert.deepEqual(state.calls, [
    ["task:delete", { listId: "inbox", taskId: "task-1" }],
    ["reminder:delete", { ref: "current-ref" }],
    ["event:delete", { calendarId: "work", eventId: "instance-1" }],
  ]);
  state.calendarForbidden = true;
  await assert.rejects(
    invoke("calendar:delete", { calendarId: "work", eventId: "read-only" }),
    /read-only/,
  );
});

async function providerModule(entry, stubs) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "provider-fixtures",
        setup(api) {
          api.onResolve({ filter: /.*/ }, (args) =>
            stubs.has(args.path) ? { path: args.path, namespace: "provider-fixture" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "provider-fixture" }, (args) => ({
            contents: stubs.get(args.path),
            loader: "js",
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n// provider-${sequence++}`).toString("base64")}`,
  );
}

test("Google provider fixtures PATCH only editable task and instance fields", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const request = String(url);
    const json = (body) => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    });
    if (request.includes("tasks.googleapis.com") && request.includes("/lists/inbox/tasks/task-1"))
      return json({ id: "task-1", title: "Updated", notes: "", due: undefined, status: "needsAction" });
    if (request.includes("tasks.googleapis.com") && request.endsWith("/lists/inbox"))
      return json({ id: "inbox", title: "Inbox" });
    if (request.includes("calendarList"))
      return json({ items: [{ id: "work", summary: "Work", primary: true }] });
    if (request.includes("/events/instance-1") && init.method !== "PATCH")
      return json({ id: "instance-1", recurringEventId: "series-1" });
    if (request.includes("/events/instance-1") && init.method === "PATCH")
      return json({
        id: "instance-1",
        summary: "One occurrence",
        start: { dateTime: "2026-10-02T09:00:00-07:00" },
        end: { dateTime: "2026-10-02T10:00:00-07:00" },
      });
    if (request.includes("/events/full-description"))
      return json({
        id: "full-description",
        summary: "Long notes",
        description: `<p>${"x".repeat(800)}</p>`,
        start: { dateTime: "2026-10-02T09:00:00-07:00" },
        end: { dateTime: "2026-10-02T10:00:00-07:00" },
      });
    throw new Error(`unexpected URL ${request}`);
  };
  try {
    const api = await providerModule(
      "main/services/google-api.ts",
      new Map([["./google-auth.js", `export async function getGoogleAccessToken() { return "fixture"; } export class GoogleAuthError extends Error {}`]]),
    );
    const task = await api.updateTask({
      listId: "inbox",
      taskId: "task-1",
      title: "Updated",
      notes: "",
      due: null,
    });
    assert.equal(task.due, null);
    const taskPatch = requests.find((request) => String(request.url).includes("/tasks/task-1"));
    assert.deepEqual(JSON.parse(taskPatch.init.body), { title: "Updated", notes: null, due: null });

    const event = await api.updateEvent({
      calendarId: "work",
      eventId: "instance-1",
      title: "One occurrence",
      description: "",
      location: "",
      start: "2026-10-02T09:00:00-07:00",
      end: "2026-10-02T10:00:00-07:00",
      allDay: false,
      timeZone: "America/Los_Angeles",
      timesChanged: true,
    });
    assert.equal(event.id, "instance-1");
    const eventPatch = requests.find(
      (request) => String(request.url).includes("/events/instance-1") && request.init.method === "PATCH",
    );
    assert.deepEqual(JSON.parse(eventPatch.init.body), {
      summary: "One occurrence",
      description: null,
      location: null,
      start: { dateTime: "2026-10-02T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-10-02T10:00:00-07:00", timeZone: "America/Los_Angeles" },
    });
    await api.updateEvent({
      calendarId: "work",
      eventId: "instance-1",
      title: "Title only",
      location: "",
      start: "2026-10-02T09:00:00-07:00",
      end: "2026-10-02T10:00:00-07:00",
      allDay: false,
      timeZone: "America/Los_Angeles",
      timesChanged: false,
    });
    const titleOnlyPatch = requests.filter(
      (request) => String(request.url).includes("/events/instance-1") && request.init.method === "PATCH",
    ).at(-1);
    const titleOnlyBody = JSON.parse(titleOnlyPatch.init.body);
    assert.equal("description" in titleOnlyBody, false);
    assert.equal("start" in titleOnlyBody, false);
    assert.equal("end" in titleOnlyBody, false);
    const editable = await api.getEventForEditing("work", "full-description");
    assert.equal(editable.description, `<p>${"x".repeat(800)}</p>`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google Task metadata failures happen before a task write", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return {
      status: 500,
      ok: false,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: "fixture metadata failure" } }),
    };
  };
  try {
    const api = await providerModule(
      "main/services/google-api.ts",
      new Map([["./google-auth.js", `export async function getGoogleAccessToken() { return "fixture"; } export class GoogleAuthError extends Error {}`]]),
    );
    await assert.rejects(
      api.updateTask({ listId: "inbox", taskId: "task-1", title: "Updated", notes: "", due: null }),
      /metadata failure/,
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/users\/@me\/lists\/inbox$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Apple Reminders fixture clears fields and refuses recurring series edits or deletion", async () => {
  const calls = [];
  const recurring = { ref: { value: "series" }, externalId: null, calendarId: "home", title: "Series", notes: null, due: null, priority: 0, isCompleted: false, completionDate: null, recurrenceRules: [{}] };
  const ordinary = { ref: { value: "new-ref" }, externalId: "external", calendarId: "home", title: "Updated", notes: null, due: null, priority: 5, isCompleted: false, completionDate: null, recurrenceRules: [] };
  const service = await providerModule(
    "main/services/apple-reminders.ts",
    new Map([
      [
        "@glaze/core/backend",
        `export const systemPreferences = {}; export const reminders = {
          getCalendars: async () => [{ id: "home", title: "Home" }],
          getReminder: async ({ value }) => value === "series" ? globalThis.__recurring : globalThis.__ordinary,
          updateReminder: async (ref, patch) => { globalThis.__reminderCalls.push([ref, patch]); return globalThis.__ordinary; },
          deleteReminder: async (ref) => { globalThis.__reminderCalls.push(["delete", ref]); },
        };`,
      ],
    ]),
  );
  globalThis.__recurring = recurring;
  globalThis.__ordinary = ordinary;
  globalThis.__reminderCalls = calls;
  try {
    const updated = await service.updateReminder({ ref: "old-ref", title: "Updated", notes: "", dueChanged: true, dueDate: null, dueTime: null, priority: 5 });
    assert.equal(updated.ref, "new-ref");
    assert.deepEqual(calls[0][1].clearFields, ["notes", "due"]);
    globalThis.__ordinary = {
      ...ordinary,
      due: { kind: "date-time", dateTime: "2026-10-02T09:00:00", timeZone: "America/New_York" },
    };
    await service.updateReminder({
      ref: "old-ref",
      title: "Title only",
      notes: "Keep notes",
      dueChanged: false,
      priority: 5,
    });
    assert.equal(calls[1][1].due, undefined);
    assert.equal(calls[1][1].clearFields.includes("due"), false);
    await assert.rejects(
      service.updateReminder({ ref: "series", title: "Series", notes: "", dueChanged: true, dueDate: null, dueTime: null, priority: 0 }),
      /safe one-occurrence edit/,
    );
    await assert.rejects(service.deleteReminder("series"), /safe one-occurrence delete/);
    assert.equal(calls.length, 2);
  } finally {
    delete globalThis.__recurring;
    delete globalThis.__ordinary;
    delete globalThis.__reminderCalls;
  }
});
