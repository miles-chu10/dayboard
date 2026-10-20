// Schedules one timer for the next "meeting starts soon" alert. Electron-free: the caller supplies
// the events (null when the Calendar source is off or Google isn't connected), the notifier and
// the clock, and refreshes on its own schedule and on settings or account changes.

import { extractJoinUrl, nextAlert, type MeetingEvent } from "../../../shared/meetings.js";

export interface MeetingAlert {
  title: string;
  body: string;
  joinUrl: string | null;
}

export interface MeetingAlertDeps {
  listEvents(): Promise<MeetingEvent[] | null>;
  notify(alert: MeetingAlert): void;
  /** Starts a timer and returns its cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
  now(): Date;
}

export function createMeetingAlerts(deps: MeetingAlertDeps) {
  let config = { notify: false, notifyMinutesBefore: 2 };
  let events: MeetingEvent[] = [];
  let generation = 0;
  let cancel: (() => void) | null = null;
  const sent = new Set<string>();

  function clear(): void {
    cancel?.();
    cancel = null;
  }

  function schedule(): void {
    clear();
    if (!config.notify) return;
    const now = deps.now();
    const alert = nextAlert(events, now, config.notifyMinutesBefore, sent);
    if (!alert) return;
    cancel = deps.setTimer(
      () => {
        cancel = null;
        sent.add(alert.key);
        const minutes = Math.ceil(
          (new Date(alert.event.start).getTime() - deps.now().getTime()) / 60_000,
        );
        deps.notify({
          title: alert.event.title,
          body: minutes > 0 ? `Starts in ${minutes} min` : "Starting now",
          joinUrl: extractJoinUrl(alert.event),
        });
        schedule();
      },
      Math.max(0, alert.at.getTime() - now.getTime()),
    );
  }

  async function refresh(): Promise<void> {
    const current = ++generation;
    if (!config.notify) {
      clear();
      return;
    }
    const listed = await deps.listEvents();
    // A slower fetch that started before a newer refresh must not replace its result.
    if (current !== generation) return;
    events = listed ?? [];
    schedule();
  }

  return {
    configure(next: { notify: boolean; notifyMinutesBefore: number }): Promise<void> {
      config = { notify: next.notify, notifyMinutesBefore: next.notifyMinutesBefore };
      return refresh();
    },
    refresh,
    stop(): void {
      generation++;
      clear();
    },
  };
}
