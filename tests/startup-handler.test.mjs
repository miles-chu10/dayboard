import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { URL } from "node:url";

import { build } from "esbuild";

const state = { openAtLogin: false, calls: [], fail: false };
const handlers = new Map();

const backendStub = `
export const app = {
  getLoginItemSettings: () => ({ openAtLogin: globalThis.__startupState.openAtLogin, status: "enabled" }),
  setLoginItemSettings: ({ openAtLogin }) => {
    if (globalThis.__startupState.fail) throw new Error("synthetic login item failure");
    globalThis.__startupState.calls.push(openAtLogin);
    globalThis.__startupState.openAtLogin = openAtLogin;
  },
};
export const ipcMain = { handle: (channel, handler) => globalThis.__startupHandlers.set(channel, handler) };
`;

const bundle = await build({
  entryPoints: [new URL("../main/handlers/startup.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "startup-backend-stub",
      setup(api) {
        api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
          path: "backend",
          namespace: "startup-fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "startup-fixture" }, () => ({
          contents: backendStub,
          loader: "js",
        }));
      },
    },
  ],
});

globalThis.__startupState = state;
globalThis.__startupHandlers = handlers;
const startup = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`,
);
startup.registerStartupHandlers();

test("startup handlers read OS state and return the post-write readback", async () => {
  state.openAtLogin = false;
  state.calls.length = 0;
  const get = handlers.get("startup:getLoginItem");
  const set = handlers.get("startup:setLoginItem");

  assert.deepEqual(await get(), { openAtLogin: false, status: "enabled" });
  assert.deepEqual(await set({}, { openAtLogin: true }), { openAtLogin: true, status: "enabled" });
  assert.deepEqual(state.calls, [true]);
});

test("startup handler rejects malformed login-item requests", async () => {
  const set = handlers.get("startup:setLoginItem");
  assert.throws(() => set({}, { openAtLogin: "true" }), /openAtLogin must be a boolean/);
});

test("a failed login-item write leaves the OS readback unchanged", async () => {
  state.openAtLogin = false;
  state.fail = true;
  const get = handlers.get("startup:getLoginItem");
  const set = handlers.get("startup:setLoginItem");

  assert.throws(() => set({}, { openAtLogin: true }), /synthetic login item failure/);
  assert.deepEqual(await get(), { openAtLogin: false, status: "enabled" });
  state.fail = false;
});
