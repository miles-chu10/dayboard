import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const profile = "/tmp/dayboard-license-test";
const oldPath = path.join(profile, "license.bin");
const newPath = path.join(profile, "license-stripe-v2.bin");
const KEY = `DAYB_${"A".repeat(43)}`;
const MAC_ID = "0b3a1f9e-5c2d-4e8f-9a7b-6c5d4e3f2a1b";
const BINDING = { issuer: "https://license.example", productId: "prod_abc", environment: "test" };
let sequence = 0;

async function bundle(entry, plugins = []) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(
      result.outputFiles[0].text + `\n// ${sequence++}`,
    ).toString("base64")}`
  );
}

/** Bytes starting with LOCKED stand in for a file whose Keychain item is gone. */
async function load(files, keychain = {}) {
  globalThis.__licenseStoreTest = {
    files,
    reads: [],
    writes: [],
    copies: [],
    keychain: { available: true, encrypts: true, ...keychain },
  };
  return bundle("main/services/license/license-store.ts", [
    {
      name: "fake-electron-store",
      setup(build) {
        build.onResolve({ filter: /platform\/index\.js$/ }, () => ({
          path: "platform",
          namespace: "fake",
        }));
        build.onResolve({ filter: /file-store\.js$/ }, () => ({
          path: "files",
          namespace: "fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "fake" }, (args) => ({
          contents:
            args.path === "platform"
              ? `export const app = { getPath: () => ${JSON.stringify(profile)} };
               const keychain = () => globalThis.__licenseStoreTest.keychain;
               export const safeStorage = {
                 isEncryptionAvailable: () => keychain().available,
                 encryptString: async value => {
                   if (!keychain().encrypts) throw new Error("Keychain refused");
                   return Buffer.from(value);
                 },
                 decryptString: async value => {
                   const text = Buffer.from(value).toString();
                   if (text.startsWith("LOCKED")) throw new Error("Error while decrypting the ciphertext");
                   return text;
                 }
               };`
              : `const state = () => globalThis.__licenseStoreTest;
               export const createSerialQueue = () => operation => operation();
               export const readFileIfExists = async file => {
                 state().reads.push(file);
                 return state().files.get(file) ?? null;
               };
               export const writeFileAtomic = async (file, bytes) => {
                 state().writes.push(file);
                 state().files.set(file, bytes);
               };
               export const copyFileIfPresent = async (source, target) => {
                 if (!state().files.has(source)) return false;
                 if (state().files.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
                 state().copies.push([source, target]);
                 state().files.set(target, state().files.get(source));
                 return true;
               };`,
          loader: "js",
        }));
      },
    },
  ]);
}

function record(overrides = {}) {
  return {
    version: 2,
    installationId: MAC_ID,
    licenseKey: null,
    instanceId: null,
    instanceName: null,
    firstLaunchAt: "2026-01-01T00:00:00.000Z",
    lastValidationAt: null,
    lastValidationValid: null,
    lastValidationMessage: null,
    productBinding: null,
    ...overrides,
  };
}

const unreadable = (error) => error.code === "LICENSE_RECORD_UNREADABLE";

test("legacy migration persists only trial date and new identity, keeping original bytes", async () => {
  const legacy = Buffer.from(
    JSON.stringify({
      licenseKey: "LEMON-SECRET-KEY",
      instanceId: "old-instance",
      firstLaunchAt: "2025-12-01T00:00:00Z",
      productBinding: { storeId: "123" },
    }),
  );
  const files = new Map([[oldPath, legacy]]);
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore();
  const record = await store.read();
  assert.equal(record.version, 2);
  assert.equal(record.firstLaunchAt, "2025-12-01T00:00:00Z");
  assert.equal(record.licenseKey, null);
  assert.equal(record.instanceId, null);
  assert.equal(record.productBinding, null);
  assert.match(
    record.installationId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.equal(files.get(oldPath), legacy);
  assert.ok(files.has(newPath));
  assert.equal(globalThis.__licenseStoreTest.writes.length, 1);
  const reread = await store.read();
  assert.deepEqual(reread, record);
  assert.equal(globalThis.__licenseStoreTest.reads.filter((file) => file === oldPath).length, 1);
});

test("legacy migration takes this Mac's installation ID", async () => {
  const files = new Map([
    [oldPath, Buffer.from(JSON.stringify({ firstLaunchAt: "2025-12-01T00:00:00Z" }))],
  ]);
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore({ installationId: async () => MAC_ID });
  assert.equal((await store.read()).installationId, MAC_ID);
});

test("new record refuses legacy key and cannot fall back to old file", async () => {
  const files = new Map([
    [
      oldPath,
      Buffer.from(
        JSON.stringify({
          firstLaunchAt: "2025-12-01T00:00:00Z",
          licenseKey: "LEMON",
        }),
      ),
    ],
  ]);
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore();
  const record = await store.read();
  await assert.rejects(
    store.write({ ...record, licenseKey: "sk_live_secret" }),
    /Saved DayBoard license record is invalid/,
  );
  files.set(newPath, Buffer.from(JSON.stringify({ ...record, licenseKey: "LEMON" })));
  await assert.rejects(store.read(), /Saved DayBoard license record is invalid/);
  assert.equal(files.get(oldPath).toString().includes("LEMON"), true);
});

test("undecryptable or corrupt files are unreadable; a missing Keychain or I/O error is not", async () => {
  for (const bytes of [
    Buffer.from("LOCKED ciphertext"),
    Buffer.from("{not json"),
    Buffer.from(JSON.stringify({ version: 1 })),
  ]) {
    const { createDefaultLicenseStore } = await load(new Map([[newPath, bytes]]));
    await assert.rejects(createDefaultLicenseStore().read(), unreadable);
  }
  const { createDefaultLicenseStore: lockedLegacy } = await load(
    new Map([[oldPath, Buffer.from("LOCKED legacy")]]),
  );
  await assert.rejects(lockedLegacy().read(), unreadable);

  const { createDefaultLicenseStore } = await load(
    new Map([[newPath, Buffer.from("LOCKED ciphertext")]]),
    { available: false },
  );
  await assert.rejects(
    createDefaultLicenseStore().read(),
    (error) => !unreadable(error) && /Keychain/.test(error.message),
  );
});

test("replacing an unreadable file keeps a timestamped backup and saves the fresh record", async () => {
  const locked = Buffer.from("LOCKED ciphertext");
  const files = new Map([[newPath, locked]]);
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore();
  await assert.rejects(store.read(), unreadable);
  const fresh = record();
  await store.replaceUnreadable(fresh);

  const [[source, backup]] = globalThis.__licenseStoreTest.copies;
  assert.equal(source, newPath);
  assert.equal(path.dirname(backup), profile);
  assert.match(
    path.basename(backup),
    /^license-stripe-v2\.unreadable-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.bin$/,
  );
  assert.equal(files.get(backup), locked);
  assert.deepEqual(await store.read(), fresh);
  assert.deepEqual([...files.keys()].sort(), [backup, newPath].sort());
});

test("a failing Keychain or invalid record changes no files during replacement", async () => {
  const locked = Buffer.from("LOCKED ciphertext");
  const files = new Map([[newPath, locked]]);
  const { createDefaultLicenseStore } = await load(files, { encrypts: false });
  const store = createDefaultLicenseStore();
  await assert.rejects(store.replaceUnreadable(record()), /Keychain refused/);
  await assert.rejects(
    store.replaceUnreadable(record({ licenseKey: "sk_live_secret" })),
    /license record is invalid/,
  );
  assert.deepEqual(globalThis.__licenseStoreTest.copies, []);
  assert.deepEqual(globalThis.__licenseStoreTest.writes, []);
  assert.deepEqual([...files.entries()], [[newPath, locked]]);
});

test("replacement with only an unreadable legacy file leaves that file untouched", async () => {
  const legacy = Buffer.from("LOCKED legacy");
  const files = new Map([[oldPath, legacy]]);
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore();
  await store.replaceUnreadable(record());
  assert.deepEqual(globalThis.__licenseStoreTest.copies, []);
  assert.equal(files.get(oldPath), legacy);
  assert.deepEqual(await store.read(), record());
});

test("pending releases round-trip and malformed ones are rejected", async () => {
  const files = new Map();
  const { createDefaultLicenseStore } = await load(files);
  const store = createDefaultLicenseStore();
  const pending = record({
    pendingReleases: [{ licenseKey: KEY, instanceId: "inst-A", binding: BINDING }],
  });
  await store.write(pending);
  assert.deepEqual(await store.read(), pending);
  for (const pendingReleases of [
    "nope",
    [{ licenseKey: "sk_live_secret", instanceId: "inst-A", binding: BINDING }],
    [{ licenseKey: KEY, instanceId: " ", binding: BINDING }],
    [{ licenseKey: KEY, instanceId: "inst-A", binding: { issuer: "x" } }],
    Array.from({ length: 9 }, (_, index) => ({
      licenseKey: KEY,
      instanceId: `inst-${index}`,
      binding: BINDING,
    })),
  ]) {
    await assert.rejects(
      store.write(record({ pendingReleases })),
      /Saved DayBoard license record is invalid/,
    );
  }
});

test("backup copies never replace an existing file", async () => {
  const { copyFileIfPresent } = await bundle("main/services/file-store.ts");
  const dir = await mkdtemp(path.join(tmpdir(), "dayboard-license-backup-"));
  try {
    const source = path.join(dir, "license-stripe-v2.bin");
    const backup = path.join(dir, "license-stripe-v2.unreadable-1.bin");
    assert.equal(await copyFileIfPresent(source, backup), false);
    await writeFile(source, "original");
    assert.equal(await copyFileIfPresent(source, backup), true);
    assert.equal(await readFile(backup, "utf8"), "original");
    await writeFile(source, "changed");
    await assert.rejects(copyFileIfPresent(source, backup), { code: "EEXIST" });
    assert.equal(await readFile(backup, "utf8"), "original");
    assert.equal(await readFile(source, "utf8"), "changed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
