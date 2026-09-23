import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const bundle = await build({
  entryPoints: [path.join(root, "main/services/app-updates.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { createAppUpdates } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const gateBundle = await build({
  entryPoints: [path.join(root, "main/services/runtime-activity.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
let gateSequence = 0;
async function loadGate() {
  const source = `${gateBundle.outputFiles[0].text}\n// instance ${gateSequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class FakeUpdater extends EventEmitter {
  calls = { check: 0, download: 0, install: 0, feed: [] };
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  version = "1.3.0-beta.2";
  checkOutcome = "available";
  downloadOutcome = "success";
  installOutcome = "success";

  setFeedURL(feed) {
    this.calls.feed.push(feed);
  }

  async checkForUpdates() {
    this.calls.check++;
    if (this.checkOutcome instanceof Promise) return this.checkOutcome;
    if (this.checkOutcome === "error") throw new Error("check failed");
    if (this.checkOutcome === "no-result") return null;
    const isUpdateAvailable = this.checkOutcome === "available";
    this.emit(isUpdateAvailable ? "update-available" : "update-not-available", {
      version: this.version,
    });
    return { isUpdateAvailable, updateInfo: { version: this.version } };
  }

  async downloadUpdate() {
    this.calls.download++;
    if (this.downloadOutcome === "error") throw new Error("download failed");
    if (this.downloadOutcome instanceof Promise) return this.downloadOutcome;
    this.emit("download-progress", { percent: 47 });
    if (this.downloadOutcome === "success")
      this.emit("update-downloaded", { version: this.version });
    return ["/fake/update.zip"];
  }

  quitAndInstall() {
    this.calls.install++;
    if (this.installOutcome === "error") throw new Error("native install rejected");
  }
}

function fixture(overrides = {}) {
  const updater = new FakeUpdater();
  let loads = 0;
  let drains = 0;
  let resumes = 0;
  const changes = [];
  const options = {
    isOfficialRelease: true,
    isPackaged: true,
    isDemo: () => false,
    currentVersion: "1.3.0-beta.1",
    loadUpdater: async () => {
      loads++;
      return updater;
    },
    prepareForInstall: async () => {
      drains++;
    },
    resumeAfterInstallFailure: () => {
      resumes++;
    },
    onChange: (state) => changes.push(state),
    ...overrides,
  };
  const service = createAppUpdates(options);
  return {
    service,
    updater,
    changes,
    get loads() {
      return loads;
    },
    get drains() {
      return drains;
    },
    get resumes() {
      return resumes;
    },
  };
}

test("source, preview, and demo builds never load or call the updater", async () => {
  for (const override of [
    { isOfficialRelease: false },
    { isPackaged: false },
    { isDemo: () => true },
  ]) {
    const item = fixture(override);
    for (const action of ["status", "check", "download", "install"]) {
      assert.equal((await item.service[action]()).phase, "unavailable");
    }
    assert.match(item.service.status().message, /official DayBoard downloads/);
    assert.equal(item.loads, 0);
    assert.deepEqual(item.updater.calls, { check: 0, download: 0, install: 0, feed: [] });
  }
});

test("official checks use fixed GitHub feed and manual, prerelease-safe settings", async () => {
  const item = fixture();
  assert.equal(item.service.status().phase, "idle");
  const state = await item.service.check();
  assert.equal(state.phase, "available");
  assert.equal(state.availableVersion, "1.3.0-beta.2");
  assert.equal(item.updater.autoDownload, false);
  assert.equal(item.updater.autoInstallOnAppQuit, false);
  assert.equal(item.updater.allowPrerelease, true);
  assert.equal(item.updater.allowDowngrade, false);
  assert.deepEqual(item.updater.calls.feed, [
    { provider: "github", owner: "miles-chu10", repo: "dayboard" },
  ]);
  assert.equal(item.updater.calls.download, 0);
  assert.equal(item.updater.calls.install, 0);
  assert.equal(item.loads, 1);
});

test("stable versions do not request prereleases; no update and errors are reported", async () => {
  const item = fixture({ currentVersion: "1.3.0" });
  item.updater.checkOutcome = "none";
  assert.equal((await item.service.check()).phase, "up-to-date");
  assert.equal(item.updater.allowPrerelease, false);
  item.updater.checkOutcome = "error";
  const failed = await item.service.check();
  assert.equal(failed.phase, "error");
  assert.match(failed.error, /check failed/);
  item.updater.checkOutcome = "no-result";
  assert.match((await item.service.check()).error, /unavailable/);
});

test("concurrent checks deduplicate and timed-out checks cannot start another request", async () => {
  const waiting = deferred();
  const item = fixture({ checkTimeoutMs: 5 });
  item.updater.checkOutcome = waiting.promise;
  const first = item.service.check();
  const second = item.service.check();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(item.updater.calls.check, 1);
  const timedOut = await first;
  assert.equal(timedOut.phase, "error");
  assert.match(timedOut.error, /timed out/);
  assert.equal((await item.service.check()).phase, "error");
  assert.equal(item.updater.calls.check, 1);
  waiting.resolve({ isUpdateAvailable: true, updateInfo: { version: item.updater.version } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(item.service.status().phase, "error");
});

test("concurrent downloads deduplicate and a timed-out download cannot be installed", async () => {
  const waiting = deferred();
  const item = fixture({ downloadTimeoutMs: 5 });
  await item.service.check();
  item.updater.downloadOutcome = waiting.promise;
  const first = item.service.download();
  const second = item.service.download();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(item.updater.calls.download, 1);
  assert.match((await first).error, /timed out/);
  assert.equal((await item.service.install()).phase, "error");
  assert.equal(item.updater.calls.install, 0);
  item.updater.emit("update-downloaded", { version: item.updater.version });
  assert.equal(item.service.status().phase, "error");
  waiting.resolve(["/fake/update.zip"]);
  await new Promise((resolve) => setImmediate(resolve));
});

test("download reports progress and requires its completion event", async () => {
  const item = fixture();
  assert.equal((await item.service.download()).phase, "idle");
  await item.service.check();
  assert.equal((await item.service.download()).phase, "downloaded");
  assert.ok(
    item.changes.some((state) => state.phase === "downloading" && state.progressPercent === 47),
  );
  assert.equal(item.updater.calls.download, 1);

  const incomplete = fixture();
  incomplete.updater.downloadOutcome = "no-event";
  await incomplete.service.check();
  const failed = await incomplete.service.download();
  assert.equal(failed.phase, "error");
  assert.match(failed.error, /did not verify/);
  assert.equal((await incomplete.service.install()).phase, "error");
  assert.equal(incomplete.updater.calls.install, 0);
});

test("failed downloads and updater error events cannot unlock install", async () => {
  const item = fixture();
  await item.service.check();
  item.updater.downloadOutcome = "error";
  assert.match((await item.service.download()).error, /download failed/);
  assert.equal((await item.service.install()).phase, "error");
  assert.equal(item.updater.calls.install, 0);

  const eventItem = fixture();
  await eventItem.service.check();
  const waiting = deferred();
  eventItem.updater.downloadOutcome = waiting.promise;
  const download = eventItem.service.download();
  eventItem.updater.emit("error", new Error("signature rejected"));
  waiting.resolve([]);
  assert.match((await download).error, /signature rejected/);
  assert.equal(eventItem.updater.calls.install, 0);
});

test("install runs save drain first and does not quit on drain failure", async () => {
  const item = fixture({
    prepareForInstall: async () => {
      throw new Error("pending writes");
    },
  });
  await item.service.check();
  await item.service.download();
  const blocked = await item.service.install();
  assert.equal(blocked.phase, "downloaded");
  assert.match(blocked.error, /pending writes/);
  assert.equal(item.resumes, 1);
  assert.equal(item.updater.calls.install, 0);

  const success = fixture();
  assert.equal((await success.service.install()).phase, "idle");
  await success.service.check();
  assert.equal((await success.service.install()).phase, "available");
  await success.service.download();
  const installed = await success.service.install();
  assert.equal(installed.phase, "installing");
  assert.equal(success.drains, 1);
  assert.equal(success.updater.calls.install, 1);
  assert.equal((await success.service.install()).phase, "installing");
  assert.equal(success.updater.calls.install, 1);
});

test("preparing blocks update actions and failed save drain unfreezes app operations", async () => {
  const gate = await loadGate();
  const waiting = deferred();
  const item = fixture({
    prepareForInstall: async () => {
      await gate.pauseAndDrainAppOperations();
      await waiting.promise;
      throw new Error("save failed");
    },
    resumeAfterInstallFailure: gate.resumeAppOperations,
  });
  await item.service.check();
  await item.service.download();
  const install = item.service.install();
  assert.equal(item.service.status().phase, "preparing");
  assert.equal((await item.service.check()).phase, "preparing");
  assert.equal((await item.service.download()).phase, "preparing");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    gate.runAppOperation(() => "unexpected"),
    /preparing to install/,
  );
  waiting.resolve();
  assert.equal((await install).phase, "downloaded");
  assert.equal(item.updater.calls.install, 0);
  assert.equal(await gate.runAppOperation(() => "usable"), "usable");
  assert.ok(item.changes.some((state) => state.phase === "preparing"));
});

test("updater errors during preparation and after install request restore retryable state", async () => {
  const waiting = deferred();
  const preparing = fixture({ prepareForInstall: () => waiting.promise });
  await preparing.service.check();
  await preparing.service.download();
  const pending = preparing.service.install();
  preparing.updater.emit("error", new Error("native verification failed"));
  waiting.resolve();
  const recovered = await pending;
  assert.equal(recovered.phase, "downloaded");
  assert.match(recovered.error, /native verification failed/);
  assert.equal(preparing.resumes, 1);
  assert.equal(preparing.updater.calls.install, 0);

  const gate = await loadGate();
  const installing = fixture({
    prepareForInstall: () => gate.pauseAndDrainAppOperations(),
    resumeAfterInstallFailure: gate.resumeAppOperations,
  });
  await installing.service.check();
  await installing.service.download();
  assert.equal((await installing.service.install()).phase, "installing");
  await assert.rejects(
    gate.runAppOperation(() => "unexpected"),
    /preparing to install/,
  );
  installing.updater.emit("error", new Error("native verification failed"));
  assert.equal(installing.service.status().phase, "downloaded");
  assert.match(installing.service.status().error, /native verification failed/);
  assert.equal(await gate.runAppOperation(() => "usable"), "usable");
});

test("synchronous native install rejection resumes app use without a second quit", async () => {
  const gate = await loadGate();
  const item = fixture({
    prepareForInstall: () => gate.pauseAndDrainAppOperations(),
    resumeAfterInstallFailure: gate.resumeAppOperations,
  });
  await item.service.check();
  await item.service.download();
  item.updater.installOutcome = "error";
  const failed = await item.service.install();
  assert.equal(failed.phase, "downloaded");
  assert.match(failed.error, /native install rejected/);
  assert.equal(item.updater.calls.install, 1);
  assert.equal(await gate.runAppOperation(() => "usable"), "usable");
});

test("concurrent install requests share one save drain and installer call", async () => {
  const waiting = deferred();
  let drains = 0;
  const item = fixture({
    prepareForInstall: async () => {
      drains++;
      await waiting.promise;
    },
  });
  await item.service.check();
  await item.service.download();
  const first = item.service.install();
  const second = item.service.install();
  assert.equal(first, second);
  assert.equal(item.updater.calls.install, 0);
  waiting.resolve();
  assert.equal((await first).phase, "installing");
  assert.equal(drains, 1);
  assert.equal(item.updater.calls.install, 1);
});
