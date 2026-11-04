import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const result = await build({
  entryPoints: [path.join(root, "main/services/license/installation-id.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { createInstallationIdSource, deriveInstallationId, readHardwareUuid } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const HARDWARE_UUID = "5A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
// Pinned: changing the derivation would move every Mac to a new activation slot.
const DERIVED = "95cbe193-c0c8-4321-8aa2-073320d63787";
const INSTALLATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IOREG_OUTPUT = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000213, registered, matched, active, busy 0 (12 ms), retain 39>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXXXX"
      "IOPlatformUUID" = "${HARDWARE_UUID}"
      "manufacturer" = <"Apple Inc.">
    }
`;

/** True if `text` contains the hardware UUID, or any of its 8- or 12-digit groups, in any case. */
function leaks(text) {
  const lower = String(text).toLowerCase();
  const uuid = HARDWARE_UUID.toLowerCase();
  return [
    uuid,
    uuid.replaceAll("-", ""),
    ...uuid.split("-").filter((group) => group.length >= 8),
  ].some((form) => lower.includes(form));
}

async function loadService() {
  const service = await build({
    entryPoints: [path.join(root, "main/services/license/license-service.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(service.outputFiles[0].text).toString("base64")}`
  );
}

test("the derived installation ID is stable, contract-shaped and hides the hardware UUID", () => {
  assert.equal(deriveInstallationId(HARDWARE_UUID), DERIVED);
  assert.equal(deriveInstallationId(HARDWARE_UUID.toLowerCase()), DERIVED);
  assert.match(DERIVED, INSTALLATION_ID);
  assert.equal(leaks(DERIVED), false);
  const other = deriveInstallationId("00000000-0000-0000-0000-000000000001");
  assert.notEqual(other, DERIVED);
  assert.match(other, INSTALLATION_ID);
});

test("the hardware UUID comes only from ioreg on macOS, run without a shell", async () => {
  const runs = [];
  const run = async (file, args) => {
    runs.push([file, args]);
    return IOREG_OUTPUT;
  };
  assert.equal(await readHardwareUuid("darwin", run), HARDWARE_UUID);
  assert.deepEqual(runs, [["/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]]]);

  assert.equal(await readHardwareUuid("linux", run), null);
  assert.equal(runs.length, 1);
  assert.equal(await readHardwareUuid("darwin", async () => "no platform UUID here"), null);
  assert.equal(
    await readHardwareUuid("darwin", async () => {
      throw new Error("spawn EPERM");
    }),
    null,
  );
});

test("every profile on one Mac gets the same ID; without a hardware UUID each gets a random one", async () => {
  let reads = 0;
  const readUuid = async () => (reads++, HARDWARE_UUID);
  const profileA = createInstallationIdSource(readUuid);
  const profileB = createInstallationIdSource(readUuid);
  assert.equal(await profileA(), DERIVED);
  assert.equal(await profileA(), DERIVED);
  assert.equal(await profileB(), DERIVED);
  assert.equal(reads, 2);

  for (const unavailable of [
    async () => null,
    async () => {
      throw new Error("ioreg failed");
    },
  ]) {
    const source = createInstallationIdSource(unavailable);
    const first = await source();
    const second = await source();
    assert.match(first, INSTALLATION_ID);
    assert.match(second, INSTALLATION_ID);
    assert.notEqual(first, second);
    assert.notEqual(first, DERIVED);
  }
});

test("activation sends and saves only the derived ID, never the hardware UUID", async () => {
  const { LicenseService } = await loadService();
  const key = `DAYB_${"A".repeat(43)}`;
  const meta = { issuer: "https://license.example", productId: "prod_abc", environment: "test" };
  const license = { status: "active", expiresAt: null };
  const sent = [];
  let saved = null;
  const service = new LicenseService(
    {
      validate: async (...args) => (sent.push(args), { valid: true, license, meta }),
      activate: async (...args) => (
        sent.push(args),
        { activated: true, created: true, instanceId: "inst-A", license, meta }
      ),
      deactivate: async (...args) => (sent.push(args), { deactivated: true }),
    },
    {
      read: async () => saved,
      write: async (record) => {
        saved = structuredClone(record);
      },
      replaceUnreadable: async (record) => {
        saved = structuredClone(record);
      },
    },
    {
      trialDays: 7,
      revalidateIntervalMs: 86_400_000,
      offlineGraceDays: 30,
      product: { ...meta, apiUrl: meta.issuer },
      installationId: createInstallationIdSource(async () => HARDWARE_UUID),
    },
  );
  await service.activate(key, "DayBoard on macOS", new Date("2026-01-01T00:00:00Z"));
  assert.equal(saved.installationId, DERIVED);
  assert.deepEqual(sent[1], [key, DERIVED, "DayBoard on macOS"]);
  await service.deactivate(new Date("2026-01-02T00:00:00Z"));
  assert.equal(leaks(JSON.stringify(sent)), false);
  assert.equal(leaks(JSON.stringify(saved)), false);
});
