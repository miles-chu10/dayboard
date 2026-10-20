import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { createCaptureService } = await loadTs("main/services/capture/capture-service.ts");

const ACCOUNT_CHANGED = "Your account changed. Check the details and add it again.";

function settings({ ai = true, capture = true } = {}) {
  return {
    ai: { enabled: ai, features: { capture } },
    sources: {
      tasks: { enabled: true },
      reminders: { enabled: true },
      calendar: { enabled: true },
    },
  };
}

function harness(options = {}) {
  const calls = { complete: 0, create: [], remove: [], created: [], failed: [], changes: 0 };
  const state = { scope: "account-a", clock: new Date(2026, 9, 20, 9, 0), ids: 0 };
  const output =
    options.output ??
    JSON.stringify({ kind: "reminder", title: "Call dentist", date: "2026-10-22", time: "15:00" });
  const service = createCaptureService({
    isDemoMode: () => options.demo ?? false,
    currentScope: async () => {
      const scope = state.scope;
      await options.duringScope?.(state);
      return scope;
    },
    guardedWrite: async (scope, write) => {
      if (scope !== state.scope) throw new Error(ACCOUNT_CHANGED);
      return write();
    },
    getSettings: async () => {
      await options.duringSettings?.(state);
      return options.settings ?? settings();
    },
    getAccounts: async () => ({ google: { connected: true }, reminders: "full-access" }),
    complete: async () => {
      calls.complete += 1;
      await options.duringComplete?.(state);
      if (options.completeError) throw new Error(options.completeError);
      return output;
    },
    create: {
      task: async (draft) => (
        calls.create.push(["task", draft]),
        { listId: "@default", taskId: "t1" }
      ),
      reminder: async (draft) => {
        calls.create.push(["reminder", draft]);
        await options.duringCreate?.(state);
        if (options.createError) throw new Error(options.createError);
        return { ref: `r${calls.create.length}` };
      },
      event: async (draft) => (
        calls.create.push(["event", draft]),
        { calendarId: "primary", eventId: "e1" }
      ),
    },
    remove: {
      task: async (ref) => calls.remove.push(["task", ref]),
      reminder: async (ref) => {
        if (options.removeError) throw new Error(options.removeError);
        calls.remove.push(["reminder", ref]);
      },
      event: async (ref) => calls.remove.push(["event", ref]),
    },
    onChange: () => (calls.changes += 1),
    onCreated: (record) => calls.created.push(record),
    onFailed: (record) => calls.failed.push(record),
    now: () => state.clock,
    newId: () => `capture-${++state.ids}`,
  });
  return { service, calls, state };
}

test("creates a reminder from AI output and reports it", async () => {
  const { service, calls } = harness();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "created");
  assert.equal(record.canUndo, true);
  assert.deepEqual(record.draft, {
    kind: "reminder",
    title: "Call dentist",
    notes: "",
    date: "2026-10-22",
    time: "15:00",
    endTime: "",
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.created.length, 1);
  assert.equal("ref" in record, false, "provider identifiers never leave the service");
});

test("uses the manual draft without calling AI", async () => {
  const { service, calls } = harness({ settings: settings({ ai: false }) });
  const record = await service.submit({
    draft: {
      kind: "task",
      title: "Pay rent",
      notes: "",
      date: "2026-11-01",
      time: "",
      endTime: "",
    },
  });
  assert.equal(record.state, "created");
  assert.equal(calls.complete, 0);
  assert.deepEqual(
    calls.create.map(([kind]) => kind),
    ["task"],
  );
});

test("rejects text when AI capture is off", async () => {
  const { service, calls } = harness({ settings: settings({ capture: false }) });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(record.error, "Fill in the details, then add it.");
  assert.deepEqual(record.partial, { title: "Call dentist Thursday 3pm" });
  assert.equal(calls.complete, 0);
  assert.equal(calls.create.length, 0);
});

test("sends an unclear parse to the manual form without creating", async () => {
  const { service, calls } = harness({
    output: JSON.stringify({
      kind: "reminder",
      title: "Call dentist",
      date: "2026-10-22",
      time: "3pm",
    }),
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(record.error, "The time wasn't clear. Check the details, then add it.");
  assert.equal(calls.create.length, 0);
  assert.equal(calls.failed.length, 1);
});

test("keeps the cleanly parsed fields as partial on an unclear parse", async () => {
  const { service } = harness({
    output: JSON.stringify({
      kind: "task",
      title: "Call dentist",
      date: "2026-10-22",
      time: "15:00",
    }),
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.deepEqual(record.partial, {
    kind: "task",
    title: "Call dentist",
    date: "2026-10-22",
    time: "15:00",
  });
});

test("marks a parse failure and keeps the text", async () => {
  const { service } = harness({ output: "I could not do that." });
  const record = await service.submit({ text: "something vague" });
  assert.equal(record.state, "failed");
  assert.equal(record.text, "something vague");
  assert.deepEqual(record.partial, { title: "something vague" });
});

test("marks a create failure with the provider message", async () => {
  const { service } = harness({ createError: "Reminders is not reachable." });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(record.error, "Reminders is not reachable.");
  assert.equal(record.canUndo, false);
});

test("refuses demo mode before calling anything", async () => {
  const { service, calls } = harness({ demo: true });
  await assert.rejects(service.submit({ text: "Call dentist" }), /turned off in demo mode/);
  assert.equal(calls.complete, 0);
  assert.equal(calls.changes, 0);
});

test("refuses to create after an account change during parsing", async () => {
  const { service, calls } = harness({
    duringComplete: async (state) => {
      state.scope = "account-b";
    },
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(record.error, ACCOUNT_CHANGED);
  assert.equal(calls.create.length, 0);
});

test("undo deletes exactly the created item", async () => {
  const { service, calls } = harness();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  const undone = await service.undo(record.id);
  assert.equal(undone.state, "undone");
  assert.equal(undone.canUndo, false);
  assert.deepEqual(calls.remove, [["reminder", "r1"]]);
});

test("undo is idempotent", async () => {
  const { service, calls } = harness();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  const [first, second] = await Promise.all([service.undo(record.id), service.undo(record.id)]);
  const third = await service.undo(record.id);
  assert.equal(first.state, "undone");
  assert.equal(second.state, "undone");
  assert.equal(third.state, "undone");
  assert.equal(calls.remove.length, 1);
});

test("undo reports a failed delete", async () => {
  const { service, calls } = harness({ removeError: "Reminders is not reachable." });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  await assert.rejects(service.undo(record.id), /Reminders is not reachable/);
  const [after] = service.recent();
  assert.equal(after.state, "created");
  assert.equal(after.error, "Reminders is not reachable.");
  assert.equal(after.canUndo, false, "Undo makes one delete attempt");
  assert.equal(calls.remove.length, 0);
});

test("a failed undo is never retried", async () => {
  let attempts = 0;
  const { service } = harness({ removeError: "Reminders is not reachable." });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  await assert.rejects(service.undo(record.id), () => {
    attempts += 1;
    return true;
  });
  await assert.rejects(service.undo(record.id), /no longer available/);
  assert.equal(attempts, 1);
});

test("undo refuses after an account change", async () => {
  const { service, calls, state } = harness();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  state.scope = "account-b";
  await assert.rejects(service.undo(record.id), new RegExp(ACCOUNT_CHANGED));
  assert.equal(calls.remove.length, 0);
});

test("undo expires after 10 minutes", async () => {
  const { service, calls, state } = harness();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  state.clock = new Date(state.clock.getTime() + 10 * 60_000 + 1);
  await assert.rejects(service.undo(record.id), /Undo is no longer available/);
  assert.equal(service.recent()[0].canUndo, false);
  assert.equal(calls.remove.length, 0);
});

test("keeps only the five newest records", async () => {
  const { service } = harness();
  for (let index = 0; index < 7; index += 1) await service.submit({ text: `Item ${index}` });
  const recent = service.recent();
  assert.equal(recent.length, 5);
  assert.deepEqual(
    recent.map((record) => record.id),
    ["capture-7", "capture-6", "capture-5", "capture-4", "capture-3"],
  );
});

test("two concurrent submits both complete", async () => {
  const { service, calls } = harness();
  const [first, second] = await Promise.all([
    service.submit({ text: "Call dentist Thursday 3pm" }),
    service.submit({ text: "Call mom Friday 5pm" }),
  ]);
  assert.equal(first.state, "created");
  assert.equal(second.state, "created");
  assert.equal(calls.create.length, 2);
});

for (const phase of ["duringScope", "duringSettings", "duringComplete", "duringCreate"]) {
  test(`account changes during ${phase} cannot publish old capture data`, async () => {
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    const { service, calls, state } = harness({
      [phase]: async () => {
        entered.resolve();
        await released.promise;
      },
    });
    const pending = service.submit({ text: "Private account A capture" });
    await entered.promise;
    state.scope = "account-b";
    service.clear();
    const changesAtClear = calls.changes;
    released.resolve();
    await assert.rejects(pending, /account changed/i);
    assert.deepEqual(service.recent(), []);
    assert.equal(calls.changes, changesAtClear, "no stale records broadcast after clear");
    assert.deepEqual(calls.created, [], "no old-account notification");
    assert.deepEqual(calls.failed, [], "no old-account failure or panel reopen");
    if (phase !== "duringCreate") assert.deepEqual(calls.create, []);
  });
}

test("clear removes existing records and Undo access", async () => {
  const { service, calls } = harness();
  const record = await service.submit({ text: "Private account A capture" });
  service.clear();
  assert.deepEqual(service.recent(), []);
  await assert.rejects(service.undo(record.id), /no longer available/);
  assert.deepEqual(calls.remove, []);
});

test("switching away and back still discards an old failed parse", async () => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const { service, calls, state } = harness({
    duringComplete: async () => {
      entered.resolve();
      await released.promise;
    },
    completeError: "Private provider error",
  });
  const pending = service.submit({ text: "Private account A capture" });
  await entered.promise;
  state.scope = "account-b";
  service.clear();
  state.scope = "account-a";
  service.clear();
  released.resolve();
  await assert.rejects(pending, /account changed/i);
  assert.deepEqual(service.recent(), []);
  assert.deepEqual(calls.failed, []);
  assert.deepEqual(calls.create, []);
});
