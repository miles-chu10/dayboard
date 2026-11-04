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

test("mail notifications start off and the Dock badge counts what waits on you", () => {
  assert.equal(DEFAULT_SETTINGS.system.mailNotifications, "off");
  assert.equal(DEFAULT_SETTINGS.system.dockBadge, "waiting");
  const chosen = normalizeSettings({ system: { mailNotifications: "all", dockBadge: "unread" } });
  assert.equal(chosen.system.mailNotifications, "all");
  assert.equal(chosen.system.dockBadge, "unread");
  const invalid = normalizeSettings({ system: { mailNotifications: "loud", dockBadge: 3 } });
  assert.equal(invalid.system.mailNotifications, "off");
  assert.equal(invalid.system.dockBadge, "waiting");
  // Other system settings survive alongside the new ones.
  assert.deepEqual(invalid.system.menuBar, DEFAULT_SETTINGS.system.menuBar);
});

test("the sidebar keeps a saved order, adds new views in place and never hides Home", () => {
  const all = ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"];
  assert.deepEqual(DEFAULT_SETTINGS.general.sidebar, { order: all, hidden: [], counts: true });
  // Saved before Notes existed, with duplicates and an unknown view: Notes joins at the end.
  const saved = normalizeSettings({
    general: {
      sidebar: {
        order: ["mail", "home", "mail", "inbox", "agenda", "calendar", "tasks", "reminders"],
        hidden: ["home", "reminders", "nope"],
        counts: false,
      },
    },
  }).general.sidebar;
  assert.deepEqual(saved, {
    order: ["mail", "home", "agenda", "calendar", "tasks", "reminders", "notes"],
    hidden: ["reminders"],
    counts: false,
  });
  // A view missing from the saved order joins at its default position.
  assert.deepEqual(
    normalizeSettings({
      general: { sidebar: { order: ["home", "mail", "tasks", "reminders", "notes"] } },
    }).general.sidebar.order,
    ["home", "agenda", "calendar", "mail", "tasks", "reminders", "notes"],
  );
  assert.deepEqual(normalizeSettings({ general: { sidebar: "bad" } }).general.sidebar, {
    order: all,
    hidden: [],
    counts: true,
  });
});
