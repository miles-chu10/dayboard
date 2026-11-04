// The agent activity log: each DayBoard MCP tool call, from the Assistant or an outside client,
// kept for 30 days. Names and outcomes only; tool arguments and results stay out of the log.

import type { AgentActivityEntry } from "../shared-types.js";

export type { AgentActivityEntry };

export const ACTIVITY_DAYS = 30;
const KEEP_MS = ACTIVITY_DAYS * 86_400_000;
const MAX_ENTRIES = 2_000;
const MAX_ERROR = 200;

/** Reads are `list_*`, `read_*` and `get_*` tools; everything else changes something. */
export function isWriteTool(tool: string): boolean {
  return !/^(list|read|get)_/.test(tool);
}

function isEntry(value: unknown): value is AgentActivityEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.tool === "string" &&
    typeof entry.client === "string" &&
    typeof entry.ok === "boolean" &&
    typeof entry.write === "boolean" &&
    Number.isFinite(entry.at) &&
    Number.isFinite(entry.durationMs) &&
    (entry.error === undefined || typeof entry.error === "string")
  );
}

/** Keeps the last 30 days, newest last, capped so a chatty client can't grow the file forever. */
export function pruneActivity(entries: AgentActivityEntry[], now: number): AgentActivityEntry[] {
  return entries.filter((entry) => now - entry.at < KEEP_MS).slice(-MAX_ENTRIES);
}

export function parseActivity(value: unknown, now: number): AgentActivityEntry[] {
  const entries = (value as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? pruneActivity(entries.filter(isEntry), now) : [];
}

export function activityEntry(
  call: {
    tool: string;
    client: string;
    ok: boolean;
    error?: string;
    durationMs: number;
  },
  now: number,
  id: string,
): AgentActivityEntry {
  return {
    id,
    at: now,
    tool: call.tool.slice(0, 80),
    client: call.client.slice(0, 80) || "MCP client",
    write: isWriteTool(call.tool),
    ok: call.ok,
    ...(call.ok || !call.error ? {} : { error: call.error.slice(0, MAX_ERROR) }),
    durationMs: Math.max(0, Math.round(call.durationMs)),
  };
}
