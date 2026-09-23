import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const profile = "/tmp/dayboard-license-test";
const oldPath = path.join(profile, "license.bin");
const newPath = path.join(profile, "license-stripe-v2.bin");
let sequence = 0;

async function load(files) {
  globalThis.__licenseStoreTest = { files, reads: [], writes: [] };
  const result = await build({
    entryPoints: [path.join(root, "main/services/license/license-store.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
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
               export const safeStorage = {
                 encryptString: async value => Buffer.from(value),
                 decryptString: async value => Buffer.from(value).toString()
               };`
                : `export const createSerialQueue = () => operation => operation();
               export const readFileIfExists = async file => {
                 globalThis.__licenseStoreTest.reads.push(file);
                 return globalThis.__licenseStoreTest.files.get(file) ?? null;
               };
               export const writeFileAtomic = async (file, bytes) => {
                 globalThis.__licenseStoreTest.writes.push(file);
                 globalThis.__licenseStoreTest.files.set(file, bytes);
               };`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(
      result.outputFiles[0].text + `\n// ${sequence++}`,
    ).toString("base64")}`
  );
}

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
  assert.match(record.installationId, /^[a-f0-9-]{36}$/);
  assert.equal(files.get(oldPath), legacy);
  assert.ok(files.has(newPath));
  assert.equal(globalThis.__licenseStoreTest.writes.length, 1);
  const reread = await store.read();
  assert.deepEqual(reread, record);
  assert.equal(globalThis.__licenseStoreTest.reads.filter((file) => file === oldPath).length, 1);
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
