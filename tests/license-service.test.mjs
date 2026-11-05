import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const key = (c) => `DAYB_${c.repeat(43)}`;
const A = key("A");
const B = key("B");
const META = { issuer: "https://license.example", productId: "prod_abc", environment: "test" };
const LICENSE = { status: "active", expiresAt: null };
const NOW = new Date("2026-01-01T00:00:00Z");
const DAY = 86_400_000;
const OPTIONS = {
  trialDays: 14,
  revalidateIntervalMs: DAY,
  offlineGraceDays: 30,
  product: { ...META, apiUrl: META.issuer },
};
let sequence = 0;

async function load() {
  const result = await build({
    entryPoints: [path.join(root, "main/services/license/license-service.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(
      result.outputFiles[0].text + `\n// ${sequence++}`,
    ).toString("base64")}`
  );
}

function store(initial = null) {
  let current = initial;
  const calls = { read: 0, write: 0 };
  const replaced = [];
  const setAside = [];
  return {
    calls,
    replaced,
    setAside,
    async read() {
      calls.read++;
      return current;
    },
    async write(next) {
      calls.write++;
      current = structuredClone(next);
    },
    async replaceUnreadable(next) {
      replaced.push(structuredClone(next));
      current = structuredClone(next);
    },
    async setAsideUnreadable() {
      setAside.push(current);
      current = null;
    },
    current: () => current,
  };
}

/** A store whose saved file can't be decrypted until it is replaced or set aside. */
function unreadableStore(UnreadableLicenseRecordError) {
  const s = store();
  let unreadable = true;
  const read = s.read;
  s.read = async () => {
    if (unreadable) {
      s.calls.read++;
      throw new UnreadableLicenseRecordError("Saved DayBoard license data can't be decrypted.");
    }
    return read();
  };
  const replace = s.replaceUnreadable;
  s.replaceUnreadable = async (next) => {
    unreadable = false;
    return replace(next);
  };
  const setAside = s.setAsideUnreadable;
  s.setAsideUnreadable = async () => {
    unreadable = false;
    return setAside();
  };
  return s;
}

/**
 * Models the license service: one activation per key and installation, at most `limit` per key,
 * and validation that names a deleted instance answers invalid_instance.
 */
function licenseServer({ limit = 3 } = {}) {
  const activations = new Map();
  const calls = { validate: [], activate: [], deactivate: [] };
  let created = 0;
  return {
    calls,
    activations,
    async validate(licenseKey, instanceId) {
      calls.validate.push({ licenseKey, instanceId });
      if (instanceId && activations.get(instanceId)?.licenseKey !== licenseKey)
        return { valid: false, error: "invalid_instance" };
      return { valid: true, ...(instanceId ? { instanceId } : {}), license: LICENSE, meta: META };
    },
    async activate(licenseKey, installationId, instanceName) {
      calls.activate.push({ licenseKey, installationId, instanceName });
      for (const [instanceId, item] of activations) {
        if (item.licenseKey === licenseKey && item.installationId === installationId)
          return { activated: true, created: false, instanceId, license: LICENSE, meta: META };
      }
      if (
        [...activations.values()].filter((item) => item.licenseKey === licenseKey).length >= limit
      )
        return { activated: false, error: "activation_limit" };
      const instanceId = `inst-${++created}`;
      activations.set(instanceId, { licenseKey, installationId });
      return { activated: true, created: true, instanceId, license: LICENSE, meta: META };
    },
    async deactivate(licenseKey, instanceId) {
      calls.deactivate.push({ licenseKey, instanceId });
      if (activations.get(instanceId)?.licenseKey === licenseKey) activations.delete(instanceId);
      return { deactivated: true };
    },
  };
}

function verifier(overrides = {}) {
  const calls = { validate: [], activate: [], deactivate: [] };
  return {
    calls,
    async validate(licenseKey, instanceId) {
      calls.validate.push({ licenseKey, instanceId });
      if (overrides.validate) return overrides.validate(licenseKey, instanceId);
      return { valid: true, instanceId, license: LICENSE, meta: META };
    },
    async activate(licenseKey, installationId, instanceName) {
      calls.activate.push({ licenseKey, installationId, instanceName });
      if (overrides.activate) return overrides.activate(licenseKey, installationId, instanceName);
      return {
        activated: true,
        created: true,
        instanceId: `inst-${licenseKey.slice(-1)}`,
        license: LICENSE,
        meta: META,
      };
    },
    async deactivate(licenseKey, instanceId) {
      calls.deactivate.push({ licenseKey, instanceId });
      return overrides.deactivate?.(licenseKey, instanceId) ?? { deactivated: true };
    },
  };
}

async function setup(options = OPTIONS, initial = null, overrides = {}) {
  const { LicenseService } = await load();
  const s = store(initial);
  const v = verifier(overrides);
  return { service: new LicenseService(v, s, options), s, v };
}

test("the trial does not start until the first AI use", async () => {
  const { service, s, v } = await setup();
  const later = new Date(+NOW + 365 * DAY);
  assert.deepEqual(await service.getStatus(later), { state: "trial", daysLeft: 14 });
  assert.deepEqual(await service.refresh(later), { state: "trial", daysLeft: 14 });
  assert.equal(s.current(), null);
  assert.deepEqual(s.calls.write, 0);
  await service.startTrial(later);
  const anchor = s.current().firstLaunchAt;
  assert.equal(anchor, later.toISOString());
  await service.startTrial(new Date(+later + 3 * DAY));
  assert.equal(s.current().firstLaunchAt, anchor);
  assert.deepEqual(await service.getStatus(new Date(+later + 3 * DAY)), {
    state: "trial",
    daysLeft: 11,
  });
  assert.deepEqual(v.calls.validate, []);
});

test("14-day trial expires at boundary and deactivation keeps installation identity", async () => {
  const { service, s } = await setup();
  await service.startTrial(NOW);
  assert.deepEqual(await service.getStatus(NOW), { state: "trial", daysLeft: 14 });
  assert.deepEqual(await service.getStatus(new Date(+NOW + 13 * DAY)), {
    state: "trial",
    daysLeft: 1,
  });
  assert.deepEqual(await service.getStatus(new Date(+NOW + 14 * DAY)), { state: "expired" });
  await service.activate(A, "Mac", NOW);
  const id = s.current().installationId;
  await service.deactivate(new Date(+NOW + DAY));
  assert.equal(s.current().installationId, id);
  assert.equal(s.current().licenseKey, null);
});

test("a future or invalid trial anchor cannot extend or revive an expired trial", async () => {
  const { service, s, v } = await setup();
  await service.startTrial(NOW);
  assert.deepEqual(await service.getStatus(NOW), { state: "trial", daysLeft: OPTIONS.trialDays });
  assert.deepEqual(await service.getStatus(new Date(+NOW + DAY - 1)), {
    state: "trial",
    daysLeft: OPTIONS.trialDays,
  });
  assert.deepEqual(await service.getStatus(new Date(+NOW + DAY)), {
    state: "trial",
    daysLeft: OPTIONS.trialDays - 1,
  });
  assert.deepEqual(await service.getStatus(new Date(+NOW + 14 * DAY)), { state: "expired" });

  for (const rollback of [new Date(+NOW - 1), new Date(+NOW - 365 * DAY)]) {
    assert.deepEqual(await service.getStatus(rollback), { state: "expired" });
    assert.deepEqual(await service.refresh(rollback), { state: "expired" });
  }
  assert.equal(s.current().firstLaunchAt, NOW.toISOString());
  assert.deepEqual(v.calls.validate, []);

  const invalid = { ...s.current(), firstLaunchAt: "not-a-timestamp" };
  const {
    service: invalidService,
    s: invalidStore,
    v: invalidVerifier,
  } = await setup(OPTIONS, invalid);
  assert.deepEqual(await invalidService.getStatus(NOW), { state: "expired" });
  assert.deepEqual(await invalidService.refresh(NOW), { state: "expired" });
  assert.equal(invalidStore.current().firstLaunchAt, invalid.firstLaunchAt);
  assert.deepEqual(invalidVerifier.calls.validate, []);
});

test("invalid key formats never reach the network or store, including legacy and Stripe keys", async () => {
  const { service, s, v } = await setup();
  for (const candidate of ["OLD-LEMON-KEY", "sk_live_secret", "pk_test_secret", "DAYB_short"]) {
    await assert.rejects(service.activate(candidate, "Mac", NOW), /DayBoard license key/);
  }
  assert.deepEqual(s.calls, { read: 0, write: 0 });
  assert.equal(v.calls.validate.length, 0);
});

test("preflight rejects foreign issuer, product, mode and expired key without consuming a slot", async () => {
  for (const candidate of [
    { meta: { ...META, issuer: "https://other.example" } },
    { meta: { ...META, productId: "prod_other" } },
    { meta: { ...META, environment: "live" } },
    { license: { status: "revoked", expiresAt: null } },
    { license: { status: "active", expiresAt: "2025-12-31T00:00:00Z" } },
  ]) {
    const { service, s, v } = await setup(OPTIONS, null, {
      validate: () => ({ valid: true, license: LICENSE, meta: META, ...candidate }),
    });
    await assert.rejects(service.activate(A, "Mac", NOW));
    assert.equal(v.calls.activate.length, 0);
    assert.deepEqual(s.calls, { read: 0, write: 0 });
  }
});

test("installation identity is durable before remote activation and is reused after a lost response", async () => {
  const { service, s, v } = await setup(OPTIONS, null, {
    activate: () => {
      throw new Error("lost");
    },
  });
  await assert.rejects(service.activate(A, "Mac", NOW), /lost/);
  assert.equal(s.current().version, 2);
  assert.match(s.current().installationId, /^[a-f0-9-]{36}$/);
  assert.equal(s.current().licenseKey, null);
  await assert.rejects(service.activate(A, "Mac", NOW), /lost/);
  assert.equal(v.calls.activate[0].installationId, v.calls.activate[1].installationId);
});

test("retry returning created:false never compensates on a failed save", async () => {
  const { LicenseService } = await load();
  const s = store();
  const v = verifier({
    activate: () => ({
      activated: true,
      created: false,
      instanceId: "inst-A",
      license: LICENSE,
      meta: META,
    }),
  });
  const write = s.write;
  let writes = 0;
  s.write = async (record) => {
    if (++writes > 1) throw new Error("disk: " + A);
    return write(record);
  };
  const service = new LicenseService(v, s, OPTIONS);
  await assert.rejects(
    service.activate(A, "Mac", NOW),
    (error) =>
      !error.message.includes(A) && error.message.includes("retry with the same installation"),
  );
  assert.equal(v.calls.deactivate.length, 0);
  assert.equal(s.current().licenseKey, null);
});

test("created activation is compensated after save failure; prior valid state remains", async () => {
  const { LicenseService } = await load();
  const s = store();
  const v = verifier();
  const service = new LicenseService(v, s, OPTIONS);
  await service.activate(A, "Mac", NOW);
  const prior = structuredClone(s.current());
  s.write = async () => {
    throw new Error("disk: " + B);
  };
  await assert.rejects(
    service.activate(B, "Mac", NOW),
    (error) => error.message.includes("released") && !error.message.includes(B),
  );
  assert.deepEqual(s.current(), prior);
  assert.deepEqual(v.calls.deactivate, [{ licenseKey: B, instanceId: "inst-B" }]);
});

test("mismatched created activation is compensated, but reused activation is never released", async () => {
  for (const created of [true, false]) {
    const { service, v } = await setup(OPTIONS, null, {
      activate: () => ({
        activated: true,
        created,
        instanceId: "inst-A",
        license: LICENSE,
        meta: { ...META, environment: "live" },
      }),
    });
    await assert.rejects(service.activate(A, "Mac", NOW));
    assert.equal(v.calls.deactivate.length, created ? 1 : 0);
  }
});

test("replacement releases old instance only after successful local commit", async () => {
  const { service, s, v } = await setup();
  await service.activate(A, "Mac", NOW);
  await service.activate(B, "Mac", new Date(+NOW + DAY));
  assert.equal(s.current().licenseKey, B);
  assert.deepEqual(v.calls.deactivate, [{ licenseKey: A, instanceId: "inst-A" }]);
});

test("daily validation, revoked response, and offline grace are authoritative at boundaries", async () => {
  let offline = false;
  let revoked = false;
  const { service, s, v } = await setup(OPTIONS, null, {
    validate: (_key, instanceId) => {
      if (!instanceId) return { valid: true, license: LICENSE, meta: META };
      if (offline) throw new Error("offline");
      if (revoked) return { valid: false, error: "revoked" };
      return { valid: true, instanceId, license: LICENSE, meta: META };
    },
  });
  await service.activate(A, "Mac", NOW);
  await service.refresh(new Date(+NOW + DAY - 1));
  assert.equal(v.calls.validate.length, 1);
  offline = true;
  assert.equal((await service.refresh(new Date(+NOW + 30 * DAY))).state, "licensed");
  assert.equal(s.current().lastValidationAt, NOW.toISOString());
  assert.equal((await service.refresh(new Date(+NOW + 30 * DAY + 1))).state, "network-error");
  offline = false;
  revoked = true;
  assert.equal((await service.refresh(new Date(+NOW + 31 * DAY))).state, "invalid");
});

test("ordinary same-day cache skips validation and grants licensed access", async () => {
  const { service, s, v } = await setup();
  await service.activate(A, "Mac", NOW);
  const sameDay = new Date(+NOW + DAY - 1);
  assert.deepEqual(await service.getStatus(sameDay), { state: "licensed", keyHint: "AAAA" });
  assert.deepEqual(await service.refresh(sameDay), { state: "licensed", keyHint: "AAAA" });
  assert.equal(v.calls.validate.length, 1);
  assert.equal(s.current().lastValidationAt, NOW.toISOString());
});

test("future validation timestamp fails closed and refreshes after clock rollback", async () => {
  const rollback = new Date(+NOW - 60 * 60 * 1000);
  for (const outcome of ["valid", "revoked", "transient"]) {
    let mode = "valid";
    const { service, s, v } = await setup(OPTIONS, null, {
      validate: (_key, instanceId) => {
        if (instanceId && mode === "transient") throw new Error("offline");
        if (instanceId && mode === "revoked") return { valid: false, error: "revoked" };
        return { valid: true, instanceId, license: LICENSE, meta: META };
      },
    });
    await service.activate(A, "Mac", NOW);
    mode = outcome;
    assert.deepEqual(await service.getStatus(rollback), {
      state: "network-error",
      keyHint: "AAAA",
      lastValidatedAt: NOW.toISOString(),
    });
    assert.equal(v.calls.validate.length, 1, outcome);

    const refreshed = await service.refresh(rollback);
    assert.equal(v.calls.validate.length, 2, outcome);
    assert.equal(
      refreshed.state,
      outcome === "valid" ? "licensed" : outcome === "revoked" ? "invalid" : "network-error",
      outcome,
    );
    assert.equal(
      s.current().lastValidationAt,
      outcome === "transient" ? NOW.toISOString() : rollback.toISOString(),
      outcome,
    );
    assert.equal(s.current().lastValidationValid, outcome !== "revoked", outcome);

    if (outcome === "transient") {
      assert.equal((await service.refresh(rollback)).state, "network-error");
      assert.equal(v.calls.validate.length, 3);
      assert.equal(s.current().lastValidationAt, NOW.toISOString());
    } else if (outcome === "valid") {
      assert.equal((await service.getStatus(rollback)).state, "licensed");
      assert.equal((await service.refresh(rollback)).state, "licensed");
      assert.equal(v.calls.validate.length, 2);
    }
  }
});

test("wrong binding cache never grants access or contacts the new service", async () => {
  const { service, s, v } = await setup();
  await service.activate(A, "Mac", NOW);
  const switched = new (await load()).LicenseService(v, s, {
    ...OPTIONS,
    product: { ...OPTIONS.product, environment: "live" },
  });
  assert.equal((await switched.getStatus(NOW)).state, "invalid");
  assert.equal((await switched.refresh(new Date(+NOW + DAY))).state, "invalid");
  assert.equal(v.calls.validate.length, 1);
});

test("malformed success is transient and leaves offline clock untouched", async () => {
  let malformed = false;
  const { service, s } = await setup(OPTIONS, null, {
    validate: (_key, instanceId) =>
      malformed && instanceId
        ? { valid: true }
        : { valid: true, instanceId, license: LICENSE, meta: META },
  });
  await service.activate(A, "Mac", NOW);
  malformed = true;
  assert.equal((await service.refresh(new Date(+NOW + DAY))).state, "licensed");
  assert.equal(s.current().lastValidationAt, NOW.toISOString());
});

test("deactivation save failure preserves old key and does not release remote slot", async () => {
  const { service, s, v } = await setup();
  await service.activate(A, "Mac", NOW);
  s.write = async () => {
    throw new Error("disk failed");
  };
  await assert.rejects(service.deactivate(), /disk failed/);
  assert.equal(s.current().licenseKey, A);
  assert.equal(v.calls.deactivate.length, 0);
});

test("serialized refresh cannot restore a key after concurrent deactivation", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const { service, s } = await setup(OPTIONS, null, {
    validate: (_key, instanceId) =>
      instanceId ? wait : { valid: true, license: LICENSE, meta: META },
  });
  await service.activate(A, "Mac", NOW);
  const refresh = service.refresh(new Date(+NOW + DAY));
  const deactivate = service.deactivate(new Date(+NOW + DAY + 1));
  release({ valid: true, instanceId: "inst-A", license: LICENSE, meta: META });
  await Promise.all([refresh, deactivate]);
  assert.equal(s.current().licenseKey, null);
});

test("disabled and unconfigured service paths have zero store and network touches", async () => {
  for (const options of [
    { ...OPTIONS, gatingDisabled: true },
    { ...OPTIONS, product: null },
  ]) {
    const { service, s, v } = await setup(options);
    const expected = { state: options.gatingDisabled ? "disabled" : "unconfigured" };
    assert.deepEqual(await service.getStatus(new Date(+NOW - DAY)), expected);
    assert.deepEqual(await service.refresh(new Date(+NOW - DAY)), expected);
    await assert.rejects(service.activate(A, "Mac"));
    await assert.rejects(service.deactivate());
    await assert.rejects(service.forgetPendingReleases());
    await assert.rejects(service.resetUnreadable());
    assert.equal(await service.hasPendingRelease(), false);
    assert.deepEqual(s.calls, { read: 0, write: 0 });
    assert.deepEqual(s.replaced, []);
    assert.deepEqual(s.setAside, []);
    assert.deepEqual(v.calls, { validate: [], activate: [], deactivate: [] });
  }
});

test("service reason codes give a revoked or device-limit message", async () => {
  const limited = await setup(OPTIONS, null, {
    activate: () => ({ activated: false, error: "activation_limit" }),
  });
  await assert.rejects(limited.service.activate(A, "Mac", NOW), /maximum number of Macs/);
  const capped = await setup({ ...OPTIONS, activationLimit: 3 }, null, {
    activate: () => ({ activated: false, error: "activation_limit" }),
  });
  await assert.rejects(capped.service.activate(A, "Mac", NOW), (error) => {
    assert.equal(
      error.message,
      "This license key is already active on 3 Macs, the most one key allows. To free a slot, open DayBoard on one of those Macs and choose Settings → License → Deactivate this device, then activate here again. If one of them is lost, erased or no longer works, email support@getdayboard.com to free its slot.",
    );
    assert.equal(error.message.includes(A), false);
    return true;
  });

  const revoked = await setup(OPTIONS, null, {
    validate: () => ({ valid: false, error: "revoked" }),
  });
  await assert.rejects(revoked.service.activate(A, "Mac", NOW), /has been revoked/);
  assert.equal(revoked.v.calls.activate.length, 0);

  let refunded = false;
  const { service } = await setup(OPTIONS, null, {
    validate: (_key, instanceId) =>
      refunded
        ? { valid: false, error: "revoked" }
        : { valid: true, instanceId, license: LICENSE, meta: META },
  });
  await service.activate(A, "Mac", NOW);
  refunded = true;
  assert.deepEqual(await service.refresh(new Date(+NOW + DAY)), {
    state: "invalid",
    keyHint: A.slice(-4),
    message: "This license has been revoked and can't unlock DayBoard Pro.",
  });
});

const MAC_ID = "0b3a1f9e-5c2d-4e8f-9a7b-6c5d4e3f2a1b";
const PER_MAC = { ...OPTIONS, installationId: async () => MAC_ID };
const V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LATER = new Date(+NOW + DAY);
const MINUTE = 60_000;
const offline = () => {
  throw new Error("The DayBoard license service is temporarily unavailable.");
};

test("deactivation reports success only after the service confirms the slot is free", async () => {
  const { service, s, v } = await setup();
  await service.activate(A, "Mac", NOW);
  const result = await service.deactivate(LATER);
  assert.deepEqual(result, { status: { state: "trial", daysLeft: 13 }, release: "released" });
  assert.deepEqual(v.calls.deactivate, [{ licenseKey: A, instanceId: "inst-A" }]);
  assert.equal(s.current().licenseKey, null);
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal(JSON.stringify(s.current()).includes(A), false);
});

test("a revoked or unknown key holds no slot, so its refusal counts as released", async () => {
  for (const answer of [
    { deactivated: false, error: "revoked" },
    { deactivated: false, error: "The license was not accepted." },
  ]) {
    const { service, s } = await setup(OPTIONS, null, { deactivate: () => answer });
    await service.activate(A, "Mac", NOW);
    assert.equal((await service.deactivate(LATER)).release, "released", answer.error);
    assert.deepEqual(s.current().pendingReleases, []);
  }
});

test("a failed remote release still removes the key but reports the slot as pending", async () => {
  for (const failure of ["offline", "rate limited", "server error"]) {
    const { service, s, v } = await setup(OPTIONS, null, {
      deactivate: () => {
        throw new Error(failure);
      },
    });
    await service.activate(A, "Mac", NOW);
    const result = await service.deactivate(LATER);
    assert.equal(result.release, "pending", failure);
    assert.deepEqual(result.status, { state: "trial", daysLeft: 13 });
    assert.deepEqual(await service.getStatus(LATER), { state: "trial", daysLeft: 13 });
    assert.equal(s.current().licenseKey, null);
    assert.equal(s.current().instanceId, null);
    assert.equal(s.current().productBinding, null);
    assert.deepEqual(s.current().pendingReleases, [
      { licenseKey: A, instanceId: "inst-A", binding: META },
    ]);
    assert.equal(v.calls.deactivate.length, 1);
  }
});

test("pending releases retry on the next launch and on refresh, throttled after a failure", async () => {
  let online = false;
  const { service, s, v } = await setup(OPTIONS, null, {
    deactivate: () => (online ? { deactivated: true } : offline()),
  });
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");
  assert.equal(v.calls.deactivate.length, 1);

  await service.refresh(new Date(+LATER + MINUTE));
  assert.equal(v.calls.deactivate.length, 1);
  await service.refresh(new Date(+LATER + 15 * MINUTE));
  assert.equal(v.calls.deactivate.length, 2);
  assert.equal(s.current().pendingReleases.length, 1);

  const relaunched = new (await load()).LicenseService(v, s, OPTIONS);
  online = true;
  assert.deepEqual(await relaunched.refresh(new Date(+LATER + 16 * MINUTE)), {
    state: "trial",
    daysLeft: 13,
  });
  assert.equal(v.calls.deactivate.length, 3);
  assert.deepEqual(v.calls.deactivate.at(-1), { licenseKey: A, instanceId: "inst-A" });
  await relaunched.whenReleasesSettled();
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal(JSON.stringify(s.current()).includes(A), false);
  await relaunched.refresh(new Date(+LATER + 60 * MINUTE));
  assert.equal(v.calls.deactivate.length, 3);
  assert.equal(v.calls.validate.length, 1);
});

test("deactivating again retries an unconfirmed release right away", async () => {
  let online = false;
  const { service, s, v } = await setup(OPTIONS, null, {
    deactivate: () => (online ? { deactivated: true } : offline()),
  });
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");
  assert.equal((await service.deactivate(new Date(+LATER + MINUTE))).release, "pending");
  online = true;
  assert.equal((await service.deactivate(new Date(+LATER + 2 * MINUTE))).release, "released");
  assert.equal(v.calls.deactivate.length, 3);
  assert.deepEqual(s.current().pendingReleases, []);
});

test("re-activating the same key on this Mac keeps its slot and cancels the pending release", async () => {
  const { service, s, v } = await setup(OPTIONS, null, {
    activate: () => ({
      activated: true,
      created: false,
      instanceId: "inst-A",
      license: LICENSE,
      meta: META,
    }),
    deactivate: offline,
  });
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");
  assert.equal((await service.activate(A, "Mac", new Date(+LATER + MINUTE))).state, "licensed");
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal((await service.refresh(new Date(+LATER + 3 * DAY))).state, "licensed");
  assert.equal(v.calls.deactivate.length, 1);
  assert.equal(s.current().licenseKey, A);
});

test("an unconfirmed release of a replaced key is kept and retried", async () => {
  let online = false;
  const { service, s, v } = await setup(OPTIONS, null, {
    deactivate: () => (online ? { deactivated: true } : offline()),
  });
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.activate(B, "Mac", LATER)).state, "licensed");
  assert.equal(s.current().licenseKey, B);
  assert.deepEqual(s.current().pendingReleases, [
    { licenseKey: A, instanceId: "inst-A", binding: META },
  ]);
  online = true;
  await service.refresh(new Date(+LATER + MINUTE));
  assert.deepEqual(v.calls.deactivate, [
    { licenseKey: A, instanceId: "inst-A" },
    { licenseKey: A, instanceId: "inst-A" },
  ]);
  await service.whenReleasesSettled();
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal(s.current().licenseKey, B);
});

test("a pending release bound to another service is never sent to this one", async () => {
  const { service, s, v } = await setup(OPTIONS, null, { deactivate: offline });
  await service.activate(A, "Mac", NOW);
  await service.deactivate(LATER);
  const live = new (await load()).LicenseService(v, s, {
    ...OPTIONS,
    product: { ...OPTIONS.product, environment: "live" },
  });
  await live.refresh(new Date(+LATER + DAY));
  await live.whenReleasesSettled();
  assert.equal(await live.hasPendingRelease(), false);
  assert.equal((await live.deactivate(new Date(+LATER + DAY))).release, "none");
  assert.equal(v.calls.deactivate.length, 1);
  assert.equal(s.current().pendingReleases.length, 1);
});

test("removing a key this service never verified reports that nothing was released", async () => {
  let revoked = false;
  const { service, s, v } = await setup(OPTIONS, null, {
    validate: (_key, instanceId) =>
      revoked && instanceId
        ? { valid: false, error: "revoked" }
        : { valid: true, instanceId, license: LICENSE, meta: META },
  });
  await service.activate(A, "Mac", NOW);
  revoked = true;
  assert.equal((await service.refresh(LATER)).state, "invalid");
  assert.equal(s.current().productBinding, null);
  assert.deepEqual(await service.deactivate(LATER), {
    status: { state: "trial", daysLeft: 13 },
    release: "none",
  });
  assert.equal(v.calls.deactivate.length, 0);
  assert.equal(s.current().licenseKey, null);
});

test("past the cap, releases another build must send are dropped before this build's", async () => {
  const { service, s } = await setup(OPTIONS, null, { deactivate: offline });
  await service.activate(A, "Mac", NOW);
  const foreign = Array.from({ length: 8 }, (_, index) => ({
    licenseKey: B,
    instanceId: `live-${index}`,
    binding: { ...META, environment: "live" },
  }));
  await s.write({ ...s.current(), pendingReleases: foreign });
  assert.equal((await service.deactivate(LATER)).release, "pending");
  const kept = s.current().pendingReleases;
  assert.equal(kept.length, 8);
  assert.deepEqual(kept.at(-1), { licenseKey: A, instanceId: "inst-A", binding: META });
  assert.deepEqual(
    kept.slice(0, -1).map((item) => item.instanceId),
    foreign.slice(1).map((item) => item.instanceId),
  );
});

test("refresh never waits for a slow release, and the result is saved once it confirms", async () => {
  let online = false;
  let answer;
  const slow = new Promise((resolve) => {
    answer = resolve;
  });
  const { LicenseService } = await load();
  const s = store();
  const v = verifier({ deactivate: () => (online ? slow : offline()) });
  let notified = 0;
  const options = { ...OPTIONS, onReleasesSettled: () => notified++ };
  const service = new LicenseService(v, s, options);
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");

  online = true;
  const relaunched = new LicenseService(v, s, options);
  const soon = new Date(+LATER + MINUTE);
  assert.deepEqual(await relaunched.refresh(soon), { state: "trial", daysLeft: 13 });
  assert.deepEqual(await relaunched.getStatus(soon), { state: "trial", daysLeft: 13 });
  await relaunched.startTrial(soon);
  assert.equal(v.calls.deactivate.length, 2);
  assert.equal(await relaunched.hasPendingRelease(), true);
  // A second refresh while the first retry is in flight doesn't send another one.
  await relaunched.refresh(new Date(+LATER + 20 * MINUTE));
  assert.equal(v.calls.deactivate.length, 2);
  assert.equal(notified, 0);

  answer({ deactivated: true });
  await relaunched.whenReleasesSettled();
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal(await relaunched.hasPendingRelease(), false);
  assert.equal(notified, 1);
});

test("activation waits for a release in flight, so it never reuses an instance being freed", async () => {
  const api = licenseServer();
  let reachable = false;
  let open;
  let gate = Promise.resolve();
  const gated = {
    ...api,
    async deactivate(licenseKey, instanceId) {
      await gate;
      if (!reachable) throw new Error("offline");
      return api.deactivate(licenseKey, instanceId);
    },
  };
  const { LicenseService } = await load();
  const s = store();
  const service = new LicenseService(gated, s, PER_MAC);
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");
  assert.deepEqual([...api.activations.keys()], ["inst-1"]);

  reachable = true;
  gate = new Promise((resolve) => {
    open = resolve;
  });
  await service.refresh(new Date(+LATER + 15 * MINUTE));
  const activation = service.activate(A, "Mac", new Date(+LATER + 16 * MINUTE));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.calls.activate.length, 1);
  open();
  assert.equal((await activation).state, "licensed");
  await service.whenReleasesSettled();
  assert.deepEqual([...api.activations.keys()], ["inst-2"]);
  assert.equal(s.current().instanceId, "inst-2");
  assert.deepEqual(s.current().pendingReleases, []);
});

test("forgetting a release deletes the kept key and stops retrying it", async () => {
  const { service, s, v } = await setup(OPTIONS, null, { deactivate: offline });
  await service.activate(A, "Mac", NOW);
  assert.equal((await service.deactivate(LATER)).release, "pending");
  assert.equal(await service.hasPendingRelease(), true);
  assert.deepEqual(await service.forgetPendingReleases(LATER), { state: "trial", daysLeft: 13 });
  assert.deepEqual(s.current().pendingReleases, []);
  assert.equal(JSON.stringify(s.current()).includes(A), false);
  assert.equal(await service.hasPendingRelease(), false);
  await service.refresh(new Date(+LATER + DAY));
  await service.whenReleasesSettled();
  assert.equal(v.calls.deactivate.length, 1);

  const { LicenseService, UnreadableLicenseRecordError } = await load();
  const locked = unreadableStore(UnreadableLicenseRecordError);
  await assert.rejects(
    new LicenseService(verifier(), locked, OPTIONS).forgetPendingReleases(NOW),
    /can't read the license data/,
  );
  assert.equal(locked.calls.write, 0);
});

test("two macOS accounts on one Mac share a slot; one deactivating doesn't break the other", async () => {
  const api = licenseServer();
  const { LicenseService } = await load();
  const first = store();
  const second = store();
  const mine = new LicenseService(api, first, PER_MAC);
  const theirs = new LicenseService(api, second, PER_MAC);
  assert.equal((await mine.activate(A, "DayBoard on macOS", NOW)).state, "licensed");
  assert.equal((await theirs.activate(A, "DayBoard on macOS", NOW)).state, "licensed");
  assert.equal(first.current().instanceId, second.current().instanceId);
  assert.equal(api.activations.size, 1);

  assert.equal((await mine.deactivate(LATER)).release, "released");
  assert.equal(api.activations.size, 0);

  // At its next daily check the other account asks for this Mac's slot again instead of
  // reporting the key as no longer valid.
  const nextDay = new Date(+LATER + DAY);
  assert.deepEqual(await theirs.refresh(nextDay), { state: "licensed", keyHint: "AAAA" });
  const [[instanceId, activation]] = api.activations;
  assert.equal(activation.installationId, MAC_ID);
  assert.equal(second.current().instanceId, instanceId);
  assert.equal(second.current().lastValidationAt, nextDay.toISOString());
  assert.deepEqual(api.calls.activate.at(-1), {
    licenseKey: A,
    installationId: MAC_ID,
    instanceName: "DayBoard on macOS",
  });

  // Activating again on the first account reuses that slot.
  assert.equal((await mine.activate(A, "DayBoard on macOS", nextDay)).state, "licensed");
  assert.equal(first.current().instanceId, instanceId);
  assert.equal(api.activations.size, 1);
});

test("a released slot that can't be taken back says why, and an outage changes nothing", async () => {
  const api = licenseServer({ limit: 1 });
  const { LicenseService } = await load();
  const first = store();
  const second = store();
  const options = { ...PER_MAC, activationLimit: 1 };
  const mine = new LicenseService(api, first, options);
  const theirs = new LicenseService(api, second, options);
  await mine.activate(A, "Mac", NOW);
  await theirs.activate(A, "Mac", NOW);
  await mine.deactivate(LATER);

  // The activation call fails: the record and the offline grace stay as they were.
  const saved = structuredClone(second.current());
  const outage = new LicenseService(
    {
      ...api,
      activate: async () => {
        throw new Error("offline");
      },
    },
    second,
    options,
  );
  assert.equal((await outage.refresh(new Date(+LATER + DAY))).state, "licensed");
  assert.deepEqual(second.current(), saved);

  // Another Mac takes the freed slot first.
  await api.activate(A, "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "Mac");
  const status = await theirs.refresh(new Date(+LATER + 2 * DAY));
  assert.equal(status.state, "invalid");
  assert.equal(
    status.message,
    "This Mac's activation was released. This license key is already active on 1 Mac, the most one key allows. To free a slot, open DayBoard on one of those Macs and choose Settings → License → Deactivate this device, then activate here again. If one of them is lost, erased or no longer works, email support@getdayboard.com to free its slot.",
  );
  assert.doesNotMatch(status.message, /no longer valid/);
});

test("new records take this Mac's installation ID and saved IDs never change", async () => {
  const first = await setup(PER_MAC);
  await first.service.startTrial(NOW);
  assert.equal(first.s.current().installationId, MAC_ID);
  await first.service.activate(A, "Mac", NOW);
  assert.equal(first.v.calls.activate[0].installationId, MAC_ID);

  // Wiped app data or a second profile on the same Mac asks for the same slot.
  const wiped = await setup(PER_MAC);
  await wiped.service.activate(A, "Mac", LATER);
  assert.equal(wiped.v.calls.activate[0].installationId, MAC_ID);

  const random = await setup();
  await random.service.startTrial(NOW);
  const saved = random.s.current();
  assert.match(saved.installationId, V4);
  const upgraded = await setup(PER_MAC, saved);
  await upgraded.service.activate(A, "Mac", NOW);
  await upgraded.service.deactivate(LATER);
  assert.equal(upgraded.v.calls.activate[0].installationId, saved.installationId);
  assert.equal(upgraded.s.current().installationId, saved.installationId);

  for (const installationId of [
    async () => "not-a-uuid",
    async () => {
      throw new Error("ioreg failed");
    },
  ]) {
    const { service, s } = await setup({ ...OPTIONS, installationId });
    await service.startTrial(NOW);
    assert.match(s.current().installationId, V4);
  }
});

test("an unreadable record pauses AI with a recoverable state and touches nothing", async () => {
  const { LicenseService, UnreadableLicenseRecordError, isLicenseBlocking } = await load();
  const s = unreadableStore(UnreadableLicenseRecordError);
  const v = verifier();
  const service = new LicenseService(v, s, PER_MAC);
  assert.deepEqual(await service.getStatus(NOW), { state: "unreadable" });
  assert.deepEqual(await service.refresh(NOW), { state: "unreadable" });
  await service.startTrial(NOW);
  assert.equal(isLicenseBlocking({ state: "unreadable" }), true);
  await assert.rejects(service.deactivate(NOW), /can't read the license data saved on this Mac/);
  assert.equal(s.calls.write, 0);
  assert.deepEqual(s.replaced, []);
  assert.deepEqual(v.calls, { validate: [], activate: [], deactivate: [] });
});

test("activation recovers an unreadable record with this Mac's installation ID", async () => {
  const { LicenseService, UnreadableLicenseRecordError } = await load();
  const rejected = unreadableStore(UnreadableLicenseRecordError);
  const refusing = verifier({ validate: () => ({ valid: false, error: "invalid" }) });
  const blocked = new LicenseService(refusing, rejected, PER_MAC);
  await assert.rejects(blocked.activate(A, "Mac", NOW), /couldn't be validated/);
  assert.deepEqual(rejected.replaced, []);

  const s = unreadableStore(UnreadableLicenseRecordError);
  const v = verifier();
  const service = new LicenseService(v, s, PER_MAC);
  assert.deepEqual(await service.activate(A, "Mac", NOW), { state: "licensed", keyHint: "AAAA" });
  assert.equal(s.replaced.length, 1);
  assert.equal(s.replaced[0].installationId, MAC_ID);
  assert.equal(s.replaced[0].licenseKey, null);
  assert.equal(v.calls.activate[0].installationId, MAC_ID);
  assert.equal(s.current().licenseKey, A);
});

test("a store that can't replace an unreadable record refuses recovery before activating", async () => {
  const { LicenseService, UnreadableLicenseRecordError } = await load();
  const s = unreadableStore(UnreadableLicenseRecordError);
  delete s.replaceUnreadable;
  delete s.setAsideUnreadable;
  const v = verifier();
  const service = new LicenseService(v, s, PER_MAC);
  await assert.rejects(service.activate(A, "Mac", NOW), /can't read the license data/);
  await assert.rejects(service.resetUnreadable(NOW), /can't read the license data/);
  assert.equal(v.calls.activate.length, 0);
  assert.equal(s.calls.write, 0);
});

test("reset sets only an unreadable record aside and leaves transient errors to Retry", async () => {
  const { LicenseService, UnreadableLicenseRecordError } = await load();
  const s = unreadableStore(UnreadableLicenseRecordError);
  const service = new LicenseService(verifier(), s, PER_MAC);
  assert.deepEqual(await service.resetUnreadable(NOW), { state: "trial", daysLeft: 14 });
  assert.equal(s.setAside.length, 1);
  assert.deepEqual(s.replaced, []);
  assert.equal(s.calls.write, 0);
  assert.equal(s.current(), null);

  // Reset doesn't start the trial: a week without AI later, all of it is still ahead, and it
  // starts on the first AI use with this Mac's installation ID.
  const weekLater = new Date(+NOW + 7 * DAY);
  assert.deepEqual(await service.getStatus(weekLater), { state: "trial", daysLeft: 14 });
  await service.startTrial(weekLater);
  assert.equal(s.current().firstLaunchAt, weekLater.toISOString());
  assert.equal(s.current().installationId, MAC_ID);
  assert.deepEqual(await service.resetUnreadable(new Date(+weekLater + DAY)), {
    state: "trial",
    daysLeft: 13,
  });
  assert.equal(s.setAside.length, 1);

  const flaky = store();
  flaky.read = async () => {
    throw new Error("EIO: i/o error");
  };
  const v = verifier();
  const transient = new LicenseService(v, flaky, PER_MAC);
  await assert.rejects(transient.getStatus(NOW), /EIO/);
  await assert.rejects(transient.refresh(NOW), /EIO/);
  await assert.rejects(transient.resetUnreadable(NOW), /EIO/);
  await assert.rejects(transient.activate(A, "Mac", NOW), /EIO/);
  assert.deepEqual(flaky.replaced, []);
  assert.equal(v.calls.activate.length, 0);
});
