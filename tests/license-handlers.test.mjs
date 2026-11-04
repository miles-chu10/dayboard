import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const state = { calls: [], broadcasts: [], release: "pending" };
const handlers = new Map();
globalThis.__licenseHandlerState = state;
globalThis.__licenseHandlers = handlers;

const platformStub = `
export const ipcMain = {
  handle: (channel, handler) => globalThis.__licenseHandlers.set(channel, handler),
  broadcast: (channel, payload) => globalThis.__licenseHandlerState.broadcasts.push([channel, payload]),
};
`;
const servicesStub = `
const state = () => globalThis.__licenseHandlerState;
const payload = (status) => ({ status, checkoutUrl: "https://example.invalid/buy" });
export const getLicenseStatus = async () => payload({ state: "trial", daysLeft: 7 });
export const refreshLicenseStatus = async () => payload({ state: "trial", daysLeft: 7 });
export const activateLicense = async (key, name) => (state().calls.push(["activate", key, name]), payload({ state: "licensed", keyHint: "AAAA" }));
export const deactivateLicense = async () => (state().calls.push(["deactivate"]), { ...payload({ state: "trial", daysLeft: 7 }), release: state().release });
export const resetUnreadableLicense = async () => (state().calls.push(["reset"]), payload({ state: "trial", daysLeft: 7 }));
`;

const bundle = await build({
  entryPoints: [new URL("../main/handlers/license.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "license-handler-stubs",
      setup(api) {
        api.onResolve({ filter: /platform\/index\.js$/ }, () => ({
          path: "platform",
          namespace: "license-handler-fixture",
        }));
        api.onResolve({ filter: /services\/license\/index\.js$/ }, () => ({
          path: "services",
          namespace: "license-handler-fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "license-handler-fixture" }, (args) => ({
          contents: args.path === "platform" ? platformStub : servicesStub,
          loader: "js",
        }));
      },
    },
  ],
});
const { registerLicenseHandlers } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
registerLicenseHandlers();

function reset() {
  state.calls.length = 0;
  state.broadcasts.length = 0;
}

test("license:reset runs only with the exact confirmation", async () => {
  reset();
  const handler = handlers.get("license:reset");
  for (const payload of [undefined, true, "yes", { confirm: true }, "reset"]) {
    await assert.rejects(handler({}, payload), /Confirm resetting license data/);
  }
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.broadcasts, []);

  const result = await handler({}, "reset-license-data-on-this-mac");
  assert.deepEqual(result.status, { state: "trial", daysLeft: 7 });
  assert.deepEqual(state.calls, [["reset"]]);
  assert.deepEqual(state.broadcasts, [["license:changed", result]]);
});

test("license:deactivate returns the release outcome and broadcasts only status", async () => {
  for (const release of ["released", "pending"]) {
    reset();
    state.release = release;
    const result = await handlers.get("license:deactivate")({});
    assert.equal(result.release, release);
    assert.deepEqual(state.broadcasts, [
      [
        "license:changed",
        { status: { state: "trial", daysLeft: 7 }, checkoutUrl: "https://example.invalid/buy" },
      ],
    ]);
  }
});

test("license:activate still rejects a missing key before reaching the service", async () => {
  reset();
  await assert.rejects(handlers.get("license:activate")({}, "  "), /Enter a license key/);
  await assert.rejects(handlers.get("license:activate")({}, 42), /Enter a license key/);
  assert.deepEqual(state.calls, []);
});
