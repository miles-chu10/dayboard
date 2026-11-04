export interface SnoozeOption {
  label: string;
  until: Date;
}

function at(base: Date, dayOffset: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
}

/**
 * HeroSpace's snooze choices for `now`: later today (3 hours on, on the hour, before 9 PM),
 * tomorrow at 8 AM, this (or next) weekend at 9 AM, and next Monday at 8 AM.
 */
export function snoozeOptions(now: Date): SnoozeOption[] {
  const options: SnoozeOption[] = [];
  const later = new Date(now.getTime() + 3 * 3_600_000);
  later.setMinutes(later.getMinutes() > 0 ? 60 : 0, 0, 0);
  if (later.getDate() === now.getDate() && later.getHours() < 21)
    options.push({ label: "Later today", until: later });
  options.push({ label: "Tomorrow", until: at(now, 1, 8) });
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  const toSaturday = (6 - day + 7) % 7 || 7;
  options.push({
    label: day === 0 || day === 6 ? "Next weekend" : "This weekend",
    until: at(now, day === 0 ? 6 : toSaturday, 9),
  });
  const toMonday = (1 - day + 7) % 7 || 7;
  options.push({ label: "Next week", until: at(now, toMonday, 8) });
  // Keep each choice once (on a Sunday, next Monday is also tomorrow).
  return options.filter(
    (option, index) =>
      option.until > now &&
      options.findIndex((other) => other.until.getTime() === option.until.getTime()) === index,
  );
}

export function formatSnoozeTime(until: Date, now: Date): string {
  const sameDay = until.toDateString() === now.toDateString();
  const time = until.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${until.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export const FOLLOW_UP_CHOICES = [1, 2, 3, 5, 7] as const;
