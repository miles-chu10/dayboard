import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const platformStub = {
  name: "platform-stub",
  setup(build) {
    build.onResolve({ filter: /platform\/index\.js$/ }, (args) => ({
      path: args.path,
      namespace: "platform-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "platform-stub" }, () => ({
      contents:
        'export const app = { getPath: () => "/tmp" }; export const logger = { info() {}, warn() {}, error() {} }; export const safeStorage = {};',
      loader: "js",
    }));
  },
};

const { normalizeSettings, DEFAULT_SETTINGS } = await loadTs("main/services/settings-store.ts", [
  platformStub,
]);

test("mail settings default to automatic triage, a 5 s undo window and 3-day follow-ups", () => {
  assert.deepEqual(DEFAULT_SETTINGS.mail, {
    maxMessages: 25,
    autoTriage: true,
    undoSendSeconds: 5,
    followUpDays: 3,
  });
  // Settings saved before these options existed keep their inbox size and gain the defaults.
  assert.deepEqual(normalizeSettings({ mail: { maxMessages: 50 } }).mail, {
    maxMessages: 50,
    autoTriage: true,
    undoSendSeconds: 5,
    followUpDays: 3,
  });
});

test("mail settings accept only the offered choices", () => {
  const valid = normalizeSettings({
    mail: { maxMessages: 10, autoTriage: false, undoSendSeconds: 0, followUpDays: 7 },
  }).mail;
  assert.deepEqual(valid, {
    maxMessages: 10,
    autoTriage: false,
    undoSendSeconds: 0,
    followUpDays: 7,
  });
  const invalid = normalizeSettings({
    mail: { autoTriage: "yes", undoSendSeconds: 7, followUpDays: 400 },
  }).mail;
  assert.equal(invalid.autoTriage, true);
  assert.equal(invalid.undoSendSeconds, 5);
  assert.equal(invalid.followUpDays, 3);
});

test("the Agenda can be the launch view, and Home is the default", () => {
  assert.equal(DEFAULT_SETTINGS.general.launchView, "today");
  assert.equal(
    normalizeSettings({ general: { launchView: "agenda" } }).general.launchView,
    "agenda",
  );
  assert.equal(
    normalizeSettings({ general: { launchView: "nowhere" } }).general.launchView,
    "today",
  );
});
