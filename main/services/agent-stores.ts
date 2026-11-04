// The JSON files behind agent activity, memory, AI usage and notes. Demo mode keeps its own files,
// seeded with sample data, so it never reads or changes the real ones.

import { randomUUID } from "node:crypto";
import * as path from "node:path";

import type { RequestUsage } from "../../shared/ai-usage.js";
import { app, ipcMain, logger } from "../platform/index.js";
import type {
  AgentActivityEntry,
  AgentMemory,
  MemorySource,
  Note,
  UsageDay,
} from "../shared-types.js";
import { activityEntry, parseActivity, pruneActivity } from "./agent-activity.js";
import { addMemory, parseMemories } from "./agent-memory.js";
import { demoActivity, demoMemories, demoNotes, demoUsage, isDemoMode } from "./demo-data.js";
import { createJsonStore } from "./json-store.js";
import { parseNoteInput, parseNotes, saveNote, sortNotes } from "./notes.js";
import { addUsage, parseUsage } from "./usage-log.js";

function file(name: string) {
  return () => path.join(app.getPath("userData"), isDemoMode() ? `demo-${name}` : name);
}

/** A demo file that doesn't exist yet starts from the sample data. */
function fresh(value: unknown): boolean {
  return value === null && isDemoMode();
}

const activity = createJsonStore<{ entries: AgentActivityEntry[] }>({
  path: file("agent-activity.json"),
  parse: (value) => ({
    entries: fresh(value) ? demoActivity(Date.now()) : parseActivity(value, Date.now()),
  }),
});

const memory = createJsonStore<{ memories: AgentMemory[] }>({
  path: file("agent-memory.json"),
  parse: (value) => ({
    memories: fresh(value) ? demoMemories(Date.now()) : parseMemories(value),
  }),
});

const usage = createJsonStore<{ days: UsageDay[] }>({
  path: file("ai-usage.json"),
  parse: (value) => ({
    days: fresh(value) ? demoUsage(Date.now()) : parseUsage(value, Date.now()),
  }),
});

const notes = createJsonStore<{ notes: Note[] }>({
  path: file("notes.json"),
  parse: (value) => ({
    notes: fresh(value) ? demoNotes(Date.now()) : parseNotes(value),
  }),
});

/** Never throws: a failed log write must not fail the tool call it describes. */
export function recordToolCall(call: {
  tool: string;
  client: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}): void {
  const now = Date.now();
  void activity
    .update((value) => ({
      entries: pruneActivity([...value.entries, activityEntry(call, now, randomUUID())], now),
    }))
    .then(
      () => ipcMain.broadcast("agent:activityChanged", {}),
      (error: unknown) => logger.warn("agent", "Could not record a tool call", error),
    );
}

/** Newest first. */
export async function listActivity(): Promise<AgentActivityEntry[]> {
  const now = Date.now();
  return pruneActivity((await activity.read()).entries, now).reverse();
}

export async function listMemories(): Promise<AgentMemory[]> {
  return (await memory.read()).memories;
}

export async function addMemoryEntry(text: unknown, source: MemorySource): Promise<AgentMemory[]> {
  const next = await memory.update((value) => ({
    memories: addMemory(value.memories, { text: text as string, source }, Date.now(), randomUUID()),
  }));
  ipcMain.broadcast("memory:changed", {});
  return next.memories;
}

export async function deleteMemoryEntry(id: string): Promise<AgentMemory[]> {
  const next = await memory.update((value) => ({
    memories: value.memories.filter((entry) => entry.id !== id),
  }));
  ipcMain.broadcast("memory:changed", {});
  return next.memories;
}

/** Never throws: usage is a record of the request, not part of it. */
export function recordUsage(request: RequestUsage | undefined): void {
  if (!request) return;
  const now = Date.now();
  void usage
    .update((value) => ({ days: addUsage(value.days, request, now) }))
    .then(
      () => ipcMain.broadcast("usage:changed", {}),
      (error: unknown) => logger.warn("agent", "Could not record AI usage", error),
    );
}

export async function listUsage(): Promise<UsageDay[]> {
  return (await usage.read()).days;
}

/** Newest edit first. */
export async function listNotes(): Promise<Note[]> {
  return sortNotes((await notes.read()).notes);
}

export async function getNote(id: string): Promise<Note | null> {
  return (await notes.read()).notes.find((note) => note.id === id) ?? null;
}

export async function putNote(value: unknown): Promise<Note> {
  const input = parseNoteInput(value);
  let saved: Note | undefined;
  await notes.update((current) => {
    const result = saveNote(current.notes, input, Date.now(), randomUUID());
    saved = result.note;
    return { notes: result.notes };
  });
  ipcMain.broadcast("notes:changed", {});
  return saved!;
}

export async function deleteNote(id: string): Promise<void> {
  await notes.update((current) => ({
    notes: current.notes.filter((note) => note.id !== id),
  }));
  ipcMain.broadcast("notes:changed", {});
}
