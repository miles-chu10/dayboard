import * as path from "node:path";

import { app } from "../platform/index.js";

import type { AgendaDuplicateLink, AgendaScheduledBlock, AgendaState } from "../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";
import { mutateAndPersist } from "./agenda-utils.js";

interface PendingBlock {
  requestId: string;
  taskKey: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface StoredAgendaState extends AgendaState {
  pendingBlocks: PendingBlock[];
}

interface AgendaFile {
  version: 2;
  accounts: Record<string, StoredAgendaState>;
}

const queue = createSerialQueue();
let cached: AgendaFile | null = null;
type KeyReplacement = { previousKey: string; currentKey: string };
const pendingReconciliations = new Map<string, KeyReplacement[]>();
const pendingDeletedEvents = new Map<string, Set<string>>();

function statePath(): string {
  return path.join(app.getPath("userData"), "agenda-state.json");
}

function emptyState(): StoredAgendaState {
  return { focusKeys: [], duplicateLinks: [], scheduledBlocks: [], pendingBlocks: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(
      "Agenda state contains invalid focus records; the original file was preserved.",
    );
  return [...new Set(value as string[])];
}

function normalizeDuplicateLinks(value: unknown): AgendaDuplicateLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Agenda state contains invalid link records.");
  const seen = new Set<string>();
  const links: AgendaDuplicateLink[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.leftKey !== "string" || typeof entry.rightKey !== "string")
      throw new Error("Agenda state contains an invalid item link.");
    if (entry.leftKey === entry.rightKey)
      throw new Error("Agenda state contains a self-referencing item link.");
    if (entry.status !== "accepted" && entry.status !== "dismissed")
      throw new Error("Agenda state contains an invalid link status.");
    const [leftKey, rightKey] = [entry.leftKey, entry.rightKey].sort();
    const key = `${leftKey}\u0000${rightKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ leftKey, rightKey, status: entry.status });
  }
  return links;
}

function normalizeScheduledBlocks(value: unknown): AgendaScheduledBlock[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("Agenda state contains invalid calendar associations.");
  const seen = new Set<string>();
  const blocks: AgendaScheduledBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error("Agenda state contains an invalid calendar association.");
    const { taskKey, eventId, date, startTime, endTime, requestId } = entry;
    if (
      typeof taskKey !== "string" ||
      typeof eventId !== "string" ||
      typeof date !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      (requestId !== undefined && typeof requestId !== "string")
    ) {
      throw new Error("Agenda state contains an invalid calendar association.");
    }
    const key = requestId || `${taskKey}\u0000${eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({
      taskKey,
      eventId,
      date,
      startTime,
      endTime,
      ...(requestId ? { requestId } : {}),
    });
  }
  return blocks;
}

function normalizePendingBlocks(value: unknown): PendingBlock[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error("Agenda state contains invalid pending calendar operations.");
  const seen = new Set<string>();
  const blocks: PendingBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error("Agenda state contains an invalid pending operation.");
    const { requestId, taskKey, date, startTime, endTime } = entry;
    if (
      typeof requestId !== "string" ||
      typeof taskKey !== "string" ||
      typeof date !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string"
    ) {
      throw new Error("Agenda state contains an invalid pending operation.");
    }
    if (seen.has(requestId)) continue;
    seen.add(requestId);
    blocks.push({ requestId, taskKey, date, startTime, endTime });
  }
  return blocks;
}

function normalizeState(value: unknown): StoredAgendaState {
  if (!isRecord(value)) throw new Error("Agenda state contains an invalid account record.");
  const raw = value;
  return {
    focusKeys: strings(raw.focusKeys),
    duplicateLinks: normalizeDuplicateLinks(raw.duplicateLinks),
    scheduledBlocks: normalizeScheduledBlocks(raw.scheduledBlocks),
    pendingBlocks: normalizePendingBlocks(raw.pendingBlocks),
  };
}

function normalizeFile(value: unknown): AgendaFile {
  if (!isRecord(value)) throw new Error("Agenda state must be a JSON object.");
  const raw = value;
  if ((raw.version !== 1 && raw.version !== 2) || !isRecord(raw.accounts)) {
    throw new Error("Agenda state has an unsupported schema.");
  }
  const accounts: Record<string, StoredAgendaState> = {};
  if (isRecord(raw.accounts)) {
    for (const [scope, state] of Object.entries(raw.accounts)) {
      accounts[scope] = normalizeState(state);
    }
  }
  return { version: 2, accounts };
}

function publicState(state: StoredAgendaState): AgendaState {
  return {
    focusKeys: [...state.focusKeys],
    duplicateLinks: state.duplicateLinks.map((link) => ({ ...link })),
    scheduledBlocks: state.scheduledBlocks.map((block) => ({ ...block })),
  };
}

async function load(): Promise<AgendaFile> {
  if (cached) return cached;
  const raw = await readFileIfExists(statePath());
  if (!raw) {
    cached = { version: 2, accounts: {} };
    return cached;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`Agenda state at ${statePath()} is not valid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`Agenda state at ${statePath()} must be a JSON object.`);
  const sourceVersion = parsed.version;
  if ((sourceVersion !== 1 && sourceVersion !== 2) || !isRecord(parsed.accounts)) {
    throw new Error(`Agenda state at ${statePath()} has an unsupported schema.`);
  }
  // Keep an exact, atomic copy of legacy bytes before the schema writer can
  // normalize anything. Never infer associations from titles during migration.
  if (sourceVersion !== 2) {
    const backup = `${statePath()}.v${sourceVersion}.bak`;
    if (!(await readFileIfExists(backup))) await writeFileAtomic(backup, raw);
  }
  cached = normalizeFile(parsed);
  return cached;
}

async function update<T>(scope: string, operation: (state: StoredAgendaState) => T): Promise<T> {
  return queue(async () => {
    const committed = await mutateAndPersist(
      await load(),
      (file) => {
        const state = file.accounts[scope] ?? emptyState();
        const result = operation(state);
        file.accounts[scope] = state;
        return result;
      },
      (file) => writeFileAtomic(statePath(), `${JSON.stringify(file, null, 2)}\n`),
    );
    cached = committed.state;
    const result = committed.result;
    return result;
  });
}

export async function getAgendaState(scope: string): Promise<AgendaState> {
  const file = await load();
  return publicState(file.accounts[scope] ?? emptyState());
}

export function setAgendaFocus(scope: string, focusKeys: string[]): Promise<AgendaState> {
  return update(scope, (state) => {
    state.focusKeys = strings(focusKeys);
    return publicState(state);
  });
}

export function setAgendaDuplicateLink(
  scope: string,
  link: AgendaDuplicateLink,
): Promise<AgendaState> {
  return update(scope, (state) => {
    const [leftKey, rightKey] = [link.leftKey, link.rightKey].sort();
    state.duplicateLinks = [
      ...state.duplicateLinks.filter(
        (entry) => entry.leftKey !== leftKey || entry.rightKey !== rightKey,
      ),
      { leftKey, rightKey, status: link.status },
    ];
    return publicState(state);
  });
}

export function removeAgendaDuplicateLink(
  scope: string,
  leftKey: string,
  rightKey: string,
): Promise<AgendaState> {
  return update(scope, (state) => {
    const [left, right] = [leftKey, rightKey].sort();
    state.duplicateLinks = state.duplicateLinks.filter(
      (link) => link.leftKey !== left || link.rightKey !== right,
    );
    return publicState(state);
  });
}

export function prepareAgendaBlock(
  scope: string,
  pending: PendingBlock,
): Promise<{ block: AgendaScheduledBlock | null; pending: PendingBlock; slotTaken: boolean }> {
  return update(scope, (state) => {
    const block =
      state.scheduledBlocks.find((entry) => entry.requestId === pending.requestId) ?? null;
    const existing =
      state.pendingBlocks.find((entry) => entry.requestId === pending.requestId) ??
      state.pendingBlocks.find(
        (entry) =>
          entry.taskKey === pending.taskKey &&
          entry.date === pending.date &&
          entry.startTime === pending.startTime &&
          entry.endTime === pending.endTime,
      );
    const slotTaken = Boolean(
      !block &&
      state.scheduledBlocks.some(
        (entry) =>
          entry.taskKey === pending.taskKey &&
          entry.date === pending.date &&
          entry.startTime === pending.startTime &&
          entry.endTime === pending.endTime,
      ),
    );
    if (!existing && !block && !slotTaken) state.pendingBlocks = [...state.pendingBlocks, pending];
    return { block, pending: existing ?? pending, slotTaken };
  });
}

export function abandonAgendaBlock(scope: string, requestId: string): Promise<void> {
  return update(scope, (state) => {
    state.pendingBlocks = state.pendingBlocks.filter((entry) => entry.requestId !== requestId);
  });
}

export function completeAgendaBlock(
  scope: string,
  block: AgendaScheduledBlock,
): Promise<AgendaState> {
  return update(scope, (state) => {
    if (!state.scheduledBlocks.some((entry) => entry.requestId === block.requestId)) {
      state.scheduledBlocks = [...state.scheduledBlocks, block];
    }
    state.pendingBlocks = state.pendingBlocks.filter(
      (entry) => entry.requestId !== block.requestId,
    );
    return publicState(state);
  });
}

export function removeAgendaScheduledBlock(
  scope: string,
  taskKey: string,
  eventId: string,
): Promise<AgendaState> {
  return update(scope, (state) => {
    state.scheduledBlocks = state.scheduledBlocks.filter(
      (block) => block.taskKey !== taskKey || block.eventId !== eventId,
    );
    return publicState(state);
  });
}

/** A confirmed provider deletion must release its exact saved planning slot. */
export function removeDeletedAgendaEvent(scope: string, eventId: string): Promise<AgendaState> {
  const pending = pendingDeletedEvents.get(scope) ?? new Set<string>();
  pending.add(eventId);
  pendingDeletedEvents.set(scope, pending);
  return update(scope, (state) => {
    const requestIds = new Set(
      state.scheduledBlocks
        .filter((block) => block.eventId === eventId)
        .map((block) => block.requestId),
    );
    state.scheduledBlocks = state.scheduledBlocks.filter((block) => block.eventId !== eventId);
    state.pendingBlocks = state.pendingBlocks.filter((block) => !requestIds.has(block.requestId));
    return publicState(state);
  }).then((state) => {
    pending.delete(eventId);
    if (!pending.size) pendingDeletedEvents.delete(scope);
    return state;
  });
}

function containsAgendaKey(state: StoredAgendaState, key: string): boolean {
  return (
    state.focusKeys.includes(key) ||
    state.duplicateLinks.some((link) => link.leftKey === key || link.rightKey === key) ||
    state.scheduledBlocks.some((block) => block.taskKey === key) ||
    state.pendingBlocks.some((block) => block.taskKey === key)
  );
}

/**
 * Reconciles an opaque provider-ref replacement only when the mutation itself
 * supplied an exact lineage and the new key cannot collide with an existing
 * record. Ambiguous legacy records stay untouched for the user to resolve.
 */
export function reconcileAgendaKeys(
  scope: string,
  replacements: readonly { previousKey: string; currentKey: string }[],
): Promise<{ state: AgendaState; changed: boolean }> {
  const pending = [...(pendingReconciliations.get(scope) ?? []), ...replacements];
  if (!pending.length) return getAgendaState(scope).then((state) => ({ state, changed: false }));
  pendingReconciliations.set(scope, pending);
  return update(scope, (state) => {
    let changed = false;
    for (const { previousKey, currentKey } of pending) {
      if (previousKey === currentKey || !containsAgendaKey(state, previousKey)) continue;
      if (containsAgendaKey(state, currentKey)) continue;
      state.focusKeys = state.focusKeys.map((key) => (key === previousKey ? currentKey : key));
      state.duplicateLinks = state.duplicateLinks.map((link) => {
        const leftKey = link.leftKey === previousKey ? currentKey : link.leftKey;
        const rightKey = link.rightKey === previousKey ? currentKey : link.rightKey;
        const [orderedLeft, orderedRight] = [leftKey, rightKey].sort();
        return { ...link, leftKey: orderedLeft, rightKey: orderedRight };
      });
      state.scheduledBlocks = state.scheduledBlocks.map((block) =>
        block.taskKey === previousKey ? { ...block, taskKey: currentKey } : block,
      );
      state.pendingBlocks = state.pendingBlocks.map((block) =>
        block.taskKey === previousKey ? { ...block, taskKey: currentKey } : block,
      );
      changed = true;
    }
    return { state: publicState(state), changed };
  }).then((result) => {
    const remaining = (pendingReconciliations.get(scope) ?? []).filter(
      (item) => !pending.includes(item),
    );
    if (remaining.length) pendingReconciliations.set(scope, remaining);
    else pendingReconciliations.delete(scope);
    return result;
  });
}

/** Allows normal shutdown to wait for already-authorized agenda persistence. */
export async function drainAgendaStore(): Promise<void> {
  await queue.drain();
  // A provider may have succeeded while the local disk was temporarily
  // unavailable. Retry its exact mappings before allowing a normal quit.
  for (const scope of pendingReconciliations.keys()) await reconcileAgendaKeys(scope, []);
  for (const [scope, eventIds] of pendingDeletedEvents)
    for (const eventId of eventIds) await removeDeletedAgendaEvent(scope, eventId);
}
