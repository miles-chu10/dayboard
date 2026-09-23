import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function loadReminders() {
  const result = await build({
    entryPoints: [path.join(root, "main/platform/reminders.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "fake-native-process",
        setup(plugin) {
          plugin.onResolve({ filter: /^(electron|node:child_process)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "electron"
                ? 'export const app = { isPackaged: false, getAppPath: () => "/fake" };'
                : "export const spawn = (...args) => globalThis.__remindersFakeSpawn(...args);",
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("permission response can arrive after data timeout; data requests still time out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const child = new EventEmitter();
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  const sent = [];
  child.stdin = {
    write(line, callback) {
      sent.push(JSON.parse(line));
      callback();
    },
  };
  globalThis.__remindersFakeSpawn = () => child;
  t.after(() => {
    delete globalThis.__remindersFakeSpawn;
  });

  const { reminders } = await loadReminders();
  const permission = reminders.requestAccess();
  assert.equal(sent[0].op, "requestAccess");
  t.mock.timers.tick(16_000);
  child.stdout.emit(
    "data",
    `${JSON.stringify({ id: sent[0].id, ok: true, result: "full-access" })}\n`,
  );
  assert.equal(await permission, "full-access");

  const status = reminders.status();
  t.mock.timers.tick(15_000);
  await assert.rejects(status, /timed out waiting for "status"/);

  const stalledPermission = reminders.requestAccess();
  t.mock.timers.tick(5 * 60_000);
  await assert.rejects(stalledPermission, /timed out waiting for "requestAccess"/);
});
