import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const meetings = await loadTs("shared/meetings.ts");
const now = new Date("2026-10-20T16:00:00.000Z");
const iso = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();

function meeting(id, startMinutes, endMinutes, overrides = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    start: iso(startMinutes),
    end: iso(endMinutes),
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    meetLink: "https://meet.google.com/abc-defg-hij",
    calendarId: "primary",
    calendarName: "Calendar",
    calendarColor: null,
    attendees: ["sam@example.com"],
    primaryCalendar: true,
    selfInvited: true,
    selfResponse: "accepted",
    iCalUID: `${id}@google.com`,
    ...overrides,
  };
}

test("extracts Meet, Zoom, Teams and Webex links", () => {
  const base = { meetLink: null, location: null, description: null };
  assert.equal(
    meetings.extractJoinUrl({ ...base, meetLink: "https://meet.google.com/abc" }),
    "https://meet.google.com/abc",
  );
  assert.equal(
    meetings.extractJoinUrl({ ...base, location: "Zoom https://us02web.zoom.us/j/123?pwd=x" }),
    "https://us02web.zoom.us/j/123?pwd=x",
  );
  assert.equal(
    meetings.extractJoinUrl({
      ...base,
      description: "Join: https://teams.microsoft.com/l/meetup-join/19%3a abc",
    }),
    "https://teams.microsoft.com/l/meetup-join/19%3a",
  );
  assert.equal(
    meetings.extractJoinUrl({ ...base, description: "https://acme.webex.com/meet/sam." }),
    "https://acme.webex.com/meet/sam",
  );
});

test("ignores http and lookalike hosts", () => {
  const base = { meetLink: null, location: null };
  assert.equal(meetings.extractJoinUrl({ ...base, description: "http://zoom.us/j/1" }), null);
  assert.equal(
    meetings.extractJoinUrl({ ...base, description: "https://zoom.us.evil.example/j/1" }),
    null,
  );
  assert.equal(meetings.extractJoinUrl({ ...base, description: "https://notzoom.us/j/1" }), null);
});

test("treats primary-calendar events and invited events as mine", () => {
  assert.equal(meetings.isMine(meeting("a", 10, 40)), true);
  assert.equal(
    meetings.isMine(meeting("b", 10, 40, { primaryCalendar: false, selfInvited: true })),
    true,
  );
});

test("ignores colleagues' meetings on shared calendars", () => {
  const shared = meeting("c", 10, 40, {
    calendarId: "team@group.calendar.google.com",
    primaryCalendar: false,
    selfInvited: false,
  });
  assert.equal(meetings.isMine(shared), false);
  assert.equal(meetings.pickUpNext([shared], now), null);
});

test("treats invitations on the legacy primary fallback calendar as mine", () => {
  const legacy = meeting("d", 10, 40, { primaryCalendar: undefined, selfInvited: undefined });
  assert.equal(meetings.isMine(legacy), true);
});

test("skips declined and all-day events", () => {
  assert.equal(meetings.isMeeting(meeting("e", 10, 40, { selfResponse: "declined" })), false);
  assert.equal(meetings.isMeeting(meeting("f", 10, 40, { allDay: true })), false);
  assert.equal(
    meetings.isMeeting(meeting("g", 10, 40, { meetLink: null, attendees: [] })),
    false,
    "a solo block with no link is not a meeting",
  );
});

test("dedupes the same meeting across calendars", () => {
  const primary = meeting("h", 10, 40);
  const copy = {
    ...primary,
    id: "h-copy",
    calendarId: "team@group.calendar.google.com",
    primaryCalendar: false,
  };
  const result = meetings.dedupeMeetings([copy, primary]);
  assert.equal(result.length, 1);
  assert.equal(result[0].calendarId, "primary");
});

test("keeps every occurrence of a recurring meeting", () => {
  const monday = meeting("r1", 10, 40, { iCalUID: "series@google.com" });
  const tuesday = meeting("r2", 24 * 60 + 10, 24 * 60 + 40, { iCalUID: "series@google.com" });
  assert.equal(meetings.dedupeMeetings([monday, tuesday]).length, 2);
});

test("picks the in-progress meeting first", () => {
  const result = meetings.pickUpNext([meeting("next", 5, 35), meeting("now", -10, 20)], now);
  assert.equal(result.event.id, "now");
  assert.equal(result.phase, "now");
  assert.equal(result.minutesLeft, 20);
  assert.equal(result.joinUrl, "https://meet.google.com/abc-defg-hij");
});

test("labels phases and minutes", () => {
  const soon = meetings.pickUpNext([meeting("s", 5, 35)], now);
  assert.equal(soon.phase, "soon");
  assert.equal(meetings.startLabel(soon), "Starts in 5 min");
  const later = meetings.pickUpNext([meeting("l", 70, 100)], now);
  assert.equal(later.phase, "later");
  assert.equal(meetings.startLabel(later), "Starts in 1 hr 10 min");
  const current = meetings.pickUpNext([meeting("c", -5, 20)], now);
  assert.equal(meetings.startLabel(current), "Now · ends in 20 min");
  assert.equal(meetings.pickUpNext([meeting("far", 13 * 60, 14 * 60)], now), null);
});

test("finds the meeting that just ended", () => {
  const result = meetings.justEnded(
    [meeting("old", -300, -240), meeting("recent", -60, -10), meeting("live", -5, 25)],
    now,
  );
  assert.equal(result.id, "recent");
});

test("schedules the next alert once per event start", () => {
  const events = [meeting("a1", 30, 60), meeting("a2", 10, 40)];
  const first = meetings.nextAlert(events, now, 2, new Set());
  assert.equal(first.event.id, "a2");
  assert.equal(first.at.getTime(), now.getTime() + 8 * 60_000);
  const second = meetings.nextAlert(events, now, 2, new Set([first.key]));
  assert.equal(second.event.id, "a1");
});

test("fires immediately when the alert time has passed but the meeting has not started", () => {
  const alert = meetings.nextAlert([meeting("x", 1, 30)], now, 5, new Set());
  assert.equal(alert.at.getTime(), now.getTime());
  assert.equal(meetings.nextAlert([meeting("y", -1, 30)], now, 5, new Set()), null);
});

test("a declined meeting stays hidden through its shared-calendar copy", () => {
  const declined = meeting("p", 10, 40, { selfResponse: "declined", iCalUID: "dup@google.com" });
  const shared = {
    ...declined,
    id: "p-shared",
    calendarId: "team@group.calendar.google.com",
    primaryCalendar: false,
    selfInvited: true,
    selfResponse: null,
  };
  assert.equal(meetings.pickUpNext([shared, declined], now), null);
  assert.equal(meetings.nextAlert([shared, declined], now, 2, new Set()), null);
});
