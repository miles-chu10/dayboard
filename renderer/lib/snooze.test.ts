import assert from "node:assert/strict";
import test from "node:test";

import { snoozeOptions } from "./snooze";

function local(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(year, month - 1, day, hour, minute);
}

const summary = (now: Date) =>
  snoozeOptions(now).map(({ label, until }) => [
    label,
    `${until.getMonth() + 1}/${until.getDate()} ${until.getHours()}:${String(until.getMinutes()).padStart(2, "0")}`,
  ]);

test("a weekday morning offers later today, tomorrow, the weekend and next week", () => {
  // Wednesday, November 4, 2026, 9:20 AM.
  assert.deepEqual(summary(local(2026, 11, 4, 9, 20)), [
    ["Later today", "11/4 13:00"],
    ["Tomorrow", "11/5 8:00"],
    ["This weekend", "11/7 9:00"],
    ["Next week", "11/9 8:00"],
  ]);
});

test("an exact hour stays on the hour", () => {
  assert.deepEqual(summary(local(2026, 11, 4, 9))[0], ["Later today", "11/4 12:00"]);
});

test("late evenings drop 'later today'", () => {
  const labels = summary(local(2026, 11, 4, 19)).map(([label]) => label);
  assert.deepEqual(labels, ["Tomorrow", "This weekend", "Next week"]);
});

test("on a Saturday the weekend choice is next weekend", () => {
  assert.deepEqual(summary(local(2026, 11, 7, 10)), [
    ["Later today", "11/7 13:00"],
    ["Tomorrow", "11/8 8:00"],
    ["Next weekend", "11/14 9:00"],
    ["Next week", "11/9 8:00"],
  ]);
});

test("on a Sunday tomorrow is Monday, so it isn't offered twice", () => {
  const options = summary(local(2026, 11, 8, 20));
  assert.deepEqual(options, [
    ["Tomorrow", "11/9 8:00"],
    ["Next weekend", "11/14 9:00"],
  ]);
});
