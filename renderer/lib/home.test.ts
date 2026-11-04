import assert from "node:assert/strict";
import test from "node:test";
import type { MailItem } from "@main/shared-types";

import {
  ageLabel,
  firstName,
  greeting,
  homeSummary,
  homeTodos,
  needsYou,
  suggestedTasks,
} from "./home";
import type { Todo } from "./todos";
import type { TriageMap } from "./triage-types";

const NOW = Date.parse("2026-11-04T18:00:00Z");
const HOUR = 3_600_000;

function mail(id: string, hoursAgo: number, unread = false): MailItem {
  return {
    id,
    threadId: id,
    from: `Sender ${id}`,
    fromEmail: `${id}@example.com`,
    subject: `Subject ${id}`,
    snippet: "",
    date: new Date(NOW - hoursAgo * HOUR).toISOString(),
    unread,
  };
}

function todo(key: string, dueDate: string | null, completed = false): Todo {
  return {
    key,
    source: "tasks",
    title: key,
    notes: null,
    dueDate,
    dueTime: null,
    listTitle: "My Tasks",
    completed,
    completedAt: null,
  };
}

test("needs reply and unread untriaged mail wait on you; FYI and read mail don't", () => {
  const triage: TriageMap = {
    a: { category: "needs-reply", reason: "Asks for a decision", task: "" },
    b: { category: "fyi", reason: "", task: "" },
    c: { category: "needs-reply", reason: "  ", task: "" },
  };
  const items = needsYou({
    messages: [mail("a", 2), mail("b", 1, true), mail("c", 3), mail("d", 4, true), mail("e", 5)],
    triage,
    now: NOW,
  });
  assert.deepEqual(
    items.map((item) => [item.key, item.kind, item.chip]),
    [
      ["mail:a", "reply", "Asks for a decision"],
      ["mail:c", "reply", "Needs reply"],
      ["mail:d", "unread", "Unread"],
    ],
  );
});

test("mail waiting over a day comes first, oldest first; the rest newest first", () => {
  const items = needsYou({
    messages: [
      mail("fresh-old", 20, true),
      mail("stale", 30, true),
      mail("staler", 50, true),
      mail("fresh", 2, true),
    ],
    triage: {},
    now: NOW,
  });
  assert.deepEqual(
    items.map((item) => item.mail.id),
    ["staler", "stale", "fresh", "fresh-old"],
  );
});

test("a follow-up replaces the same email's other entry", () => {
  const message = mail("a", 80, true);
  const items = needsYou({
    messages: [message],
    triage: {},
    now: NOW,
    followUps: [{ mail: message, since: NOW - 72 * HOUR, days: 3 }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "follow-up");
  assert.equal(items[0].chip, "No reply in 3 days");
});

test("ages read like HeroSpace's chips", () => {
  assert.equal(ageLabel(NOW - 10_000, NOW), "Just now");
  assert.equal(ageLabel(NOW - 12 * 60_000, NOW), "12m");
  assert.equal(ageLabel(NOW - 3 * HOUR, NOW), "3h");
  assert.equal(ageLabel(NOW - 25 * HOUR, NOW), "1 day");
  assert.equal(ageLabel(NOW - 50 * HOUR, NOW), "2 days");
  assert.equal(ageLabel(NOW + HOUR, NOW), "Just now");
});

test("suggested tasks skip handled and taskless mail", () => {
  const triage: TriageMap = {
    a: { category: "fyi", reason: "", task: "Submit the budget" },
    b: { category: "needs-reply", reason: "", task: "Review copy" },
    c: { category: "ignore", reason: "", task: "" },
  };
  const tasks = suggestedTasks({
    messages: [mail("a", 1), mail("b", 2), mail("c", 3)],
    triage,
    handled: ["suggest:b"],
  });
  assert.deepEqual(
    tasks.map((task) => [task.key, task.title]),
    [["suggest:a", "Submit the budget"]],
  );
});

test("Home's tasks are overdue and today's, or the next 7 days'", () => {
  const todos = [
    todo("late", "2026-11-01"),
    todo("today", "2026-11-04"),
    todo("sunday", "2026-11-08"),
    todo("next", "2026-11-11"),
    todo("undated", null),
    todo("done", "2026-11-04", true),
  ];
  assert.deepEqual(
    homeTodos(todos, "2026-11-04", "today").map((item) => item.key),
    ["late", "today"],
  );
  assert.deepEqual(
    homeTodos(todos, "2026-11-04", "week").map((item) => item.key),
    ["late", "today", "sunday"],
  );
});

test("greetings follow the time of day", () => {
  assert.equal(greeting(3), "Good evening");
  assert.equal(greeting(8), "Good morning");
  assert.equal(greeting(13), "Good afternoon");
  assert.equal(greeting(20), "Good evening");
  assert.equal(firstName("  Miles Chu "), "Miles");
});

test("the summary lists what waits, what's suggested and the meetings", () => {
  assert.equal(
    homeSummary({ waiting: 3, suggested: 2, meetings: 6, span: "today" }),
    "3 waiting on you, 2 suggested tasks and 6 meetings today.",
  );
  assert.equal(
    homeSummary({ waiting: 1, suggested: 0, meetings: 1, span: "week" }),
    "1 waiting on you and 1 meeting this week.",
  );
});
