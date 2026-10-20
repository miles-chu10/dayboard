import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

// Synthetic platform, demo and disk boundaries. The disk wrapper keeps the real file store in a
// temporary userData directory and lets a test hold or fail one read or write of a named file.
const boundaries = new Map([
  [
    "@glaze/core/backend",
    `export const app = { getPath: () => globalThis.__settingsFixture.userData };
    export const logger = { info() {}, warn() {}, error() {} };
    export const safeStorage = {
      encryptString: async (text) => Buffer.from("sealed:" + text),
      decryptString: async (data) => {
        const text = Buffer.from(data).toString("utf8");
        if (!text.startsWith("sealed:")) throw new Error("synthetic decryption failed");
        return text.slice("sealed:".length);
      },
    };`,
  ],
  [
    "./demo-data.js",
    `export const isDemoMode = () => globalThis.__settingsFixture.demo;
    export const assertNotDemo = (channel) => {
      if (isDemoMode()) throw new Error(channel + ": changes are turned off in demo mode.");
    };`,
  ],
  [
    "file-store",
    `import * as files from "./file-store.ts";
    const disk = () => globalThis.__settingsFixture.disk;
    export const createSerialQueue = files.createSerialQueue;
    export const readFileIfExists = (target) =>
      disk().run("read", target, () => files.readFileIfExists(target));
    export const writeFileAtomic = (target, data) =>
      disk().run("write", target, () => files.writeFileAtomic(target, data));`,
  ],
]);

const boundary = (specifier) =>
  /(?:^|\/)file-store\.js$/.test(specifier) ? "file-store" : specifier;

const bundle = await build({
  entryPoints: [path.join(root, "main/services/settings-store.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "settings-persistence-boundaries",
      setup(api) {
        api.onResolve({ filter: /.*/ }, (args) =>
          boundaries.has(boundary(args.path))
            ? { path: boundary(args.path), namespace: "settings-persistence" }
            : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "settings-persistence" }, (args) => ({
          contents: boundaries.get(args.path),
          resolveDir: path.join(root, "main/services"),
          loader: "js",
        }));
      },
    },
  ],
});
let sequence = 0;

/** Each instance starts with empty caches and queues, like a relaunched app. */
function loadStore() {
  const source = `${bundle.outputFiles[0].text}\n// instance ${sequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

/** Real temporary-directory I/O whose next read or write of a named file can be held or failed. */
function createDisk() {
  const inFlight = new Set();
  const plans = [];
  const track = (promise) => {
    inFlight.add(promise);
    const settle = () => inFlight.delete(promise);
    promise.then(settle, settle);
    return promise;
  };
  return {
    /** Holds the next matching operation; release(error) fails it instead of finishing it. */
    hold(kind, file) {
      const plan = { kind, file };
      const reached = new Promise((resolve) => {
        plan.arrive = resolve;
      });
      plan.released = new Promise((resolve) => {
        plan.release = resolve;
      });
      plans.push(plan);
      return { reached, release: plan.release };
    },
    fail(kind, file, error) {
      plans.push({ kind, file, error });
    },
    async run(kind, target, operation) {
      const index = plans.findIndex(
        (plan) => plan.kind === kind && plan.file === path.basename(target),
      );
      const plan = index === -1 ? undefined : plans.splice(index, 1)[0];
      if (plan?.error) throw plan.error;
      // A read sees the file as it was when the read started; a held read just finishes late.
      // A held write commits only after it is released.
      const contents = kind === "read" ? await track(operation()) : undefined;
      if (plan) {
        plan.arrive();
        const error = await plan.released;
        if (error) throw error;
      }
      return kind === "read" ? contents : track(operation());
    },
    /** Settles once no real I/O is pending and everything that isn't held has moved on. */
    async idle() {
      do {
        await Promise.allSettled([...inFlight]);
        await new Promise((resolve) => setImmediate(resolve));
      } while (inFlight.size > 0);
    },
  };
}

async function withStore(run, { demo = false } = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "dayboard-settings-"));
  const disk = createDisk();
  globalThis.__settingsFixture = { userData, demo, disk };
  try {
    await run({ userData, disk, store: await loadStore() });
  } finally {
    delete globalThis.__settingsFixture;
    await rm(userData, { recursive: true, force: true });
  }
}

/** Whole settings, as the Settings window sends them, with some General values changed. */
function settingsWith(base, general) {
  return { ...base, general: { ...base.general, ...general } };
}

function mcpServer(name, id) {
  return { id, name, transport: "http", url: `https://${name.toLowerCase()}.example.test` };
}

const names = (servers) => servers.map((server) => server.name);
const sealed = (value) => `sealed:${JSON.stringify(value)}`;

async function storedServerNames(file) {
  const text = await readFile(file, "utf8");
  assert.ok(text.startsWith("sealed:"), "MCP servers are written through safeStorage");
  return names(JSON.parse(text.slice("sealed:".length)));
}

test("a slow first settings read cannot replace settings saved after it started", async () => {
  await withStore(async ({ userData, disk, store }) => {
    const file = path.join(userData, "settings.json");
    const defaults = store.DEFAULT_SETTINGS;
    await writeFile(file, JSON.stringify(settingsWith(defaults, { accent: "pink" })));

    const slowRead = disk.hold("read", "settings.json");
    const firstRead = store.getSettings();
    await slowRead.reached;
    const saved = store.saveSettings(settingsWith(defaults, { accent: "teal" }));
    await disk.idle();
    slowRead.release();
    await firstRead;
    assert.equal((await saved).settings.general.accent, "teal");

    assert.equal((await store.getSettings()).general.accent, "teal");
    assert.equal(JSON.parse(await readFile(file, "utf8")).general.accent, "teal");
    const relaunched = await loadStore();
    assert.equal((await relaunched.getSettings()).general.accent, "teal");
  });
});

test("a settings read submitted during a blocked save returns the committed result", async () => {
  await withStore(async ({ userData, disk, store }) => {
    const file = path.join(userData, "settings.json");
    const initial = await store.getSettings();

    let write = disk.hold("write", "settings.json");
    const saved = store.saveSettings(settingsWith(initial, { accent: "teal" }));
    await write.reached;
    const reopened = store.getSettings();
    write.release();
    await saved;
    const current = await reopened;
    assert.equal(current.general.accent, "teal");
    // The Settings window sends whole objects, so its next edit must start from the saved result.
    const { settings: latest } = await store.saveSettings(
      settingsWith(current, { density: "compact" }),
    );
    const committed = await readFile(file, "utf8");
    const { accent, density } = JSON.parse(committed).general;
    assert.deepEqual([accent, density], ["teal", "compact"]);

    write = disk.hold("write", "settings.json");
    const failed = store.saveSettings(settingsWith(latest, { accent: "red" }));
    await write.reached;
    const afterFailure = store.getSettings();
    write.release(new Error("synthetic disk full"));
    await assert.rejects(failed, /synthetic disk full/);
    assert.deepEqual(await afterFailure, latest);
    assert.equal(await readFile(file, "utf8"), committed);

    await store.saveSettings(settingsWith(latest, { accent: "green" }));
    assert.equal(JSON.parse(await readFile(file, "utf8")).general.accent, "green");
  });
});

test("a failed settings read reaches its caller without skewing later saves", async () => {
  await withStore(async ({ userData, disk, store }) => {
    const file = path.join(userData, "settings.json");
    const defaults = store.DEFAULT_SETTINGS;
    await writeFile(file, JSON.stringify(settingsWith(defaults, { accent: "pink" })));

    const denied = Object.assign(new Error("synthetic permission denied"), { code: "EACCES" });
    disk.fail("read", "settings.json", denied);
    const failedRead = store.getSettings();
    const saved = store.saveSettings(settingsWith(defaults, { accent: "teal" }));
    await assert.rejects(failedRead, /synthetic permission denied/);
    assert.equal((await saved).previous.general.accent, "pink");
    assert.equal((await store.getSettings()).general.accent, "teal");

    // Malformed JSON is reported rather than replaced, and is read again once repaired.
    const relaunched = await loadStore();
    await writeFile(file, "{ not json");
    await assert.rejects(relaunched.getSettings(), /not valid JSON/);
    await assert.rejects(relaunched.saveSettings(defaults), /not valid JSON/);
    assert.equal(await readFile(file, "utf8"), "{ not json");
    await writeFile(file, JSON.stringify(settingsWith(defaults, { accent: "graphite" })));
    assert.equal((await relaunched.getSettings()).general.accent, "graphite");
  });
});

test("MCP server reads stay ordered with saves and deletes", async () => {
  await withStore(async ({ userData, disk, store }) => {
    const file = path.join(userData, "mcp-servers.bin");
    await writeFile(file, sealed([mcpServer("Alpha", "alpha"), mcpServer("Beta", "beta")]));

    // A slow list that started before a delete cannot bring the deleted server back.
    const slowList = disk.hold("read", "mcp-servers.bin");
    const firstList = store.getMcpServers();
    await slowList.reached;
    const deleted = store.deleteMcpServer("beta");
    await disk.idle();
    slowList.release();
    await firstList;
    assert.deepEqual(names(await deleted), ["Alpha"]);
    assert.deepEqual(names(await store.getMcpServers()), ["Alpha"]);

    // A list submitted while a save is blocked includes that save.
    const write = disk.hold("write", "mcp-servers.bin");
    const saved = store.saveMcpServer(mcpServer("Gamma"));
    await write.reached;
    const listed = store.getMcpServers();
    write.release();
    await saved;
    assert.deepEqual(names(await listed), ["Alpha", "Gamma"]);
    assert.deepEqual(await storedServerNames(file), ["Alpha", "Gamma"]);

    // Rejected and failed saves keep the stored list, and later saves still run.
    const committed = await readFile(file, "utf8");
    await assert.rejects(store.saveMcpServer(mcpServer("alpha")), /already exists/);
    disk.fail("write", "mcp-servers.bin", new Error("synthetic disk full"));
    await assert.rejects(store.saveMcpServer(mcpServer("Delta")), /synthetic disk full/);
    assert.equal(await readFile(file, "utf8"), committed);
    assert.deepEqual(names(await store.getMcpServers()), ["Alpha", "Gamma"]);
    await store.saveMcpServer(mcpServer("Delta"));
    assert.deepEqual(await storedServerNames(file), ["Alpha", "Gamma", "Delta"]);
  });
});

test("demo mode keeps the ordering and never exposes real settings or MCP servers", async () => {
  await withStore(
    async ({ userData, disk, store }) => {
      const defaults = store.DEFAULT_SETTINGS;
      const realSettings = path.join(userData, "settings.json");
      const realText = JSON.stringify(settingsWith(defaults, { accent: "pink" }));
      await writeFile(realSettings, realText);
      const realServers = path.join(userData, "mcp-servers.bin");
      await writeFile(realServers, sealed([mcpServer("Alpha", "alpha")]));

      // First demo run: the slow read finds no demo settings, then a save creates them.
      const slowRead = disk.hold("read", "demo-settings.json");
      const firstRead = store.getSettings();
      await slowRead.reached;
      const saved = store.saveSettings({
        ...settingsWith(defaults, { accent: "graphite" }),
        mcpServer: { enabled: true, allowWrites: true },
      });
      await disk.idle();
      slowRead.release();
      await Promise.all([firstRead, saved]);
      const current = await store.getSettings();
      assert.equal(current.general.accent, "graphite");
      assert.deepEqual(current.mcpServer, { enabled: false, allowWrites: false });
      assert.equal(await readFile(realSettings, "utf8"), realText);

      assert.deepEqual(await store.getMcpServers(), []);
      assert.throws(() => store.saveMcpServer(mcpServer("Live")), /demo mode/);
      assert.throws(() => store.deleteMcpServer("alpha"), /demo mode/);
    },
    { demo: true },
  );
});

test("defaults the system section", async () => {
  await withStore(async ({ store }) => {
    assert.deepEqual(store.normalizeSettings({}).system, {
      quickCapture: { enabled: true, hotkey: "Control+Alt+Space" },
      menuBar: { enabled: true },
      meetings: { upNext: true, notify: false, notifyMinutesBefore: 2, notesImport: true },
    });
    assert.deepEqual(store.DEFAULT_SETTINGS.system, store.normalizeSettings({}).system);
  });
});

test("keeps a valid custom hotkey", async () => {
  await withStore(async ({ store }) => {
    const settings = store.normalizeSettings({
      system: { quickCapture: { enabled: false, hotkey: "Alt+Control+d" } },
    });
    assert.deepEqual(settings.system.quickCapture, { enabled: false, hotkey: "Control+Alt+D" });
  });
});

test("falls back to the default hotkey when invalid", async () => {
  await withStore(async ({ store }) => {
    for (const hotkey of ["Command+Q", 42, "A", "Control+Alt"]) {
      const settings = store.normalizeSettings({ system: { quickCapture: { hotkey } } });
      assert.equal(settings.system.quickCapture.hotkey, "Control+Alt+Space", String(hotkey));
    }
  });
});

test("clamps notifyMinutesBefore to 1, 2, 5 or 10", async () => {
  await withStore(async ({ store }) => {
    const minutes = (value) =>
      store.normalizeSettings({ system: { meetings: { notifyMinutesBefore: value } } }).system
        .meetings.notifyMinutesBefore;
    assert.equal(minutes(5), 5);
    assert.equal(minutes(10), 10);
    assert.equal(minutes(3), 2);
    assert.equal(minutes("5"), 2);
  });
});

test("notifies in-process listeners after a save", async () => {
  await withStore(async ({ store }) => {
    const calls = [];
    const unsubscribe = store.onSettingsChanged((next, previous) => calls.push([next, previous]));
    const base = await store.getSettings();
    const changed = { ...base, system: { ...base.system, menuBar: { enabled: false } } };
    await store.saveSettings(changed);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].system.menuBar.enabled, false);
    assert.equal(calls[0][1].system.menuBar.enabled, true);
    unsubscribe();
    await store.saveSettings(base);
    assert.equal(calls.length, 1);
  });
});
