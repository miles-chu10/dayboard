// IPC for meeting notes from a Granola MCP server. The logic is services/meeting-notes/.

import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { app, logger } from "@glaze/core/backend";

import { ipcMain } from "../ipc.js";
import { callMcpTool, testMcpServer } from "../services/ai/mcp-client.js";
import { onMcpServerTested } from "../services/ai/mcp-test-events.js";
import { isDemoMode } from "../services/demo-data.js";
import { readFileIfExists, writeFileAtomic } from "../services/file-store.js";
import { createNotesService } from "../services/meeting-notes/notes-service.js";
import { getMcpServers, getSettings } from "../services/settings-store.js";
import { onAccountsChanged, requireAgendaScope } from "./productivity.js";

const directory = () => path.join(app.getPath("userData"), "meeting-notes");

const service = createNotesService({
  isDemoMode,
  currentScope: requireAgendaScope,
  enabledServers: async () => (await getMcpServers()).filter((server) => server.enabled),
  testServer: testMcpServer,
  callTool: callMcpTool,
  readFile: async (name) =>
    (await readFileIfExists(path.join(directory(), name)))?.toString("utf8") ?? null,
  writeFile: (name, text) => writeFileAtomic(path.join(directory(), name), text),
  now: () => new Date(),
  newId: randomUUID,
});

function object(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${channel}: expected an object`);
  return value as Record<string, unknown>;
}

function text(input: Record<string, unknown>, key: string, channel: string, max = 500): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${channel}: "${key}" is required`);
  return value;
}

async function requireNotesOn(): Promise<void> {
  if (!(await getSettings()).system.meetings.notesImport)
    throw new Error("Turn on Meeting notes from Granola in Settings → General first.");
}

export function registerMeetingNotesHandlers(): void {
  onMcpServerTested((server, tools) => {
    void service
      .recordFingerprint(server, tools)
      .catch((error) => logger.warn("meetings", "Could not record an MCP server's tools", error));
  });
  onAccountsChanged(() => service.clearSelections());

  ipcMain.handle("meetings:notesStatus", async () => ({
    ...(await service.notesStatus()),
    enabled: (await getSettings()).system.meetings.notesImport,
  }));
  ipcMain.handle("meetings:checkProviders", () => service.checkProviders());
  ipcMain.handle("meetings:findNotes", async (_event, value: unknown) => {
    const channel = "meetings:findNotes";
    const input = object(value, channel);
    await requireNotesOn();
    return service.findNotes({
      calendarId: text(input, "calendarId", channel, 1_024),
      eventId: text(input, "eventId", channel, 1_024),
      title: text(input, "title", channel, 1_024),
      start: text(input, "start", channel, 64),
      end: text(input, "end", channel, 64),
    });
  });
  ipcMain.handle("meetings:importNotes", async (_event, value: unknown) => {
    const channel = "meetings:importNotes";
    const input = object(value, channel);
    await requireNotesOn();
    return service.importNotes({
      selection: text(input, "selection", channel, 100),
      providerMeetingId: text(input, "providerMeetingId", channel, 100),
    });
  });
  ipcMain.handle("meetings:getNotes", (_event, value: unknown) => {
    const channel = "meetings:getNotes";
    const events = object(value, channel).events;
    if (!Array.isArray(events) || events.length > 100)
      throw new Error(`${channel}: send up to 100 events`);
    return service.getNotes(
      events.map((entry) => {
        const item = object(entry, channel);
        return {
          calendarId: text(item, "calendarId", channel, 1_024),
          eventId: text(item, "eventId", channel, 1_024),
        };
      }),
    );
  });
}
