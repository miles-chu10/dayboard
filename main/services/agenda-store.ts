import * as path from "node:path";

import { app } from "@glaze/core/backend";

import type { AgendaDuplicateLink, AgendaScheduledBlock, AgendaState } from "../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";
import { mutateAndPersist } from "./agenda-utils.js";

const MAX_FOCUS_KEYS = 100;
const MAX_DUPLICATE_LINKS = 250;
const MAX_SCHEDULED_BLOCKS = 250;
const MAX_PENDING_BLOCKS = 50;

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
  version: 1;
  accounts: Record<string, StoredAgendaState>;
}

const queue = createSerialQueue();
let cached: AgendaFile | null = null;

function statePath(): string {
  return path.join(app.getPath("userData"), "agenda-state.json");
}

function emptyState(): StoredAgendaState {
  return { focusKeys: [], duplicateLinks: [], scheduledBlocks: [], pendingBlocks: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 320),
    ),
  ].slice(0, cap);
}

function normalizeDuplicateLinks(value: unknown): AgendaDuplicateLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: AgendaDuplicateLink[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.leftKey !== "string" || typeof entry.rightKey !== "string")
      continue;
    if (
      entry.leftKey === entry.rightKey ||
      entry.leftKey.length > 320 ||
      entry.rightKey.length > 320
    )
      continue;
    if (entry.status !== "accepted" && entry.status !== "dismissed") continue;
    const [leftKey, rightKey] = [entry.leftKey, entry.rightKey].sort();
    const key = `${leftKey}\u0000${rightKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ leftKey, rightKey, status: entry.status });
    if (links.length === MAX_DUPLICATE_LINKS) break;
  }
  return links;
}

function normalizeScheduledBlocks(value: unknown): AgendaScheduledBlock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const blocks: AgendaScheduledBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { taskKey, eventId, date, startTime, endTime, requestId } = entry;
    if (
      typeof taskKey !== "string" ||
      typeof eventId !== "string" ||
      typeof date !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      (requestId !== undefined && typeof requestId !== "string")
    ) {
      continue;
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
    if (blocks.length === MAX_SCHEDULED_BLOCKS) break;
  }
  return blocks;
}

function normalizePendingBlocks(value: unknown): PendingBlock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const blocks: PendingBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { requestId, taskKey, date, startTime, endTime } = entry;
    if (
      typeof requestId !== "string" ||
      typeof taskKey !== "string" ||
      typeof date !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string" ||
      seen.has(requestId)
    ) {
      continue;
    }
    seen.add(requestId);
    blocks.push({ requestId, taskKey, date, startTime, endTime });
    if (blocks.length === MAX_PENDING_BLOCKS) break;
  }
  return blocks;
}

function normalizeState(value: unknown): StoredAgendaState {
  const raw = isRecord(value) ? value : {};
  return {
    focusKeys: strings(raw.focusKeys, MAX_FOCUS_KEYS),
    duplicateLinks: normalizeDuplicateLinks(raw.duplicateLinks),
    scheduledBlocks: normalizeScheduledBlocks(raw.scheduledBlocks),
    pendingBlocks: normalizePendingBlocks(raw.pendingBlocks),
  };
}

function normalizeFile(value: unknown): AgendaFile {
  const raw = isRecord(value) ? value : {};
  const accounts: Record<string, StoredAgendaState> = {};
  if (isRecord(raw.accounts)) {
    for (const [scope, state] of Object.entries(raw.accounts)) {
      if (scope.length <= 160) accounts[scope] = normalizeState(state);
    }
  }
  return { version: 1, accounts };
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
    cached = { version: 1, accounts: {} };
    return cached;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`Agenda state at ${statePath()} is not valid JSON.`);
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
    state.focusKeys = strings(focusKeys, MAX_FOCUS_KEYS);
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
    ].slice(-MAX_DUPLICATE_LINKS);
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
    if (!existing && !block && !slotTaken)
      state.pendingBlocks = [...state.pendingBlocks, pending].slice(-MAX_PENDING_BLOCKS);
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
      state.scheduledBlocks = [...state.scheduledBlocks, block].slice(-MAX_SCHEDULED_BLOCKS);
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
