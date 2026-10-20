import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { createMeetingAlerts } = await loadTs("main/services/meetings/meeting-alerts.ts");

const start = new Date("2026-10-20T16:00:00.000Z");
const iso = (minutes) => new Date(start.getTime() + minutes * 60_000).toISOString();

function meeting(id, startMinutes, overrides = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    start: iso(startMinutes),
    end: iso(startMinutes + 30),
    allDay: false,
    location: null,
    description: null,
    meetLink: "https://meet.google.com/abc",
    calendarId: "primary",
    attendees: ["sam@example.com"],
    primaryCalendar: true,
    selfInvited: true,
    selfResponse: "accepted",
    ...overrides,
  };
}

function harness(initial) {
  const state = { now: start, events: initial, notified: [], timers: [], fetches: [] };
  const alerts = createMeetingAlerts({
    listEvents: () =>
      new Promise((resolve) => {
        if (state.hold) state.fetches.push(resolve);
        else resolve(state.events);
      }),
    notify: (alert) => state.notified.push(alert),
    setTimer: (fn, ms) => {
      const timer = { ms, cancelled: false };
      // A timer that fired is spent, like a real setTimeout.
      timer.fn = () => {
        timer.cancelled = true;
        fn();
      };
      state.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => state.now,
  });
  const live = () => state.timers.filter((timer) => !timer.cancelled);
  const alertTimers = live;
  return { alerts, state, live, alertTimers };
}

const on = { notify: true, notifyMinutesBefore: 2 };

test("schedules one timer for the next alert", async () => {
  const { alerts, alertTimers } = harness([meeting("a", 10), meeting("b", 30)]);
  await alerts.configure(on);
  assert.equal(alertTimers().length, 1);
  assert.equal(alertTimers()[0].ms, 8 * 60_000);
});

test("notifies once per meeting start", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  state.now = new Date(start.getTime() + 8 * 60_000);
  alertTimers()[0].fn();
  await alerts.refresh();
  assert.equal(state.notified.length, 1);
  assert.deepEqual(state.notified[0], {
    title: "Meeting a",
    body: "Starts in 2 min",
    joinUrl: "https://meet.google.com/abc",
  });
  assert.equal(alertTimers().length, 0, "the same start is never alerted twice");
});

test("reschedules when a meeting moves", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  state.events = [meeting("a", 20)];
  await alerts.refresh();
  assert.equal(alertTimers().length, 1);
  assert.equal(alertTimers()[0].ms, 18 * 60_000);
});

test("does nothing when notify is off", async () => {
  const { alerts, live } = harness([meeting("a", 10)]);
  await alerts.configure({ notify: false, notifyMinutesBefore: 2 });
  assert.equal(live().length, 0);
});

test("does nothing when the Calendar source is off", async () => {
  const { alerts, alertTimers } = harness(null);
  await alerts.configure(on);
  assert.equal(alertTimers().length, 0);
});

test("does nothing when Google is not connected", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  state.events = null;
  await alerts.refresh();
  assert.equal(alertTimers().length, 0);
});

test("recomputes and cancels the timer on an account change", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  const first = alertTimers()[0];
  state.events = [meeting("other-account", 40)];
  await alerts.refresh();
  assert.equal(first.cancelled, true);
  assert.equal(alertTimers().length, 1);
  assert.equal(alertTimers()[0].ms, 38 * 60_000);
});

test("discards a fetch that finishes after a newer refresh", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  state.hold = true;
  const older = alerts.refresh();
  const newer = alerts.refresh();
  const [resolveOlder, resolveNewer] = state.fetches;
  resolveNewer([meeting("new", 30)]);
  await newer;
  resolveOlder([meeting("stale", 5)]);
  await older;
  assert.equal(alertTimers().length, 1);
  assert.equal(alertTimers()[0].ms, 28 * 60_000);
});

test("includes the join URL only when it is https", async () => {
  const { alerts, state, alertTimers } = harness([
    meeting("a", 10, { meetLink: null, description: "http://zoom.us/j/1" }),
  ]);
  await alerts.configure(on);
  state.now = new Date(start.getTime() + 8 * 60_000);
  alertTimers()[0].fn();
  assert.equal(state.notified[0].joinUrl, null);
});

test("an account change cancels the armed alert before the new fetch returns", async () => {
  const { alerts, state, alertTimers } = harness([meeting("a", 10)]);
  await alerts.configure(on);
  const armed = alertTimers()[0];
  state.hold = true;
  const pending = alerts.refresh();
  assert.equal(armed.cancelled, true, "the old account's alert is disarmed immediately");
  armed.fn();
  assert.equal(state.notified.length, 0, "a stale timer callback never notifies");
  state.fetches[0](null);
  await pending;
});
