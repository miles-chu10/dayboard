import { clipboard, ipcMain, logger } from "@glaze/core/backend";

import type {
  AIStreamChunk,
  AssistantMessageInput,
  SettingsChangedEvent,
} from "../shared-types.js";
import { runAssistant } from "../services/ai/assistant.js";
import { checkCliProvider, isCancelled, runCliCompletion } from "../services/ai/cli-providers.js";
import { listCodexModels } from "../services/ai/codex-models.js";
import { testMcpServer } from "../services/ai/mcp-client.js";
import {
  checkAssistantMcpConnection,
  getAssistantMcpStatus,
  getExternalMcpUrl,
} from "../services/mcp-http-server.js";
import { getMcpAccessKey, regenerateMcpAccessKey } from "../services/mcp-access-key.js";
import { resolveAssistantMcpServers } from "../services/ai/assistant-mcp.js";
import {
  deleteMcpServer,
  getMcpServers,
  getSettings,
  normalizeMcpServer,
  saveMcpServer,
  saveSettings,
  settingsAffectData,
} from "../services/settings-store.js";

const RUN_TIMEOUT_MS = 3 * 60_000;

type McpClientKind = "claude" | "codex" | "json";

/** Client setup including the access key; built here so the key never reaches the renderer. */
function externalMcpSetup(client: McpClientKind, url: string, key: string): string {
  const authorization = `Bearer ${key}`;
  if (client === "claude") {
    return `claude mcp add --transport http dayboard ${url} --header "Authorization: ${authorization}"`;
  }
  if (client === "codex") {
    return `[mcp_servers.dayboard]\nurl = "${url}"\nhttp_headers = { Authorization = "${authorization}" }\n`;
  }
  return JSON.stringify(
    { mcpServers: { dayboard: { type: "http", url, headers: { Authorization: authorization } } } },
    null,
    2,
  );
}

function asObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null)
    throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  channel: string,
  max = 400_000,
): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${channel}: "${key}" is required`);
  return value.slice(0, max);
}

function parseMessages(value: unknown, channel: string): AssistantMessageInput[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error(`${channel}: "messages" must be a non-empty array`);
  return value.slice(-30).map((entry) => {
    const message = asObject(entry, channel);
    if (message.role !== "user" && message.role !== "assistant")
      throw new Error(`${channel}: invalid message role`);
    return {
      role: message.role,
      content: typeof message.content === "string" ? message.content.slice(0, 40_000) : "",
    };
  });
}

export function registerAIHandlers(): void {
  // Settings
  ipcMain.handle("settings:get", () => getSettings());

  ipcMain.handle("settings:update", async (_event, payload: unknown) => {
    const { previous, settings } = await saveSettings(asObject(payload, "settings:update"));
    const event: SettingsChangedEvent = {
      settings,
      dataChanged: settingsAffectData(previous, settings),
    };
    ipcMain.broadcast("settings:changed", event);
    return settings;
  });

  // MCP servers
  ipcMain.handle("mcp:list", () => getMcpServers());

  ipcMain.handle("mcp:assistantStatus", async () => ({
    ...getAssistantMcpStatus(),
    serverCount: resolveAssistantMcpServers(
      (await getSettings()).ai.useMcpInAssistant,
      await getMcpServers(),
    ).length,
  }));
  ipcMain.handle("mcp:assistantTest", () => checkAssistantMcpConnection());

  // External MCP clients (Claude Code, Codex, …)
  ipcMain.handle("mcp:externalInfo", () => ({ url: getExternalMcpUrl() }));

  ipcMain.handle("mcp:copyExternalSetup", async (_event, payload: unknown) => {
    const channel = "mcp:copyExternalSetup";
    const client = asObject(payload, channel).client;
    if (client !== "claude" && client !== "codex" && client !== "json") {
      throw new Error(`${channel}: client must be claude, codex, or json`);
    }
    const url = getExternalMcpUrl();
    if (!url) throw new Error("The MCP server hasn't started yet. Try again in a moment.");
    clipboard.writeText(externalMcpSetup(client, url, await getMcpAccessKey()));
    return { copied: true };
  });

  ipcMain.handle("mcp:regenerateExternalKey", async () => {
    await regenerateMcpAccessKey();
    return { regenerated: true };
  });

  ipcMain.handle("mcp:save", async (_event, payload: unknown) => {
    const servers = await saveMcpServer(payload);
    ipcMain.broadcast("mcp:changed", {});
    return servers;
  });

  ipcMain.handle("mcp:delete", async (_event, payload: unknown) => {
    const id = requireString(asObject(payload, "mcp:delete"), "id", "mcp:delete");
    const servers = await deleteMcpServer(id);
    ipcMain.broadcast("mcp:changed", {});
    return servers;
  });

  ipcMain.handle("mcp:test", async (_event, payload: unknown) => {
    try {
      return await testMcpServer(normalizeMcpServer(payload));
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Providers
  ipcMain.handle("ai:providerStatus", async (_event, payload: unknown) => {
    const input = asObject(payload, "ai:providerStatus");
    if (input.provider !== "claude" && input.provider !== "codex") {
      throw new Error("ai:providerStatus: provider must be claude or codex");
    }
    return checkCliProvider(input.provider, input.verify === true);
  });

  ipcMain.handle("ai:codexModels", async (_event, payload: unknown) => {
    const refresh =
      typeof payload === "object" &&
      payload !== null &&
      (payload as { refresh?: unknown }).refresh === true;
    return listCodexModels(refresh);
  });

  // One-shot generation through a subscription CLI (Glaze AI runs in the renderer).
  ipcMain.handleStream<unknown, AIStreamChunk, { text: string }>(
    "ai:run",
    async (payload, sendChunk, context) => {
      const channel = "ai:run";
      const input = asObject(payload, channel);
      const settings = await getSettings();
      if (settings.ai.provider === "glaze")
        throw new Error("Glaze AI requests run in the app window.");
      try {
        const text = await runCliCompletion({
          provider: settings.ai.provider,
          system: requireString(input, "system", channel),
          prompt: requireString(input, "prompt", channel),
          mcpServers: [],
          signal: context.signal,
          timeoutMs: RUN_TIMEOUT_MS,
          onDelta: (text) => sendChunk({ type: "delta", text }),
          onTool: () => undefined,
        });
        return { text };
      } catch (error) {
        if (!isCancelled(error))
          logger.error("ai", "ai:run failed", { message: (error as Error).message });
        throw error;
      }
    },
  );

  ipcMain.handleStream<unknown, AIStreamChunk, unknown>(
    "ai:assistant",
    async (payload, sendChunk, context) => {
      const channel = "ai:assistant";
      const input = asObject(payload, channel);
      return runAssistant(
        {
          messages: parseMessages(input.messages, channel),
          system: requireString(input, "system", channel),
        },
        sendChunk,
        context.signal,
      );
    },
  );
}
