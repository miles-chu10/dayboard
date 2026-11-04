import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { createMailSchedule, parseScheduleFile } = await loadTs("main/services/mail-schedule.ts");

const HOUR = 3_600_000;

function harness({ scope = "google:a", replies = new Set(), failUnsnooze = false } = {}) {
  let now = 1_000_000;
  let stored = null;
  const timers = new Map();
  let nextHandle = 1;
  const events = { changes: 0, due: [], unsnoozed: [] };
  const state = { scope, failUnsnooze };
  const schedule = createMailSchedule({
    read: async () => stored,
    write: async (text) => {
      stored = text;
    },
    scope: async () => state.scope,
    now: () => now,
    unsnooze: async (entry) => {
      if (state.failUnsnooze) throw new Error("offline");
      events.unsnoozed.push(entry.messageId);
    },
    hasReply: async (entry) => replies.has(entry.threadId),
    onChange: () => events.changes++,
    onDue: (entry) => events.due.push(`${entry.kind}:${entry.messageId}`),
    timers: {
      setTimeout: (callback, ms) => {
        const handle = nextHandle++;
        timers.set(handle, { at: now + ms, callback });
        return handle;
      },
      clearTimeout: (handle) => timers.delete(handle),
    },
  });
  return {
    schedule,
    events,
    state,
    stored: () => stored,
    setStored: (text) => {
      stored = text;
    },
    timerWaits: () => [...timers.values()].map((timer) => timer.at - now),
    async advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
      await schedule.drain();
    },
    now: () => now,
  };
}

const entry = (kind, messageId, createdAt, dueAt, threadId = `t-${messageId}`) => ({
  kind,
  messageId,
  threadId,
  subject: `Subject ${messageId}`,
  from: "Sam",
  fromEmail: "sam@example.com",
  createdAt,
  dueAt,
});

test("a snoozed email comes back to the inbox when its time arrives", async () => {
  const h = harness();
  await h.schedule.start();
  await h.schedule.add(entry("snooze", "m1", h.now(), h.now() + 2 * HOUR));
  assert.deepEqual(h.timerWaits(), [HOUR]); // checks at least hourly
  await h.advance(HOUR);
  assert.deepEqual(h.events.unsnoozed, []);
  await h.advance(HOUR);
  assert.deepEqual(h.events.unsnoozed, ["m1"]);
  assert.deepEqual(h.events.due, ["snooze:m1"]);
  assert.deepEqual(await h.schedule.list(), []);
});

test("a failed unsnooze stays scheduled and is retried", async () => {
  const h = harness({ failUnsnooze: true });
  await h.schedule.start();
  await h.schedule.add(entry("snooze", "m1", h.now(), h.now() + 1000));
  await h.advance(1000);
  assert.equal((await h.schedule.list()).length, 1);
  h.state.failUnsnooze = false;
  await h.advance(HOUR);
  assert.deepEqual(h.events.unsnoozed, ["m1"]);
  assert.deepEqual(await h.schedule.list(), []);
});

test("a follow-up with no reply becomes due once; a reply clears it", async () => {
  const replies = new Set();
  const h = harness({ replies });
  await h.schedule.start();
  await h.schedule.add(entry("follow-up", "m2", h.now(), h.now() + 1000));
  await h.advance(1000);
  const [due] = await h.schedule.list();
  assert.equal(due.due, true);
  assert.deepEqual(h.events.due, ["follow-up:m2"]);
  // Still no reply: it stays due without notifying again.
  await h.advance(HOUR);
  assert.deepEqual(h.events.due, ["follow-up:m2"]);
  replies.add("t-m2");
  await h.advance(HOUR);
  assert.deepEqual(await h.schedule.list(), []);
});

test("a follow-up answered before it's due is dropped quietly", async () => {
  const h = harness({ replies: new Set(["t-m3"]) });
  await h.schedule.start();
  await h.schedule.add(entry("follow-up", "m3", h.now(), h.now() + 1000));
  await h.advance(1000);
  assert.deepEqual(await h.schedule.list(), []);
  assert.deepEqual(h.events.due, []);
});

test("entries survive a restart and anything overdue catches up at launch", async () => {
  const first = harness();
  await first.schedule.add(entry("snooze", "m4", first.now(), first.now() + 1000));
  const second = harness();
  second.setStored(first.stored());
  await second.advance(5000);
  await second.schedule.start();
  assert.deepEqual(second.events.unsnoozed, ["m4"]);
});

test("each account sees only its own entries", async () => {
  const h = harness();
  await h.schedule.add(entry("follow-up", "a1", h.now(), h.now() + HOUR));
  h.state.scope = "google:b";
  assert.deepEqual(await h.schedule.list(), []);
  await h.schedule.add(entry("follow-up", "b1", h.now(), h.now() + HOUR));
  h.state.scope = "google:a";
  assert.deepEqual(
    (await h.schedule.list()).map((item) => item.messageId),
    ["a1"],
  );
});

test("adding again replaces the entry for that email and kind", async () => {
  const h = harness();
  await h.schedule.add(entry("snooze", "m5", h.now(), h.now() + HOUR));
  await h.schedule.add(entry("snooze", "m5", h.now(), h.now() + 2 * HOUR));
  await h.schedule.add(entry("follow-up", "m5", h.now(), h.now() + 3 * HOUR));
  const list = await h.schedule.list();
  assert.deepEqual(
    list.map((item) => [item.kind, item.dueAt - h.now()]),
    [
      ["snooze", 2 * HOUR],
      ["follow-up", 3 * HOUR],
    ],
  );
});

test("a damaged file reads as empty and malformed entries are dropped", () => {
  assert.deepEqual(parseScheduleFile("not json"), { version: 1, accounts: {} });
  assert.deepEqual(parseScheduleFile(JSON.stringify({ version: 2, accounts: {} })), {
    version: 1,
    accounts: {},
  });
  const parsed = parseScheduleFile(
    JSON.stringify({
      version: 1,
      accounts: { a: [entry("snooze", "ok", 1, 2), { kind: "snooze", messageId: 5 }] },
    }),
  );
  assert.deepEqual(
    parsed.accounts.a.map((item) => item.messageId),
    ["ok"],
  );
});
