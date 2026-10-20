// Meeting notes from a Granola MCP server: which configured server is Granola, finding the notes
// for a calendar event, and keeping imported notes per account. Electron-free; handlers inject
// the MCP calls, the account scope and file persistence.

import { createHash } from "node:crypto";

import type { McpServerConfig } from "../../shared-types.js";
import {
  parseGranolaMeetings,
  parseGranolaNotes,
  type GranolaMeeting,
} from "./granola-parse.js";
import { matchMeeting } from "./match.js";

export interface NotesRecord {
  scope: string;
  calendarId: string;
  eventId: string;
  provider: "granola";
  providerMeetingId: string;
  providerUrl: string | null;
  title: string | null;
  importedAt: string;
  text: string;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  truncated: boolean;
}

export interface NotesDeps {
  isDemoMode(): boolean;
  currentScope(): Promise<string>;
  enabledServers(): Promise<McpServerConfig[]>;
  testServer(
    server: McpServerConfig,
  ): Promise<{ ok: boolean; tools: string[]; error: string | null }>;
  callTool(
    server: McpServerConfig,
    tool: string,
    args: Record<string, unknown>,
    options: { maxOutput: number },
  ): Promise<ToolResult>;
  readFile(name: "providers.json" | "notes.json"): Promise<string | null>;
  writeFile(name: "providers.json" | "notes.json", text: string): Promise<void>;
  now(): Date;
  newId(): string;
}

interface Selection {
  scope: string;
  calendarId: string;
  eventId: string;
  configHash: string;
  offered: Map<string, GranolaMeeting>;
  expires: number;
}

const GRANOLA_TOOLS = ["list_meetings", "get_meetings"];
const MAX_OUTPUT = 60_000;
const MAX_RECORDS = 200;
const SELECTION_MS = 10 * 60_000;
const ACCOUNT_CHANGED =
  "Your account changed while getting these notes. Try again.";

/** Identifies a server by what it runs, not its ID: Test runs on the unsaved form. */
export function serverConfigHash(server: McpServerConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        server.transport,
        server.command,
        server.args,
        server.url,
      ]),
    )
    .digest("hex");
}

function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const notesKey = (calendarId: string, eventId: string) =>
  `${calendarId}/${eventId}`;

export function createNotesService(deps: NotesDeps) {
  const selections = new Map<string, Selection>();
  // Read-modify-write of the JSON files runs one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  async function readJson<T>(
    name: "providers.json" | "notes.json",
    fallback: T,
  ): Promise<T> {
    const raw = await deps.readFile(name);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async function granolaHashes(): Promise<string[]> {
    const value = await readJson<{ granola?: unknown }>("providers.json", {});
    return Array.isArray(value.granola)
      ? value.granola.filter((hash): hash is string => typeof hash === "string")
      : [];
  }

  async function provider(): Promise<McpServerConfig | null> {
    if (deps.isDemoMode()) return null;
    const hashes = new Set(await granolaHashes());
    return (
      (await deps.enabledServers()).find((server) =>
        hashes.has(serverConfigHash(server)),
      ) ?? null
    );
  }

  async function records(): Promise<NotesRecord[]> {
    const value = await readJson<{ records?: unknown }>("notes.json", {});
    return Array.isArray(value.records) ? (value.records as NotesRecord[]) : [];
  }

  function recordFingerprint(
    server: McpServerConfig,
    tools: string[],
  ): Promise<void> {
    return serial(async () => {
      if (deps.isDemoMode()) return;
      const hash = serverConfigHash(server);
      const hashes = new Set(await granolaHashes());
      const isGranola = GRANOLA_TOOLS.every((tool) => tools.includes(tool));
      if (isGranola === hashes.has(hash)) return;
      if (isGranola) hashes.add(hash);
      else hashes.delete(hash);
      await deps.writeFile(
        "providers.json",
        JSON.stringify({ granola: [...hashes] }),
      );
    });
  }

  async function notesStatus(): Promise<{
    provider: { id: string; name: string } | null;
  }> {
    const server = await provider();
    return { provider: server ? { id: server.id, name: server.name } : null };
  }

  async function checkProviders(): Promise<{
    found: { id: string; name: string }[];
  }> {
    if (deps.isDemoMode()) return { found: [] };
    const found: { id: string; name: string }[] = [];
    // One at a time: each test launches that server.
    for (const server of await deps.enabledServers()) {
      const result = await deps.testServer(server);
      if (!result.ok) continue;
      await recordFingerprint(server, result.tools);
      if (GRANOLA_TOOLS.every((tool) => result.tools.includes(tool)))
        found.push({ id: server.id, name: server.name });
    }
    return { found };
  }

  async function findNotes(event: {
    calendarId: string;
    eventId: string;
    title: string;
    start: string;
    end: string;
  }): Promise<{
    selection: string;
    match: GranolaMeeting | null;
    candidates: GranolaMeeting[];
  }> {
    if (deps.isDemoMode())
      throw new Error("Meeting notes are turned off in demo mode.");
    const scope = await deps.currentScope();
    const server = await provider();
    if (!server)
      throw new Error("Set up a Granola MCP server in Settings → MCP first.");
    const listed = await deps.callTool(
      server,
      "list_meetings",
      {
        time_range: "custom",
        custom_start: localDate(event.start),
        custom_end: localDate(event.end),
      },
      { maxOutput: MAX_OUTPUT },
    );
    if (listed.isError)
      throw new Error(`Granola couldn't list meetings: ${listed.text}`);
    const { match, candidates } = matchMeeting(
      event,
      parseGranolaMeetings(listed.text),
    );
    const offered = new Map(candidates.map((meeting) => [meeting.id, meeting]));
    if (match) offered.set(match.id, match);
    const selection = deps.newId();
    selections.set(selection, {
      scope,
      calendarId: event.calendarId,
      eventId: event.eventId,
      configHash: serverConfigHash(server),
      offered,
      expires: deps.now().getTime() + SELECTION_MS,
    });
    return { selection, match, candidates };
  }

  async function importNotes(input: {
    selection: string;
    providerMeetingId: string;
  }): Promise<NotesRecord> {
    if (deps.isDemoMode())
      throw new Error("Meeting notes are turned off in demo mode.");
    const selection = selections.get(input.selection);
    selections.delete(input.selection);
    if (!selection || deps.now().getTime() > selection.expires)
      throw new Error("This notes search expired. Search again.");
    const meeting = selection.offered.get(input.providerMeetingId);
    if (!meeting)
      throw new Error("That meeting wasn't offered for this event.");
    if ((await deps.currentScope()) !== selection.scope)
      throw new Error(ACCOUNT_CHANGED);
    const server = await provider();
    if (!server || serverConfigHash(server) !== selection.configHash)
      throw new Error("The Granola server changed. Search again.");
    const result = await deps.callTool(
      server,
      "get_meetings",
      { meeting_ids: [meeting.id] },
      { maxOutput: MAX_OUTPUT },
    );
    if (result.isError)
      throw new Error(`Granola couldn't return these notes: ${result.text}`);
    const notes = parseGranolaNotes(result.text, meeting.id);
    const text = (notes?.text ?? result.text.replace(/<[^>]+>/g, "")).trim();
    if (!text) throw new Error("Granola returned no notes for this meeting.");
    if ((await deps.currentScope()) !== selection.scope)
      throw new Error(ACCOUNT_CHANGED);
    const record: NotesRecord = {
      scope: selection.scope,
      calendarId: selection.calendarId,
      eventId: selection.eventId,
      provider: "granola",
      providerMeetingId: meeting.id,
      providerUrl: meeting.url,
      title: notes?.title ?? meeting.title,
      importedAt: deps.now().toISOString(),
      text,
    };
    await serial(async () => {
      const kept = (await records())
        .filter(
          (existing) =>
            !(
              existing.scope === record.scope &&
              existing.calendarId === record.calendarId &&
              existing.eventId === record.eventId
            ),
        )
        .concat(record)
        .sort((a, b) => a.importedAt.localeCompare(b.importedAt))
        .slice(-MAX_RECORDS);
      await deps.writeFile("notes.json", JSON.stringify({ records: kept }));
    });
    return record;
  }

  async function getNotes(
    events: { calendarId: string; eventId: string }[],
  ): Promise<Record<string, NotesRecord>> {
    if (deps.isDemoMode() || !events.length) return {};
    const scope = await deps.currentScope();
    const wanted = new Set(
      events.map((event) => notesKey(event.calendarId, event.eventId)),
    );
    const result: Record<string, NotesRecord> = {};
    for (const record of await records()) {
      const key = notesKey(record.calendarId, record.eventId);
      if (record.scope === scope && wanted.has(key)) result[key] = record;
    }
    return result;
  }

  return {
    recordFingerprint,
    notesStatus,
    checkProviders,
    findNotes,
    importNotes,
    getNotes,
    /** Account changes invalidate every open notes search. */
    clearSelections: () => selections.clear(),
  };
}
