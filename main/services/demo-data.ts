// Demo mode: fictional data for store screenshots. Enabled only while a `demo-mode` file exists in
// userData, so shipped builds never show it unless someone creates that file by hand.
import { existsSync } from "node:fs";
import * as path from "node:path";

import { app } from "@glaze/core/backend";

import type {
  AccountsStatus,
  CalendarEventItem,
  CalendarListResult,
  MailItem,
  ReminderItem,
  ReviewData,
  SourceResult,
  TaskItem,
} from "../shared-types.js";

export function isDemoMode(): boolean {
  return existsSync(path.join(app.getPath("userData"), "demo-mode"));
}

export function assertNotDemo(channel: string): void {
  if (isDemoMode()) throw new Error(`${channel}: changes are turned off in demo mode.`);
}

function ok<T>(items: T[]): SourceResult<T> {
  return { state: "ok", items, coverage: { complete: true, loaded: items.length } };
}

function day(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function ymd(offset: number): string {
  const date = day(offset);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function at(offset: number, hours: number, minutes = 0): string {
  const date = day(offset);
  date.setHours(hours, minutes);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export const demoAccounts: AccountsStatus = {
  google: {
    hasCredentials: true,
    connected: true,
    email: "alex.rivera@example.com",
    clientIdHint: null,
  },
  reminders: "full-access",
};

export function demoCalendars(): CalendarListResult {
  return {
    calendars: [
      { id: "work", name: "Work", color: "#4285F4", primary: true, defaultVisible: true },
      { id: "personal", name: "Personal", color: "#33B679", primary: false, defaultVisible: true },
      { id: "family", name: "Family", color: "#F6BF26", primary: false, defaultVisible: true },
    ],
    limited: false,
  };
}

const CALENDAR_NAMES: Record<string, [string, string]> = {
  work: ["Work", "#4285F4"],
  personal: ["Personal", "#33B679"],
  family: ["Family", "#F6BF26"],
};

type EventSeed = [
  id: string,
  title: string,
  offset: number,
  start: [number, number] | null,
  end: [number, number] | null,
  calendar: string,
  extra?: Partial<CalendarEventItem>,
];

const EVENT_SEEDS: EventSeed[] = [
  ["e1", "Team standup", 0, [9, 30], [9, 45], "work", { meetLink: "https://meet.google.com/" }],
  [
    "e2",
    "Design review: onboarding flow",
    0,
    [11, 0],
    [12, 0],
    "work",
    {
      location: "Studio B",
      attendees: ["jordan@example.com", "priya@example.com", "sam@example.com"],
      description: "Walk through the new first-run screens and agree on copy.",
    },
  ],
  ["e3", "Lunch with Sam", 0, [12, 30], [13, 30], "personal", { location: "Blue Bottle Café" }],
  [
    "e4",
    "Q4 roadmap sync",
    0,
    [15, 0],
    [16, 0],
    "work",
    { meetLink: "https://meet.google.com/", attendees: ["morgan@example.com"] },
  ],
  ["e5", "Yoga", 0, [18, 30], [19, 30], "personal"],
  ["e6", "Launch week", 0, null, null, "work"],
  ["e7", "Team standup", 1, [9, 30], [9, 45], "work", { meetLink: "https://meet.google.com/" }],
  ["e8", "1:1 with Jordan", 1, [10, 30], [11, 0], "work"],
  ["e9", "Dentist appointment", 1, [14, 0], [15, 0], "personal"],
  ["e10", "Team standup", 2, [9, 30], [9, 45], "work"],
  ["e11", "Customer interview", 2, [13, 0], [14, 0], "work"],
  ["e12", "Mia's soccer game", 2, [17, 0], [18, 30], "family", { location: "Riverside Park" }],
  ["e13", "Sprint planning", 3, [10, 0], [11, 30], "work"],
  ["e14", "Dinner with friends", 3, [19, 0], [21, 0], "personal"],
  ["e15", "Farmers market", 4, [9, 0], [10, 30], "family"],
  ["e16", "Team standup", 6, [9, 30], [9, 45], "work"],
  ["e17", "Quarterly business review", 6, [14, 0], [15, 30], "work"],
  ["e18", "Team standup", -1, [9, 30], [9, 45], "work"],
  ["e19", "Hiring panel", -2, [13, 0], [14, 0], "work"],
  ["e20", "Team offsite planning", -4, [10, 0], [12, 0], "work"],
];

function allEvents(): CalendarEventItem[] {
  return EVENT_SEEDS.map(([id, title, offset, start, end, calendarId, extra]) => {
    const [calendarName, calendarColor] = CALENDAR_NAMES[calendarId];
    return {
      id,
      title,
      start: start ? at(offset, ...start) : ymd(offset),
      end: end ? at(offset, ...end) : ymd(offset + 1),
      allDay: !start,
      location: null,
      description: null,
      htmlLink: null,
      meetLink: null,
      calendarId,
      calendarName,
      calendarColor,
      attendees: [],
      ...extra,
    };
  });
}

function eventTime(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`).getTime()
    : new Date(value).getTime();
}

export function demoEventsBetween(start: Date, end: Date): SourceResult<CalendarEventItem> {
  return ok(
    allEvents().filter(
      (event) => eventTime(event.start) < end.getTime() && eventTime(event.end) > start.getTime(),
    ),
  );
}

export function demoEventsForDays(days: number): SourceResult<CalendarEventItem> {
  return demoEventsBetween(day(0), day(days));
}

export function demoTasks(): SourceResult<TaskItem> {
  const task = (
    id: string,
    title: string,
    due: number | null,
    listTitle = "Work",
    notes: string | null = null,
  ): TaskItem => ({
    id,
    listId: listTitle === "Work" ? "work" : "personal",
    listTitle,
    title,
    notes,
    due: due === null ? null : ymd(due),
    completed: false,
    completedAt: null,
  });
  return ok([
    task("t1", "Finalize launch announcement", 0, "Work", "Share draft with Priya before 3 PM"),
    task("t2", "Review pull request for onboarding", 0),
    task("t3", "Send Q4 budget to finance", -1),
    task("t4", "Prep slides for roadmap sync", 1),
    task("t5", "Book flights for conference", 3, "Personal"),
    task("t6", "Update team wiki", null),
    task("t7", "Read “Shape Up” chapter 4", null, "Personal"),
    task("t8", "Submit expense report", -5),
    task("t9", "Follow up with design agency", -12, "Work", "Ask for revised timeline"),
  ]);
}

export function demoReminders(): SourceResult<ReminderItem> {
  const reminder = (
    ref: string,
    title: string,
    dueDate: number | null,
    dueTime: string | null = null,
    listTitle = "Reminders",
    priority = 0,
  ): ReminderItem => ({
    ref,
    listTitle,
    title,
    notes: null,
    dueDate: dueDate === null ? null : ymd(dueDate),
    dueTime,
    priority,
    completed: false,
    completedAt: null,
  });
  return ok([
    reminder("r1", "Pick up dry cleaning", 0, "17:30"),
    reminder("r2", "Call Mom", 0, "19:00", "Family", 1),
    reminder("r3", "Water the plants", 1),
    reminder("r4", "Renew passport", 5, null, "Errands"),
    reminder("r5", "Groceries: oat milk, berries, bread", null, null, "Errands"),
  ]);
}

const MAIL: MailItem[] = [
  {
    id: "m1",
    threadId: "m1",
    from: "Priya Shah",
    fromEmail: "priya@example.com",
    subject: "Launch announcement — final copy?",
    snippet:
      "Hey Alex, I made a few edits to the headline. Can you take a look before we send it out",
    date: hoursAgo(0.5),
    unread: true,
  },
  {
    id: "m2",
    threadId: "m2",
    from: "Jordan Lee",
    fromEmail: "jordan@example.com",
    subject: "Agenda for tomorrow's 1:1",
    snippet: "A couple of things I'd like to cover: hiring plan, the design system rollout, and",
    date: hoursAgo(2),
    unread: true,
  },
  {
    id: "m3",
    threadId: "m3",
    from: "Finance Team",
    fromEmail: "finance@example.com",
    subject: "Reminder: Q4 budget due Friday",
    snippet: "Please submit your department's Q4 budget in the shared sheet by end of day Friday.",
    date: hoursAgo(5),
    unread: true,
  },
  {
    id: "m4",
    threadId: "m4",
    from: "Morgan Chen",
    fromEmail: "morgan@example.com",
    subject: "Roadmap sync notes",
    snippet: "Attaching the notes from last week. Main open question is the timeline for mobile",
    date: hoursAgo(20),
    unread: false,
  },
  {
    id: "m5",
    threadId: "m5",
    from: "Acme Airlines",
    fromEmail: "no-reply@example.com",
    subject: "Your trip is coming up",
    snippet: "Check in opens 24 hours before departure. Manage your booking anytime in the app.",
    date: hoursAgo(26),
    unread: false,
  },
  {
    id: "m6",
    threadId: "m6",
    from: "Sam Patel",
    fromEmail: "sam@example.com",
    subject: "Lunch today?",
    snippet: "Still good for 12:30? I booked a table at Blue Bottle.",
    date: hoursAgo(30),
    unread: false,
  },
  {
    id: "m7",
    threadId: "m7",
    from: "Design Weekly",
    fromEmail: "newsletter@example.com",
    subject: "10 onboarding patterns worth stealing",
    snippet: "This week: progressive disclosure, empty states that teach, and more.",
    date: hoursAgo(48),
    unread: false,
  },
];

export function demoMail(max: number): SourceResult<MailItem> {
  return ok(MAIL.slice(0, max));
}

export function demoRelatedMail(emails: string[]): SourceResult<MailItem> {
  const wanted = new Set(emails.map((email) => email.toLowerCase()));
  return ok(MAIL.filter((mail) => wanted.has(mail.fromEmail)).slice(0, 3));
}

export function demoMailBody(id: string): string {
  const mail = MAIL.find((item) => item.id === id);
  return mail
    ? `Hi Alex,\n\n${mail.snippet}.\n\nThanks,\n${mail.from}`
    : "This message isn't available in demo mode.";
}

export function demoReview(): ReviewData {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const doneTask = (id: string, title: string, offset: number): TaskItem => ({
    id,
    listId: "work",
    listTitle: "Work",
    title,
    notes: null,
    due: ymd(offset),
    completed: true,
    completedAt: at(offset, 16),
  });
  const doneReminder = (ref: string, title: string, offset: number): ReminderItem => ({
    ref,
    listTitle: "Reminders",
    title,
    notes: null,
    dueDate: ymd(offset),
    dueTime: null,
    priority: 0,
    completed: true,
    completedAt: at(offset, 18),
  });
  return {
    since: since.toISOString(),
    tasks: ok([
      doneTask("d1", "Ship onboarding beta", -1),
      doneTask("d2", "Write hiring rubric", -3),
      doneTask("d3", "Customer interview synthesis", -5),
    ]),
    reminders: ok([
      doneReminder("dr1", "Pay electricity bill", -2),
      doneReminder("dr2", "Schedule car service", -4),
    ]),
    events: demoEventsBetween(since, new Date()),
  };
}
