import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { app, safeStorage } from "@glaze/core/backend";

import type {
  AIFeature,
  AIProvider,
  AppSettings,
  LaunchView,
  McpServerConfig,
  SourceColor,
  SourceId,
} from "../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";

const SOURCE_IDS: SourceId[] = ["tasks", "reminders", "mail", "calendar"];
const COLORS: SourceColor[] = ["blue", "green", "orange", "red", "purple", "magenta", "yellow"];
const PROVIDERS: AIProvider[] = ["glaze", "claude", "codex"];
const LAUNCH_VIEWS: LaunchView[] = ["today", "tasks", "reminders", "mail", "calendar", "assistant", "review"];
const CLAUDE_MODELS = ["default", "sonnet", "opus", "haiku"] as const;
const AI_FEATURES: AIFeature[] = [
  "briefing",
  "autoBriefing",
  "prioritize",
  "triage",
  "replyDrafts",
  "capture",
  "assistant",
  "meetingPrep",
  "weeklyReview",
];

export const DEFAULT_SETTINGS: AppSettings = {
  general: { launchView: "today", refreshMinutes: 15 },
  sources: {
    tasks: { enabled: true, color: "blue" },
    reminders: { enabled: true, color: "orange" },
    mail: { enabled: true, color: "red" },
    calendar: { enabled: true, color: "green" },
  },
  mail: { maxMessages: 25 },
  calendar: { daysAhead: 7, visibility: {} },
  ai: {
    enabled: true,
    provider: "glaze",
    claudeModel: "default",
    codexModel: "",
    useMcpInAssistant: true,
    features: {
      briefing: true,
      autoBriefing: false,
      prioritize: true,
      triage: true,
      replyDrafts: true,
      capture: true,
      assistant: true,
      meetingPrep: true,
      weeklyReview: true,
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function normalizeSettings(value: unknown): AppSettings {
  const root = record(value);
  const general = record(root.general);
  const sources = record(root.sources);
  const mail = record(root.mail);
  const calendar = record(root.calendar);
  const ai = record(root.ai);
  const features = record(ai.features);
  const defaults = DEFAULT_SETTINGS;

  const visibility: Record<string, boolean> = {};
  for (const [id, visible] of Object.entries(record(calendar.visibility))) {
    if (typeof visible === "boolean") visibility[id] = visible;
  }

  return {
    general: {
      launchView: oneOf(general.launchView, LAUNCH_VIEWS, defaults.general.launchView),
      refreshMinutes: oneOf(general.refreshMinutes, [0, 5, 15, 30], defaults.general.refreshMinutes),
    },
    sources: Object.fromEntries(
      SOURCE_IDS.map((id) => {
        const source = record(sources[id]);
        return [
          id,
          {
            enabled: bool(source.enabled, defaults.sources[id].enabled),
            color: oneOf(source.color, COLORS, defaults.sources[id].color),
          },
        ];
      }),
    ) as AppSettings["sources"],
    mail: { maxMessages: oneOf(mail.maxMessages, [10, 25, 50], defaults.mail.maxMessages) },
    calendar: {
      daysAhead: oneOf(calendar.daysAhead, [3, 7, 14], defaults.calendar.daysAhead),
      visibility,
    },
    ai: {
      enabled: bool(ai.enabled, defaults.ai.enabled),
      provider: oneOf(ai.provider, PROVIDERS, defaults.ai.provider),
      claudeModel: oneOf(ai.claudeModel, CLAUDE_MODELS, defaults.ai.claudeModel),
      codexModel: typeof ai.codexModel === "string" ? ai.codexModel.trim().slice(0, 80) : defaults.ai.codexModel,
      useMcpInAssistant: bool(ai.useMcpInAssistant, defaults.ai.useMcpInAssistant),
      features: Object.fromEntries(
        AI_FEATURES.map((feature) => [feature, bool(features[feature], defaults.ai.features[feature])]),
      ) as AppSettings["ai"]["features"],
    },
  };
}

/** Whether a settings change affects which source data the backend fetches. */
export function settingsAffectData(previous: AppSettings, next: AppSettings): boolean {
  return (
    JSON.stringify([previous.sources, previous.mail, previous.calendar]) !==
    JSON.stringify([next.sources, next.mail, next.calendar])
  );
}

// ── App settings ───────────────────────────────────────────────────────────

const settingsQueue = createSerialQueue();
let cachedSettings: AppSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function getSettings(): Promise<AppSettings> {
  if (cachedSettings) return cachedSettings;
  const raw = await readFileIfExists(settingsPath());
  if (!raw) {
    cachedSettings = DEFAULT_SETTINGS;
    return cachedSettings;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`Settings file at ${settingsPath()} is not valid JSON.`);
  }
  cachedSettings = normalizeSettings(parsed);
  return cachedSettings;
}

export function saveSettings(next: unknown): Promise<{ previous: AppSettings; settings: AppSettings }> {
  return settingsQueue(async () => {
    const previous = await getSettings();
    const settings = normalizeSettings(next);
    await writeFileAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
    cachedSettings = settings;
    return { previous, settings };
  });
}

// ── MCP servers (encrypted: env vars and headers often hold tokens) ──────────────────

const mcpQueue = createSerialQueue();
let cachedServers: McpServerConfig[] | null = null;

function mcpPath(): string {
  return path.join(app.getPath("userData"), "mcp-servers.bin");
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (key.trim() && typeof entry === "string") result[key.trim()] = entry;
  }
  return result;
}

export function normalizeMcpServer(value: unknown): McpServerConfig {
  if (!isRecord(value)) throw new Error("Invalid MCP server configuration.");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 60) : "";
  if (!name) throw new Error("Give the MCP server a name.");
  const transport = value.transport === "http" ? "http" : "stdio";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (transport === "stdio" && !command) {
    throw new Error("Enter the command that starts the server, for example npx.");
  }
  if (transport === "http") {
    let protocol = "";
    try {
      protocol = new URL(url).protocol;
    } catch {
      // handled below
    }
    if (protocol !== "https:" && protocol !== "http:") throw new Error("Enter a valid http(s) server URL.");
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : randomUUID(),
    name,
    enabled: bool(value.enabled, true),
    transport,
    command,
    args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string") : [],
    env: stringRecord(value.env),
    url,
    headers: stringRecord(value.headers),
  };
}

export async function getMcpServers(): Promise<McpServerConfig[]> {
  if (cachedServers) return cachedServers;
  const raw = await readFileIfExists(mcpPath());
  if (!raw) {
    cachedServers = [];
    return cachedServers;
  }
  const parsed: unknown = JSON.parse(await safeStorage.decryptString(raw));
  cachedServers = Array.isArray(parsed) ? parsed.map(normalizeMcpServer) : [];
  return cachedServers;
}

async function writeMcpServers(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  await writeFileAtomic(mcpPath(), await safeStorage.encryptString(JSON.stringify(servers)));
  cachedServers = servers;
  return servers;
}

export function saveMcpServer(value: unknown): Promise<McpServerConfig[]> {
  return mcpQueue(async () => {
    const server = normalizeMcpServer(value);
    const servers = await getMcpServers();
    const clash = servers.find(
      (existing) => existing.id !== server.id && existing.name.toLowerCase() === server.name.toLowerCase(),
    );
    if (clash) throw new Error(`A server named “${server.name}” already exists.`);
    const exists = servers.some((existing) => existing.id === server.id);
    return writeMcpServers(
      exists ? servers.map((existing) => (existing.id === server.id ? server : existing)) : [...servers, server],
    );
  });
}

export function deleteMcpServer(id: string): Promise<McpServerConfig[]> {
  return mcpQueue(async () => writeMcpServers((await getMcpServers()).filter((server) => server.id !== id)));
}
