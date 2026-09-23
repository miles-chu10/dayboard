import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;
const META = { storeId: "1", productId: "4", variantId: "5" };
const LICENSE = { status: "active", expiresAt: null };

async function loadLicenseService() {
  const result = await build({
    entryPoints: [path.join(root, "main/services/license/license-service.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

function memoryStore(initial = null) {
  let record = initial;
  const calls = { read: 0, write: 0 };
  return {
    calls,
    async read() {
      calls.read++;
      return record;
    },
    async write(next) {
      calls.write++;
      record = next;
    },
    _current: () => record,
  };
}

function fakeVerifier(overrides = {}) {
  const calls = { activate: [], validate: [], deactivate: [] };
  return {
    calls,
    async activate(licenseKey, instanceName) {
      calls.activate.push({ licenseKey, instanceName });
      return overrides.activate
        ? overrides.activate(licenseKey, instanceName)
        : { activated: true, instanceId: "inst-1", license: LICENSE, meta: META };
    },
    async validate(licenseKey, instanceId) {
      calls.validate.push({ licenseKey, instanceId });
      if (!instanceId) {
        if (overrides.prevalidate) return overrides.prevalidate(licenseKey);
        return { valid: true, license: LICENSE, meta: META };
      }
      if (overrides.validate) return overrides.validate(licenseKey, instanceId);
      return { valid: true, instanceId, license: LICENSE, meta: META };
    },
    async deactivate(licenseKey, instanceId) {
      calls.deactivate.push({ licenseKey, instanceId });
      return overrides.deactivate
        ? overrides.deactivate(licenseKey, instanceId)
        : { deactivated: true };
    },
  };
}

const DEFAULT_OPTIONS = {
  trialDays: 14,
  revalidateIntervalMs: 24 * 60 * 60 * 1000,
  offlineGraceDays: 30,
  product: { storeId: "1", productId: "4", variantIds: ["5", "6"] },
};

test("a brand-new install starts a 14-day trial from first launch", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const service = new LicenseService(fakeVerifier(), store, DEFAULT_OPTIONS);
  const now = new Date("2026-01-01T00:00:00Z");

  const status = await service.getStatus(now);

  assert.deepEqual(status, { state: "trial", daysLeft: 14 });
});

test("trial days left counts down and expires after 14 days", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const service = new LicenseService(fakeVerifier(), store, DEFAULT_OPTIONS);
  const start = new Date("2026-01-01T00:00:00Z");
  await service.getStatus(start);

  const midTrial = await service.getStatus(new Date("2026-01-08T00:00:00Z"));
  assert.deepEqual(midTrial, { state: "trial", daysLeft: 7 });

  const afterTrial = await service.getStatus(new Date("2026-01-16T00:00:00Z"));
  assert.deepEqual(afterTrial, { state: "expired" });
});

test("activate stores the key and reports licensed with a masked hint", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier();
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  const now = new Date("2026-01-01T00:00:00Z");

  const status = await service.activate("ABCD-1234-EFGH-5678", "Test Mac", now);

  assert.deepEqual(status, { state: "licensed", keyHint: "5678" });
  assert.equal(verifier.calls.activate.length, 1);
  assert.deepEqual(verifier.calls.validate, [
    { licenseKey: "ABCD-1234-EFGH-5678", instanceId: undefined },
  ]);
  assert.equal(verifier.calls.activate[0].instanceName, "Test Mac");
  assert.equal(store._current().instanceId, "inst-1");
  assert.deepEqual(store._current().productBinding, META);
});

test("activate throws with the server's message and does not store an invalid key", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    activate: () => ({ activated: false, error: "license_key not found." }),
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);

  await assert.rejects(
    service.activate("BAD-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
    /license_key not found/,
  );
  assert.equal(store._current(), null);
});

test("foreign, missing-metadata, and expired keys stop at validation without consuming an activation", async () => {
  const { LicenseService } = await loadLicenseService();
  const cases = [
    { meta: { ...META, storeId: "99" } },
    { meta: { ...META, productId: "99" } },
    { meta: { ...META, variantId: "99" } },
    { meta: undefined },
    { license: { status: "disabled", expiresAt: null } },
    { license: { status: "active", expiresAt: "2025-12-31T00:00:00Z" } },
  ];
  for (const candidate of cases) {
    const store = memoryStore();
    const verifier = fakeVerifier({
      prevalidate: () => ({ valid: true, license: LICENSE, meta: META, ...candidate }),
    });
    const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
    await assert.rejects(
      service.activate("FOREIGN-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
    );
    assert.equal(verifier.calls.validate.length, 1);
    assert.equal(verifier.calls.activate.length, 0);
    assert.equal(verifier.calls.deactivate.length, 0);
    assert.deepEqual(store.calls, { read: 0, write: 0 });
  }
});

test("an inactive matching key validates and then activates", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    prevalidate: () => ({
      valid: true,
      license: { status: "inactive", expiresAt: null },
      meta: META,
    }),
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  const status = await service.activate("NEW-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  assert.equal(status.state, "licensed");
  assert.deepEqual(verifier.calls.validate, [{ licenseKey: "NEW-KEY", instanceId: undefined }]);
  assert.equal(verifier.calls.activate.length, 1);
  assert.equal(verifier.calls.deactivate.length, 0);
});

test("a bad activation response releases the newly created instance", async () => {
  const { LicenseService } = await loadLicenseService();
  for (const candidate of [
    { meta: { ...META, variantId: "99" } },
    { meta: undefined },
    { license: { status: "inactive", expiresAt: null } },
  ]) {
    const store = memoryStore();
    const verifier = fakeVerifier({
      activate: () => ({
        activated: true,
        instanceId: "inst-created",
        license: LICENSE,
        meta: META,
        ...candidate,
      }),
    });
    const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
    await assert.rejects(
      service.activate("MATCHING-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
      /new activation was released/,
    );
    assert.deepEqual(verifier.calls.deactivate, [
      { licenseKey: "MATCHING-KEY", instanceId: "inst-created" },
    ]);
    assert.equal(store._current(), null);
  }
});

test("a local save failure releases the new activation and preserves the old key", async () => {
  const { LicenseService } = await loadLicenseService();
  const old = {
    licenseKey: "OLD-KEY",
    instanceId: "old-instance",
    instanceName: "Old Mac",
    firstLaunchAt: "2025-12-01T00:00:00Z",
    lastValidationAt: "2026-01-01T00:00:00Z",
    lastValidationValid: true,
    lastValidationMessage: null,
    productBinding: META,
  };
  let writeAttempts = 0;
  const store = {
    async read() {
      return old;
    },
    async write() {
      writeAttempts++;
      throw new Error("disk failed: SECRET-KEY");
    },
  };
  const verifier = fakeVerifier({
    activate: () => ({ activated: true, instanceId: "inst-created", license: LICENSE, meta: META }),
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await assert.rejects(
    service.activate("SECRET-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
    (error) =>
      error.message.includes("new activation was released") &&
      !error.message.includes("SECRET-KEY"),
  );
  assert.equal(writeAttempts, 1);
  assert.deepEqual(verifier.calls.deactivate, [
    { licenseKey: "SECRET-KEY", instanceId: "inst-created" },
  ]);
  assert.equal((await store.read()).licenseKey, "OLD-KEY");
});

test("cleanup failure reports an occupied slot without revealing the key", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    activate: () => ({
      activated: true,
      instanceId: "inst-created",
      license: LICENSE,
      meta: { ...META, productId: "99" },
    }),
    deactivate: () => {
      throw new Error("cleanup failed for SECRET-KEY");
    },
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await assert.rejects(
    service.activate("SECRET-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
    (error) =>
      error.message.includes("may still occupy a slot") && !error.message.includes("SECRET-KEY"),
  );
  assert.equal(verifier.calls.deactivate.length, 1);
  assert.equal(store._current(), null);
});

test("refresh does not call validate again within the same day, but does after it elapses", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier();
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  const day1 = new Date("2026-01-01T00:00:00Z");
  await service.activate("KEY-0001", "Test Mac", day1);
  assert.equal(verifier.calls.validate.length, 1, "key is checked before creating an instance");

  await service.refresh(new Date("2026-01-01T12:00:00Z"));
  assert.equal(verifier.calls.validate.length, 1, "still within the daily window, no network call");

  await service.refresh(new Date("2026-01-02T01:00:00Z"));
  assert.equal(verifier.calls.validate.length, 2, "a day has passed, so refresh revalidates");
});

test("refresh flips to invalid when the server rejects the key", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    validate: () => ({ valid: false, error: "This license has been revoked." }),
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  const status = await service.refresh(new Date("2026-01-02T01:00:00Z"));

  assert.equal(status.state, "invalid");
  assert.equal(status.message, "This license has been revoked.");
});

test("a network failure during refresh keeps the license working within the 30-day offline grace", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    validate: () => {
      throw new Error("Couldn't reach Lemon Squeezy to validate this license.");
    },
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  const status = await service.refresh(new Date("2026-01-10T00:00:00Z"));

  assert.deepEqual(status, { state: "licensed", keyHint: "0001" });
});

test("network errors beyond the 30-day offline grace surface as network-error", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    validate: () => {
      throw new Error("offline");
    },
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  // Keep attempting daily refreshes that all fail; none of them should reset the grace clock.
  const start = new Date("2026-01-01T00:00:00Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  let status;
  for (let day = 1; day <= 32; day++) {
    status = await service.refresh(new Date(start + day * dayMs));
  }

  assert.equal(status.state, "network-error");
  assert.equal(status.keyHint, "0001");
});

test("deactivate clears the local key even when the remote call fails", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const verifier = fakeVerifier({
    deactivate: () => {
      throw new Error("offline");
    },
  });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  const status = await service.deactivate(new Date("2026-01-02T00:00:00Z"));

  assert.equal(status.state, "trial");
  assert.equal(store._current().licenseKey, null);
});

test("gatingDisabled always reports disabled, even with a stored key", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const service = new LicenseService(fakeVerifier(), store, {
    ...DEFAULT_OPTIONS,
    gatingDisabled: true,
  });

  const status = await service.getStatus(new Date("2026-01-01T00:00:00Z"));

  assert.deepEqual(status, { state: "disabled" });
  assert.deepEqual(store.calls, { read: 0, write: 0 });
});

test("unconfigured builds cannot accept keys or open the personal store", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore({ licenseKey: "PERSONAL-KEY", firstLaunchAt: "2026-01-01T00:00:00Z" });
  const verifier = fakeVerifier();
  const service = new LicenseService(verifier, store, { ...DEFAULT_OPTIONS, product: null });

  assert.deepEqual(await service.getStatus(), { state: "unconfigured" });
  assert.deepEqual(await service.refresh(), { state: "unconfigured" });
  await assert.rejects(service.activate("RANDOM-KEY", "Test Mac"), /not configured/);
  await assert.rejects(service.deactivate(), /not configured/);
  assert.deepEqual(store.calls, { read: 0, write: 0 });
  assert.deepEqual(verifier.calls, { activate: [], validate: [], deactivate: [] });
});

test("activation requires matching store, product, allowed variant, active status and instance", async () => {
  const { LicenseService } = await loadLicenseService();
  const cases = [
    { meta: { ...META, storeId: "99" } },
    { meta: { ...META, productId: "99" } },
    { meta: { ...META, variantId: "99" } },
    { meta: undefined },
    { license: { status: "expired", expiresAt: null } },
    { license: { status: "active", expiresAt: "2025-12-31T00:00:00Z" } },
    { instanceId: undefined },
  ];
  for (const candidate of cases) {
    const store = memoryStore();
    const verifier = fakeVerifier({
      activate: () => ({
        activated: true,
        instanceId: "inst-1",
        license: LICENSE,
        meta: META,
        ...candidate,
      }),
    });
    const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
    await assert.rejects(
      service.activate("FOREIGN-KEY", "Test Mac", new Date("2026-01-01T00:00:00Z")),
    );
    assert.equal(store.calls.write, 0, "rejected activations must not persist a key");
  }
});

test("validation refuses a foreign product and a response for another instance", async () => {
  const { LicenseService } = await loadLicenseService();
  for (const result of [
    { valid: true, meta: { ...META, variantId: "99" }, instanceId: "inst-1", license: LICENSE },
    { valid: true, meta: META, instanceId: "other-instance", license: LICENSE },
  ]) {
    const store = memoryStore();
    const service = new LicenseService(
      fakeVerifier({ validate: () => result }),
      store,
      DEFAULT_OPTIONS,
    );
    await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));
    const status = await service.refresh(new Date("2026-01-02T01:00:00Z"));
    assert.equal(status.state, "invalid");
    assert.equal(store._current().lastValidationValid, false);
    assert.equal(store._current().productBinding, null);
  }
});

test("an old saved personal key remains untrusted until matching metadata is revalidated", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore({
    licenseKey: "PERSONAL-KEY",
    instanceId: "inst-1",
    instanceName: "Old Mac",
    firstLaunchAt: "2026-01-01T00:00:00Z",
    lastValidationAt: "2026-01-02T00:00:00Z",
    lastValidationValid: true,
    lastValidationMessage: null,
  });
  const service = new LicenseService(fakeVerifier(), store, DEFAULT_OPTIONS);
  assert.equal((await service.getStatus(new Date("2026-01-02T01:00:00Z"))).state, "invalid");
  assert.equal((await service.refresh(new Date("2026-01-02T01:00:00Z"))).state, "licensed");
  assert.deepEqual(store._current().productBinding, META);
});

test("transient malformed validation preserves the last valid timestamp and 30-day grace", async () => {
  const { LicenseService } = await loadLicenseService();
  const store = memoryStore();
  const service = new LicenseService(
    fakeVerifier({ validate: () => ({ valid: true }) }),
    store,
    DEFAULT_OPTIONS,
  );
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));
  assert.equal((await service.refresh(new Date("2026-01-02T00:00:00Z"))).state, "licensed");
  assert.equal(store._current().lastValidationAt, "2026-01-01T00:00:00.000Z");
  assert.equal((await service.refresh(new Date("2026-02-02T00:00:00Z"))).state, "network-error");
});

test("a delayed refresh cannot restore a key after deactivation or replacement", async () => {
  const { LicenseService } = await loadLicenseService();
  let release;
  const pendingValidation = new Promise((resolve) => {
    release = resolve;
  });
  const store = memoryStore();
  const service = new LicenseService(
    fakeVerifier({ validate: () => pendingValidation }),
    store,
    DEFAULT_OPTIONS,
  );
  await service.activate("KEY-0001", "Test Mac", new Date("2026-01-01T00:00:00Z"));
  const refresh = service.refresh(new Date("2026-01-02T00:00:00Z"));
  const remove = service.deactivate(new Date("2026-01-02T00:01:00Z"));
  release({ valid: true, instanceId: "inst-1", license: LICENSE, meta: META });
  await Promise.all([refresh, remove]);
  assert.equal(store._current().licenseKey, null);
  assert.equal((await service.getStatus(new Date("2026-01-02T00:02:00Z"))).state, "trial");

  await service.activate("KEY-0002", "Test Mac", new Date("2026-01-02T00:03:00Z"));
  assert.equal(store._current().licenseKey, "KEY-0002");
});

test("a delayed refresh cannot overwrite a concurrently replaced key", async () => {
  const { LicenseService } = await loadLicenseService();
  let release;
  const pendingValidation = new Promise((resolve) => {
    release = resolve;
  });
  const store = memoryStore();
  const verifier = fakeVerifier({ validate: () => pendingValidation });
  const service = new LicenseService(verifier, store, DEFAULT_OPTIONS);
  await service.activate("KEY-OLD1", "Test Mac", new Date("2026-01-01T00:00:00Z"));

  const refresh = service.refresh(new Date("2026-01-02T00:00:00Z"));
  const replace = service.activate("KEY-NEW2", "Test Mac", new Date("2026-01-02T00:01:00Z"));
  release({ valid: true, instanceId: "inst-1", license: LICENSE, meta: META });
  await Promise.all([refresh, replace]);
  assert.equal(store._current().licenseKey, "KEY-NEW2");
  assert.equal((await service.getStatus(new Date("2026-01-02T00:02:00Z"))).state, "licensed");
});
