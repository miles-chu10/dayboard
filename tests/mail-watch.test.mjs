import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { badgeText, dueNotice, newMailNotices, newUnread } = await loadTs(
  "main/services/mail-watch.ts",
);

const mail = (id, unread = true, from = `Sender ${id}`) => ({
  id,
  threadId: id,
  from,
  fromEmail: `${id}@example.com`,
  subject: `Subject ${id}`,
  snippet: "",
  date: new Date().toISOString(),
  unread,
});

test("the first check only remembers the inbox; later checks report new unread mail", () => {
  const first = newUnread(null, [mail("a"), mail("b")]);
  assert.deepEqual(first.fresh, []);
  const second = newUnread(first.seen, [mail("a"), mail("b"), mail("c"), mail("d", false)]);
  assert.deepEqual(
    second.fresh.map((item) => item.id),
    ["c"],
  );
  // Mail that left and came back (unsnoozed) counts as new.
  const third = newUnread(newUnread(second.seen, [mail("a")]).seen, [mail("a"), mail("b")]);
  assert.deepEqual(
    third.fresh.map((item) => item.id),
    ["b"],
  );
});

test("up to three emails notify one by one; more become one summary", () => {
  assert.deepEqual(newMailNotices([mail("a", true, "Priya")]), [
    { title: "Priya", body: "Subject a", to: "/mail" },
  ]);
  const summary = newMailNotices([
    mail("a", true, "Priya"),
    mail("b", true, "Sam"),
    mail("c", true, "Priya"),
    mail("d", true, "Jordan"),
    mail("e", true, "Morgan"),
  ]);
  assert.deepEqual(summary, [
    { title: "5 new emails", body: "From Priya, Sam, Jordan and others", to: "/mail" },
  ]);
  assert.deepEqual(newMailNotices([]), []);
});

test("snoozes and unanswered follow-ups say what came due", () => {
  const base = {
    messageId: "m",
    threadId: "t",
    subject: "Lunch today?",
    from: "Sam Patel",
    fromEmail: "sam@example.com",
    createdAt: 0,
  };
  assert.deepEqual(dueNotice({ ...base, kind: "snooze", dueAt: 1 }), {
    title: "Back from snooze",
    body: "Sam Patel: Lunch today?",
    to: "/mail",
  });
  assert.deepEqual(dueNotice({ ...base, kind: "follow-up", dueAt: 3 * 86_400_000 }), {
    title: "No reply from Sam Patel in 3 days",
    body: "Lunch today?",
    to: "/",
  });
});

test("the Dock badge hides at zero and caps at 99+", () => {
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(-2), "");
  assert.equal(badgeText(Number.NaN), "");
  assert.equal(badgeText(7), "7");
  assert.equal(badgeText(120), "99+");
});
