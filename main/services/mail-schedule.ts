/**
 * Snoozed emails and "remind me if no reply" follow-ups, kept per account scope in one JSON file.
 * Electron-free: Gmail, storage, the clock and timers are injected so tests drive it directly.
 */

export type MailScheduleKind = "snooze" | "follow-up";

export interface MailScheduleEntry {
  kind: MailScheduleKind;
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  createdAt: number;
  dueAt: number;
  /** Follow-ups only: nobody replied by `dueAt`; it waits on the user until a reply or dismissal. */
  due?: boolean;
}

interface StoreFile {
  version: 1;
  accounts: Record<string, MailScheduleEntry[]>;
}

const MAX_ENTRIES = 500;
/** Check at least hourly, so a sleeping Mac or a clock change can't strand an entry. */
const MAX_WAIT = 60 * 60 * 1000;

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

function isEntry(value: unknown): value is MailScheduleEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.kind === "snooze" || entry.kind === "follow-up") &&
    ["messageId", "threadId", "subject", "from", "fromEmail"].every(
      (key) => typeof entry[key] === "string",
    ) &&
    Number.isFinite(entry.createdAt) &&
    Number.isFinite(entry.dueAt)
  );
}

export function parseScheduleFile(text: string | null): StoreFile {
  try {
    const value = text ? (JSON.parse(text) as Partial<StoreFile>) : null;
    if (!value || value.version !== 1 || typeof value.accounts !== "object" || !value.accounts)
      return { version: 1, accounts: {} };
    const accounts: StoreFile["accounts"] = {};
    for (const [scope, entries] of Object.entries(value.accounts))
      if (Array.isArray(entries)) accounts[scope] = entries.filter(isEntry).slice(-MAX_ENTRIES);
    return { version: 1, accounts };
  } catch {
    return { version: 1, accounts: {} };
  }
}

export function createMailSchedule(deps: {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
  scope: () => Promise<string>;
  now: () => number;
  /** Puts a snoozed email back in the inbox, unread. */
  unsnooze: (entry: MailScheduleEntry) => Promise<void>;
  /** True when someone else wrote in the thread after the follow-up was set. */
  hasReply: (entry: MailScheduleEntry) => Promise<boolean>;
  onChange: () => void;
  /** A snoozed email came back, or a follow-up got no reply in time. */
  onDue?: (entry: MailScheduleEntry) => void;
  timers?: Timers;
}) {
  const timers: Timers = deps.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let file: StoreFile | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let handle: unknown;
  let running = false;

  // Every read-modify-write runs in order, so a check and a user action can't interleave.
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  }

  async function load(): Promise<StoreFile> {
    file ??= parseScheduleFile(await deps.read());
    return file;
  }

  async function save(): Promise<void> {
    if (file) await deps.write(JSON.stringify(file));
  }

  async function entries(): Promise<MailScheduleEntry[]> {
    const store = await load();
    return (store.accounts[await deps.scope()] ??= []);
  }

  function reschedule(list: MailScheduleEntry[]) {
    timers.clearTimeout(handle);
    handle = undefined;
    if (!running) return;
    const waiting = list.filter((entry) => !entry.due).map((entry) => entry.dueAt);
    const hasDue = list.some((entry) => entry.due);
    if (!waiting.length && !hasDue) return;
    const wait = waiting.length ? Math.min(...waiting) - deps.now() : MAX_WAIT;
    handle = timers.setTimeout(
      () => void check().catch(() => undefined),
      Math.min(MAX_WAIT, Math.max(1000, wait)),
    );
  }

  async function check(): Promise<void> {
    const changed = await serial(async () => {
      const list = await entries();
      const now = deps.now();
      let dirty = false;
      for (const entry of [...list]) {
        if (entry.kind === "snooze") {
          if (entry.dueAt > now) continue;
          try {
            await deps.unsnooze(entry);
          } catch {
            continue; // Offline or signed out: try again at the next check.
          }
          list.splice(list.indexOf(entry), 1);
          dirty = true;
          deps.onDue?.(entry);
        } else if (entry.dueAt <= now) {
          let replied: boolean;
          try {
            replied = await deps.hasReply(entry);
          } catch {
            continue;
          }
          if (replied) {
            list.splice(list.indexOf(entry), 1);
            dirty = true;
          } else if (!entry.due) {
            entry.due = true;
            dirty = true;
            deps.onDue?.(entry);
          }
        }
      }
      if (dirty) await save();
      reschedule(list);
      return dirty;
    });
    if (changed) deps.onChange();
  }

  return {
    list: () => serial(async () => [...(await entries())]),

    /** Adds or replaces the entry for this message and kind. */
    async add(entry: MailScheduleEntry): Promise<void> {
      await serial(async () => {
        const list = await entries();
        const index = list.findIndex(
          (item) => item.kind === entry.kind && item.messageId === entry.messageId,
        );
        if (index >= 0) list.splice(index, 1);
        list.push(entry);
        if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
        await save();
        reschedule(list);
      });
      deps.onChange();
    },

    async remove(kind: MailScheduleKind, messageId: string): Promise<MailScheduleEntry | null> {
      const removed = await serial(async () => {
        const list = await entries();
        const index = list.findIndex((item) => item.kind === kind && item.messageId === messageId);
        if (index < 0) return null;
        const [entry] = list.splice(index, 1);
        await save();
        reschedule(list);
        return entry;
      });
      if (removed) deps.onChange();
      return removed;
    },

    check,

    /** Starts timers and catches up on anything that came due while DayBoard was closed. */
    start(): Promise<void> {
      running = true;
      return check();
    },

    stop(): void {
      running = false;
      timers.clearTimeout(handle);
      handle = undefined;
    },

    /** Forget the cached file, e.g. after the account changes; the next call rereads it. */
    async reload(): Promise<void> {
      await serial(async () => {
        file = null;
      });
      if (running) await check();
    },

    drain: () => serial(async () => undefined),
  };
}
