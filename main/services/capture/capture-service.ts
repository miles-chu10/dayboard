// Quick Capture's pipeline: parse with AI (or take Miles's manual draft), create in the right
// source under the account that was active at submission, and keep a short-lived Undo receipt.
// Electron-free: handlers inject the providers, the AI runner and the write guard.

import {
  CAPTURE_SYSTEM,
  aiCaptureEnabled,
  availableKinds,
  buildCapturePrompt,
  normalizeDraft,
  parseDraftStrict,
  type ItemDraft,
  type ItemKind,
} from "../../../shared/capture.js";

export type CaptureSubmit = { text: string } | { draft: unknown };

export interface CaptureRecord {
  id: string;
  text: string;
  draft: ItemDraft | null;
  /** Cleanly parsed fields to prefill the manual form after an unclear parse. */
  partial: Partial<ItemDraft> | null;
  state: "processing" | "created" | "undone" | "failed";
  error: string | null;
  createdAt: string;
  canUndo: boolean;
}

interface CaptureSettings {
  ai: { enabled: boolean; features: { capture: boolean } };
  sources: Record<"tasks" | "reminders" | "calendar", { enabled: boolean }>;
}

type TaskRef = { listId: string; taskId: string };
type ReminderRef = { ref: string };
type EventRef = { calendarId: string; eventId: string };

export interface CaptureDeps {
  isDemoMode(): boolean;
  currentScope(): Promise<string>;
  /** Runs a provider write only while `scope` is still the active account. */
  guardedWrite<T>(scope: string, write: () => Promise<T>): Promise<T>;
  getSettings(): Promise<CaptureSettings>;
  getAccounts(): Promise<{ google: { connected: boolean }; reminders: string }>;
  complete(system: string, prompt: string): Promise<string>;
  create: {
    task(draft: ItemDraft): Promise<TaskRef>;
    reminder(draft: ItemDraft): Promise<ReminderRef>;
    event(draft: ItemDraft): Promise<EventRef>;
  };
  remove: {
    task(ref: TaskRef): Promise<void>;
    reminder(ref: string): Promise<void>;
    event(ref: EventRef): Promise<void>;
  };
  onChange(records: CaptureRecord[]): void;
  onCreated(record: CaptureRecord): void;
  onFailed(record: CaptureRecord): void;
  now(): Date;
  newId(): string;
}

type Receipt =
  | { kind: "task"; scope: string; expires: number; ref: TaskRef }
  | { kind: "reminder"; scope: string; expires: number; ref: string }
  | { kind: "event"; scope: string; expires: number; ref: EventRef };

const MAX_RECORDS = 5;
const MAX_TEXT = 1_000;
const UNDO_MS = 10 * 60_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCaptureService(deps: CaptureDeps) {
  const records: CaptureRecord[] = [];
  const receipts = new Map<string, Receipt>();
  const undoing = new Map<string, Promise<CaptureRecord>>();

  const snapshot = (record: CaptureRecord): CaptureRecord => ({ ...record });
  const recent = () => records.map(snapshot);
  const changed = () => deps.onChange(recent());

  function track(record: CaptureRecord): void {
    records.unshift(record);
    for (const dropped of records.splice(MAX_RECORDS)) receipts.delete(dropped.id);
    changed();
  }

  function fail(record: CaptureRecord, error: string, partial: Partial<ItemDraft> | null) {
    Object.assign(record, { state: "failed", error, partial, canUndo: false });
    changed();
    deps.onFailed(snapshot(record));
    return snapshot(record);
  }

  async function create(kind: ItemKind, scope: string, draft: ItemDraft): Promise<Receipt> {
    const expires = deps.now().getTime() + UNDO_MS;
    if (kind === "task")
      return {
        kind,
        scope,
        expires,
        ref: await deps.guardedWrite(scope, () => deps.create.task(draft)),
      };
    if (kind === "event")
      return {
        kind,
        scope,
        expires,
        ref: await deps.guardedWrite(scope, () => deps.create.event(draft)),
      };
    const { ref } = await deps.guardedWrite(scope, () => deps.create.reminder(draft));
    return { kind, scope, expires, ref };
  }

  async function submit(input: CaptureSubmit): Promise<CaptureRecord> {
    if (deps.isDemoMode()) throw new Error("Quick Capture is turned off in demo mode.");
    const text = "text" in input && typeof input.text === "string" ? input.text.trim() : "";
    if ("text" in input && (!text || text.length > MAX_TEXT))
      throw new Error("Type what to add, in up to 1,000 characters.");
    const scope = await deps.currentScope();
    const [settings, accounts] = await Promise.all([deps.getSettings(), deps.getAccounts()]);
    const available = availableKinds({
      googleConnected: accounts.google.connected,
      remindersAccess: accounts.reminders,
      sources: settings.sources,
    });
    const record: CaptureRecord = {
      id: deps.newId(),
      text,
      draft: null,
      partial: null,
      state: "processing",
      error: null,
      createdAt: deps.now().toISOString(),
      canUndo: false,
    };
    track(record);

    let draft: ItemDraft;
    if ("draft" in input) {
      const normalized = normalizeDraft(input.draft, available);
      if ("error" in normalized) return fail(record, normalized.error, null);
      draft = normalized;
      record.text = draft.title;
    } else {
      if (!aiCaptureEnabled(settings))
        return fail(record, "Fill in the details, then add it.", { title: text });
      let output: string;
      try {
        output = await deps.complete(
          CAPTURE_SYSTEM,
          buildCapturePrompt(text, available, deps.now()),
        );
      } catch (error) {
        return fail(record, message(error), { title: text });
      }
      const parsed = parseDraftStrict(output, available);
      if (!parsed.ok)
        return fail(record, `${parsed.reason} Check the details, then add it.`, {
          title: text,
          ...parsed.partial,
        });
      draft = parsed.draft;
    }

    try {
      receipts.set(record.id, await create(draft.kind, scope, draft));
    } catch (error) {
      return fail(record, message(error), draft);
    }
    Object.assign(record, { state: "created", draft, canUndo: true, error: null });
    changed();
    deps.onCreated(snapshot(record));
    return snapshot(record);
  }

  async function performUndo(record: CaptureRecord): Promise<CaptureRecord> {
    const receipt = receipts.get(record.id);
    if (!receipt || deps.now().getTime() > receipt.expires) {
      receipts.delete(record.id);
      record.canUndo = false;
      changed();
      throw new Error("Undo is no longer available for this item.");
    }
    // One delete attempt per capture: the receipt is spent before the provider is called, so a
    // failed Undo (e.g. the item was already removed elsewhere) can never delete twice.
    receipts.delete(record.id);
    record.canUndo = false;
    try {
      if (receipt.kind === "task")
        await deps.guardedWrite(receipt.scope, () => deps.remove.task(receipt.ref));
      else if (receipt.kind === "event")
        await deps.guardedWrite(receipt.scope, () => deps.remove.event(receipt.ref));
      else await deps.guardedWrite(receipt.scope, () => deps.remove.reminder(receipt.ref));
    } catch (error) {
      record.error = message(error);
      changed();
      throw error;
    }
    Object.assign(record, { state: "undone", canUndo: false, error: null });
    changed();
    return snapshot(record);
  }

  async function undo(id: string): Promise<CaptureRecord> {
    if (deps.isDemoMode()) throw new Error("Quick Capture is turned off in demo mode.");
    const record = records.find((candidate) => candidate.id === id);
    if (!record) throw new Error("That capture is no longer available.");
    if (record.state === "undone") return snapshot(record);
    if (record.state !== "created") throw new Error("Only an added item can be undone.");
    const pending = undoing.get(id);
    if (pending) return pending;
    const run = performUndo(record).finally(() => undoing.delete(id));
    undoing.set(id, run);
    return run;
  }

  return { submit, undo, recent };
}
