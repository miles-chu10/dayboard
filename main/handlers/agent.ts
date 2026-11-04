import { ipcMain } from "../platform/index.js";
import {
  LEARN_SYSTEM,
  learnPrompt,
  learnedPreference,
  worthLearning,
} from "../services/agent-memory.js";
import {
  addMemoryEntry,
  deleteMemoryEntry,
  deleteNote,
  getNote,
  listActivity,
  listMemories,
  listNotes,
  listUsage,
  putNote,
  recordUsage,
} from "../services/agent-stores.js";
import { runCompletion } from "../services/ai/completion.js";
import { onRequestUsage } from "../services/ai/usage-events.js";
import { demoCompletion, isDemoMode } from "../services/demo-data.js";
import { getSettings } from "../services/settings-store.js";

function payload(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${channel}: expected an object`);
  return value as Record<string, unknown>;
}

function id(value: unknown, channel: string): string {
  const input = payload(value, channel).id;
  if (typeof input !== "string" || !input || input.length > 100)
    throw new Error(`${channel}: id must be text`);
  return input;
}

function text(input: Record<string, unknown>, key: string, channel: string, max: number): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${channel}: ${key} is required`);
  return value.slice(0, max);
}

/** Asks the AI what lasting preference, if any, the user's edits to a reply draft show. */
async function learnFromEdit(draft: string, sent: string): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.memory || !worthLearning(draft, sent)) return null;
  const prompt = learnPrompt(draft, sent);
  let output: string;
  if (isDemoMode()) output = demoCompletion(LEARN_SYSTEM, prompt);
  else {
    const result = await runCompletion({
      system: LEARN_SYSTEM,
      prompt,
      signal: AbortSignal.timeout(60_000),
    });
    output = result.text;
  }
  const learned = learnedPreference(output);
  if (learned) await addMemoryEntry(learned, "learned");
  return learned;
}

export function registerAgentHandlers(): void {
  onRequestUsage(recordUsage);
  ipcMain.handle("agent:activity", () => listActivity());

  ipcMain.handle("memory:list", () => listMemories());
  ipcMain.handle("memory:add", (_event, value: unknown) =>
    addMemoryEntry(payload(value, "memory:add").text, "you"),
  );
  ipcMain.handle("memory:delete", (_event, value: unknown) =>
    deleteMemoryEntry(id(value, "memory:delete")),
  );
  ipcMain.handle("memory:learn", async (_event, value: unknown) => {
    const channel = "memory:learn";
    const input = payload(value, channel);
    return {
      learned: await learnFromEdit(
        text(input, "draft", channel, 8_000),
        text(input, "sent", channel, 8_000),
      ),
    };
  });

  ipcMain.handle("usage:days", () => listUsage());

  ipcMain.handle("notes:list", () => listNotes());
  ipcMain.handle("notes:get", (_event, value: unknown) => getNote(id(value, "notes:get")));
  ipcMain.handle("notes:save", (_event, value: unknown) => putNote(payload(value, "notes:save")));
  ipcMain.handle("notes:delete", (_event, value: unknown) => deleteNote(id(value, "notes:delete")));
}
