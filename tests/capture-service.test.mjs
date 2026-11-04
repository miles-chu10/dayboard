import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { createCaptureService } = await loadTs("main/services/capture/capture-service.ts");
const { completeCapture } = await loadTs("main/services/capture/capture-completion.ts");
const { createLicenseOperations } = await loadTs("main/services/license/license-operations.ts");
const { LicenseService } = await loadTs("main/services/license/license-service.ts");
const { LicenseRequiredError } = await loadTs("shared/license-policy.ts");

const ACCOUNT_CHANGED = "Your account changed. Check the details and add it again.";

function settings({ ai = true, capture = true } = {}) {
  return {
    ai: { enabled: ai, providerChosen: true, features: { capture } },
    sources: {
      tasks: { enabled: true },
      reminders: { enabled: true },
      calendar: { enabled: true },
    },
  };
}

function harness(options = {}) {
  const calls = {
    license: 0,
    complete: 0,
    create: [],
    remove: [],
    created: [],
    failed: [],
    changes: 0,
  };
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
    getAccounts: async () =>
      options.accounts ?? { google: { connected: true }, reminders: "full-access" },
    assertAiAccess: async () => {
      calls.license += 1;
      await options.duringLicense?.(state);
      await options.assertAiAccess?.();
    },
    complete: async () => {
      calls.complete += 1;
      if (options.complete) return options.complete();
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
  assert.equal(calls.license, 0);
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
  assert.equal(calls.license, 0, "no AI runs, so no license check");
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

for (const phase of [
  "duringScope",
  "duringSettings",
  "duringLicense",
  "duringComplete",
  "duringCreate",
]) {
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

for (const [label, guardError] of [
  ["a license block", () => new LicenseRequiredError("expired")],
  ["any other license failure", () => new Error("License status is not ready. Try again shortly.")],
]) {
  test(`${label} after an account change cannot publish old capture data`, async () => {
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    const { service, calls, state } = harness({
      duringLicense: async () => {
        entered.resolve();
        await released.promise;
      },
      assertAiAccess: async () => {
        throw guardError();
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
    assert.deepEqual(calls.failed, [], "no old-account failure or panel reopen");
    assert.equal(calls.complete, 0);
    assert.deepEqual(calls.create, []);
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

test("the sixth capture does not expire an earlier notification's Undo", async () => {
  const { service, calls } = harness();
  const first = await service.submit({ text: "First item" });
  for (let i = 0; i < 5; i++) await service.submit({ text: `Later item ${i}` });
  assert.equal(
    service.recent().some((record) => record.id === first.id),
    false,
  );
  const [a, b] = await Promise.all([service.undo(first.id), service.undo(first.id)]);
  assert.equal(a.state, "undone");
  assert.equal(b.state, "undone");
  assert.equal((await service.undo(first.id)).state, "undone");
  assert.deepEqual(calls.remove, [["reminder", "r1"]]);
});

test("an evicted notification's Undo still expires after ten minutes", async () => {
  const { service, calls, state } = harness();
  const first = await service.submit({ text: "First item" });
  for (let i = 0; i < 5; i++) await service.submit({ text: `Later item ${i}` });
  state.clock = new Date(state.clock.getTime() + 10 * 60_000 + 1);
  await assert.rejects(service.undo(first.id), /no longer available/);
  assert.deepEqual(calls.remove, []);
});

test("Undo's ten minutes starts when provider creation succeeds", async () => {
  const { service, state } = harness({
    duringCreate: async (state) => {
      state.clock = new Date(state.clock.getTime() + 5 * 60_000);
    },
  });
  const first = await service.submit({ text: "Slow provider" });
  state.clock = new Date(state.clock.getTime() + 9 * 60_000);
  assert.equal((await service.undo(first.id)).state, "undone");
});

test("a timed-out capture preserves its text for manual recovery and ignores late success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = Promise.withResolvers();
  const late = Promise.withResolvers();
  const { service, calls } = harness({
    complete: () =>
      completeCapture(() => {
        entered.resolve();
        return late.promise;
      }),
  });
  const submitted = service.submit({ text: "Keep my capture" });
  await entered.promise;
  t.mock.timers.tick(3 * 60_000);
  const result = await submitted;
  assert.equal(result.state, "failed");
  assert.match(result.error, /timed out/);
  assert.deepEqual(result.partial, { title: "Keep my capture" });
  assert.equal(calls.create.length, 0);
  late.resolve({ text: JSON.stringify({ kind: "task", title: "Too late" }) });
  await Promise.resolve();
  assert.equal(calls.create.length, 0);
  assert.equal(service.recent()[0].state, "failed");
});

// Quick Capture against the real license operations and trial clock, with an in-memory store and a
// stub license service: only an AI parse is paid, and a locked parse keeps the text for the form.
const DAY_MS = 86_400_000;
const LICENSE_META = {
  issuer: "https://license.example",
  productId: "prod_capture",
  environment: "test",
};
const LICENSE_TERMS = { status: "active", expiresAt: null };
const LICENSE_KEY = `DAYB_${"C".repeat(43)}`;

async function licenseStack(stage) {
  let stored = null;
  const store = {
    read: async () => stored,
    write: async (record) => void (stored = structuredClone(record)),
  };
  const verifier = {
    validate: async (_key, instanceId) => ({
      valid: true,
      instanceId,
      license: LICENSE_TERMS,
      meta: LICENSE_META,
    }),
    activate: async () => ({
      activated: true,
      created: true,
      instanceId: "capture-mac",
      license: LICENSE_TERMS,
      meta: LICENSE_META,
    }),
  };
  const service = new LicenseService(verifier, store, {
    trialDays: 7,
    revalidateIntervalMs: DAY_MS,
    offlineGraceDays: 30,
    product: { ...LICENSE_META, apiUrl: LICENSE_META.issuer },
  });
  if (stage === "expired") await service.startTrial(new Date(Date.now() - 8 * DAY_MS));
  if (stage === "licensed") await service.activate(LICENSE_KEY, "Capture Mac");
  const operations = createLicenseOperations({
    mode: () => "configured",
    checkoutUrl: "",
    getService: async () => service,
  });
  return {
    assertAiAccess: operations.assertLicenseAccess,
    trialStartedAt: () => stored?.firstLaunchAt ?? null,
    status: () => service.getStatus(),
  };
}

const MANUAL_DRAFT = {
  kind: "task",
  title: "Pay rent",
  notes: "",
  date: "2026-11-01",
  time: "",
  endTime: "",
};

for (const aiCapture of [true, false]) {
  test(`a manual capture is free and never starts the AI trial (AI capture ${aiCapture ? "on" : "off"})`, async () => {
    const license = await licenseStack("fresh");
    const { service, calls } = harness({
      settings: settings({ capture: aiCapture }),
      assertAiAccess: license.assertAiAccess,
    });
    const record = await service.submit({ draft: MANUAL_DRAFT });
    assert.equal(record.state, "created");
    assert.equal(calls.license, 0);
    assert.equal(calls.complete, 0);
    assert.equal(license.trialStartedAt(), null);
    assert.deepEqual(await license.status(), { state: "trial", daysLeft: 7 });
  });
}

test("a manual capture still works after the AI trial ends without a license", async () => {
  const license = await licenseStack("expired");
  const { service, calls } = harness({ assertAiAccess: license.assertAiAccess });
  const record = await service.submit({ draft: MANUAL_DRAFT });
  assert.equal(record.state, "created");
  assert.equal(calls.license, 0);
  assert.equal(calls.complete, 0);
  assert.deepEqual(await license.status(), { state: "expired" });
});

test("text with AI capture off goes to the form without starting the AI trial", async () => {
  const license = await licenseStack("fresh");
  const { service, calls } = harness({
    settings: settings({ capture: false }),
    assertAiAccess: license.assertAiAccess,
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(calls.license, 0);
  assert.equal(license.trialStartedAt(), null);
});

test("the first AI-parsed capture starts the AI trial before calling AI", async () => {
  const license = await licenseStack("fresh");
  let trialAtParse = null;
  const { service, calls } = harness({
    assertAiAccess: license.assertAiAccess,
    duringComplete: () => {
      trialAtParse = license.trialStartedAt();
    },
  });
  const before = Date.now();
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "created");
  assert.equal(calls.license, 1);
  assert.equal(calls.complete, 1);
  assert.ok(trialAtParse, "the trial started before the AI call");
  assert.ok(Date.parse(license.trialStartedAt()) >= before);
  assert.deepEqual(await license.status(), { state: "trial", daysLeft: 7 });
});

test("an AI-parsed capture is blocked after the trial without a license and keeps the text", async () => {
  const license = await licenseStack("expired");
  const { service, calls } = harness({ assertAiAccess: license.assertAiAccess });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(
    record.error,
    "Your AI trial has ended, so DayBoard can't read this for you. " +
      "Fill in the details to add it without AI, or get DayBoard Pro in Settings → License.",
  );
  assert.equal(record.reason, "license", "the panels can offer DayBoard Pro");
  assert.equal(record.text, "Call dentist Thursday 3pm");
  assert.deepEqual(record.partial, { title: "Call dentist Thursday 3pm" });
  assert.equal(calls.complete, 0, "no AI call");
  assert.equal(calls.create.length, 0);
  assert.equal(calls.failed.length, 1, "the panel reopens with the text for the manual form");

  const manual = await service.submit({ draft: { ...MANUAL_DRAFT, title: record.text } });
  assert.equal(manual.state, "created", "the manual form still adds it");
  assert.equal(calls.license, 1);
});

test("a licensed AI-parsed capture is allowed", async () => {
  const license = await licenseStack("licensed");
  const { service, calls } = harness({ assertAiAccess: license.assertAiAccess });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "created");
  assert.equal(calls.license, 1);
  assert.equal(calls.complete, 1);
  assert.deepEqual(await license.status(), { state: "licensed", keyHint: "CCCC" });
});

for (const [lock, copy] of [
  [
    "invalid",
    /^Your license key isn't valid, so DayBoard can't read this for you\. .*check your key/,
  ],
  ["network-error", /^DayBoard can't verify your license, so it can't read this for you\./],
]) {
  test(`a parse locked by a license that is ${lock} names why and keeps the text`, async () => {
    const { service, calls } = harness({
      assertAiAccess: async () => {
        throw new LicenseRequiredError(lock);
      },
    });
    const record = await service.submit({ text: "Call dentist Thursday 3pm" });
    assert.equal(record.state, "failed");
    assert.match(record.error, copy);
    assert.match(record.error, /Fill in the details to add it without AI/);
    assert.equal(record.reason, "license");
    assert.deepEqual(record.partial, { title: "Call dentist Thursday 3pm" });
    assert.equal(calls.complete, 0);
  });
}

test("a license check that fails for another reason keeps its own message", async () => {
  const { service, calls } = harness({
    assertAiAccess: async () => {
      throw new Error("License status is not ready. Try again shortly.");
    },
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(
    record.error,
    "License status is not ready. Try again shortly. Fill in the details to add it without AI.",
  );
  assert.equal(record.reason, null);
  assert.equal(calls.complete, 0);
});

test("text with nowhere to add it neither starts the AI trial nor calls AI", async () => {
  const license = await licenseStack("fresh");
  const { service, calls } = harness({
    accounts: { google: { connected: false }, reminders: "denied" },
    assertAiAccess: license.assertAiAccess,
  });
  const record = await service.submit({ text: "Call dentist Thursday 3pm" });
  assert.equal(record.state, "failed");
  assert.equal(record.error, "Connect Google or allow Reminders access to add items.");
  assert.deepEqual(record.partial, { title: "Call dentist Thursday 3pm" });
  assert.equal(calls.license, 0);
  assert.equal(calls.complete, 0);
  assert.equal(license.trialStartedAt(), null);
});
