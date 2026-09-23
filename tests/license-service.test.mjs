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
  return {
    calls,
    async read() {
      calls.read++;
      return current;
    },
    async write(next) {
      calls.write++;
      current = structuredClone(next);
    },
    current: () => current,
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

test("14-day trial expires at boundary and deactivation keeps installation identity", async () => {
  const { service, s } = await setup();
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
    assert.deepEqual(s.calls, { read: 0, write: 0 });
    assert.deepEqual(v.calls, { validate: [], activate: [], deactivate: [] });
  }
});
