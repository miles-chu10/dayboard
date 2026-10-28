// Which calendar events are Miles's meetings, which one is next, and when to alert. Pure, so the
// Glaze port and the main-process alert scheduler share it.

export interface MeetingEvent {
  id: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  meetLink: string | null;
  calendarId: string;
  attendees: string[];
  /** The event sits on Google's primary calendar for the connected account. */
  primaryCalendar?: boolean;
  /** The connected account organizes or is invited to this event. */
  selfInvited?: boolean;
  selfResponse?: "accepted" | "declined" | "tentative" | "needsAction" | null;
  iCalUID?: string;
}

export interface UpNext<T extends MeetingEvent = MeetingEvent> {
  event: T;
  joinUrl: string | null;
  phase: "now" | "soon" | "later";
  minutesUntil: number;
  minutesLeft: number;
}

const JOIN_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "whereby.com",
];
const SOON_MINUTES = 15;
const LOOKAHEAD_MS = 12 * 3_600_000;
const JUST_ENDED_MS = 3 * 3_600_000;

// shared/ is linted without browser or Node globals, so URL comes from globalThis.
type WebUrl = InstanceType<typeof globalThis.URL>;

function joinHost(url: WebUrl): boolean {
  const host = url.hostname.toLowerCase();
  return JOIN_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function httpsUrl(value: string): WebUrl | null {
  try {
    const url = new globalThis.URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** The video link: Google's own conference link first, then a known provider's link in the text. */
export function extractJoinUrl(
  event: Pick<MeetingEvent, "meetLink" | "location" | "description">,
): string | null {
  if (event.meetLink && httpsUrl(event.meetLink)) return event.meetLink;
  for (const text of [event.location, event.description]) {
    for (const match of text?.matchAll(/https:\/\/[^\s<>"']+/g) ?? []) {
      const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
      const url = httpsUrl(candidate);
      if (url && joinHost(url)) return candidate;
    }
  }
  return null;
}

export function isMine(event: MeetingEvent): boolean {
  return (
    (event.primaryCalendar ?? event.calendarId === "primary") ||
    event.selfInvited === true
  );
}

export function isMeeting(event: MeetingEvent): boolean {
  if (event.allDay || !isMine(event) || event.selfResponse === "declined")
    return false;
  return extractJoinUrl(event) !== null || event.attendees.length > 0;
}

/** One occurrence of one meeting, across the calendars it appears on. */
export function meetingKey(event: MeetingEvent): string {
  return event.iCalUID
    ? `${event.iCalUID}@${event.start}`
    : `${event.calendarId}/${event.id}@${event.start}`;
}

export function dedupeMeetings<T extends MeetingEvent>(events: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const key = meetingKey(event);
    const existing = byKey.get(key);
    if (!existing || (!existing.primaryCalendar && event.primaryCalendar))
      byKey.set(key, event);
  }
  return [...byKey.values()];
}

const time = (iso: string) => new Date(iso).getTime();
const minutes = (ms: number) => Math.ceil(ms / 60_000);

// De-duplicate before filtering, so a declined primary copy also hides its shared-calendar copies.
function meetingsOf<T extends MeetingEvent>(events: T[]): T[] {
  return dedupeMeetings(events)
    .filter(isMeeting)
    .sort((a, b) => time(a.start) - time(b.start));
}

/** The meeting in progress (the most recently started), else the next one within 12 hours. */
export function pickUpNext<T extends MeetingEvent>(
  events: T[],
  now: Date,
): UpNext<T> | null {
  const at = now.getTime();
  const all = meetingsOf(events);
  const inProgress = all.filter(
    (event) => time(event.start) <= at && at < time(event.end),
  );
  const current = inProgress[inProgress.length - 1];
  const event =
    current ??
    all.find(
      (event) =>
        time(event.start) > at && time(event.start) - at <= LOOKAHEAD_MS,
    );
  if (!event) return null;
  const until = minutes(time(event.start) - at);
  return {
    event,
    joinUrl: extractJoinUrl(event),
    phase: current ? "now" : until <= SOON_MINUTES ? "soon" : "later",
    minutesUntil: current ? 0 : until,
    minutesLeft: minutes(time(event.end) - at),
  };
}

/** The most recent meeting that ended within the last three hours, for the notes offer. */
export function justEnded<T extends MeetingEvent>(
  events: T[],
  now: Date,
): T | null {
  const at = now.getTime();
  return (
    meetingsOf(events)
      .filter(
        (event) =>
          time(event.end) <= at && at - time(event.end) <= JUST_ENDED_MS,
      )
      .sort((a, b) => time(b.end) - time(a.end))[0] ?? null
  );
}

/** The next alert not yet sent; one whose alert time has passed before the start fires now. */
export function nextAlert<T extends MeetingEvent>(
  events: T[],
  now: Date,
  minutesBefore: number,
  sent: ReadonlySet<string>,
): { at: Date; key: string; event: T } | null {
  const at = now.getTime();
  let best: { at: Date; key: string; event: T } | null = null;
  for (const event of meetingsOf(events)) {
    if (time(event.start) <= at) continue;
    const key = meetingKey(event);
    if (sent.has(key)) continue;
    const alertAt = new Date(
      Math.max(time(event.start) - minutesBefore * 60_000, at),
    );
    if (!best || alertAt < best.at) best = { at: alertAt, key, event };
  }
  return best;
}

function duration(total: number): string {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function startLabel(upNext: UpNext): string {
  return upNext.phase === "now"
    ? `Now · ends in ${duration(upNext.minutesLeft)}`
    : `Starts in ${duration(upNext.minutesUntil)}`;
}
