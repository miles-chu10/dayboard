import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const result = await build({
  entryPoints: [path.join(root, "main/services/license/license-operations.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { createLicenseOperations } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("demo and unconfigured wrappers never open personal license storage or use the network", async () => {
  const seededPersonalRecord = { licenseKey: "PERSONAL-KEY", instanceId: "personal-instance" };
  for (const mode of ["demo", "unconfigured", "disabled"]) {
    let serviceOpens = 0;
    let storeReads = 0;
    let networkCalls = 0;
    const operations = createLicenseOperations({
      mode: () => mode,
      checkoutUrl: "https://example.invalid/checkout",
      getService: async () => {
        serviceOpens++;
        return {
          getStatus: async () => {
            storeReads++;
            return seededPersonalRecord;
          },
          refresh: async () => {
            storeReads++;
            networkCalls++;
            return seededPersonalRecord;
          },
          activate: async () => {
            storeReads++;
            networkCalls++;
            return seededPersonalRecord;
          },
          deactivate: async () => {
            storeReads++;
            networkCalls++;
            return seededPersonalRecord;
          },
          resetUnreadable: async () => {
            storeReads++;
            return seededPersonalRecord;
          },
        };
      },
    });
    const expected = { status: { state: mode }, checkoutUrl: "" };
    assert.deepEqual(await operations.getStatus(), expected);
    assert.deepEqual(await operations.refresh(), expected);
    await operations.assertLicenseAccess();
    await assert.rejects(operations.activate("PERSONAL-KEY", "Device"), /unavailable/);
    await assert.rejects(operations.deactivate(), /unavailable/);
    await assert.rejects(operations.resetUnreadable(), /unavailable/);
    assert.equal(serviceOpens, 0);
    assert.equal(storeReads, 0);
    assert.equal(networkCalls, 0);
  }
});

test("server-side access assertion blocks an expired configured trial", async () => {
  const operations = createLicenseOperations({
    mode: () => "configured",
    checkoutUrl: "",
    getService: async () => ({
      startTrial: async () => {},
      refresh: async () => ({ state: "expired" }),
    }),
  });
  await assert.rejects(operations.assertLicenseAccess(), (error) => {
    assert.match(error.message, /License required/);
    assert.equal(error.code, "license-required");
    assert.equal(error.state, "expired", "Quick Capture words its message by the lock state");
    return true;
  });
});

test("the first guarded (AI) action starts the trial before checking access", async () => {
  const calls = [];
  const operations = createLicenseOperations({
    mode: () => "configured",
    checkoutUrl: "",
    getService: async () => ({
      startTrial: async () => calls.push("startTrial"),
      refresh: async () => (calls.push("refresh"), { state: "trial", daysLeft: 7 }),
    }),
  });
  await operations.assertLicenseAccess();
  assert.deepEqual(calls, ["startTrial", "refresh"]);
});

test("deactivation passes the release outcome through and unreadable data blocks AI", async () => {
  const checkoutUrl = "https://example.invalid/buy";
  for (const release of ["released", "pending"]) {
    const operations = createLicenseOperations({
      mode: () => "configured",
      checkoutUrl,
      getService: async () => ({
        deactivate: async () => ({ status: { state: "trial", daysLeft: 3 }, release }),
      }),
    });
    assert.deepEqual(await operations.deactivate(), {
      status: { state: "trial", daysLeft: 3 },
      checkoutUrl,
      release,
    });
  }

  let resets = 0;
  const operations = createLicenseOperations({
    mode: () => "configured",
    checkoutUrl,
    getService: async () => ({
      startTrial: async () => {},
      refresh: async () => ({ state: "unreadable" }),
      resetUnreadable: async () => (resets++, { state: "trial", daysLeft: 7 }),
    }),
  });
  await assert.rejects(operations.assertLicenseAccess(), /License required/);
  assert.deepEqual(await operations.resetUnreadable(), {
    status: { state: "trial", daysLeft: 7 },
    checkoutUrl,
  });
  assert.equal(resets, 1);
});
