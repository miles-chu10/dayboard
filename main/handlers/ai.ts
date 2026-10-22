import type { RequestUsage } from "../../shared/ai-usage.js";
import { clipboard, ipcMain } from "../platform/index.js";

import type {
  AIStreamChunk,
  ApiProviderId,
  AssistantMcpCheck,
  AssistantMcpServerInfo,
  McpServerConfig,
  ProviderAvailability,
  AssistantMessageInput,
  SettingsChangedEvent,
} from "../shared-types.js";
import { assertNotDemo, demoCompletion, isDemoMode } from "../services/demo-data.js";
import { runAssistant } from "../services/ai/assistant.js";
import { clipSnapshot } from "../services/ai/prompt-cache.js";
import { onClaudeModelResolved, resolvedClaudeModels } from "../services/ai/model-options.js";
import { runCompletion } from "../services/ai/completion.js";
import { checkCliProvider, listGeminiModels, resolveCli } from "../services/ai/cli-providers.js";
import { listCodexModels } from "../services/ai/codex-models.js";
import { pickAttachments } from "../services/ai/attachments.js";
import { transcribe } from "../services/ai/dictation.js";
import {
  API_PROVIDERS,
  clearApiKey,
  getApiKeyStatuses,
  isApiProvider,
  saveApiKey,
} from "../services/ai/api-keys.js";
import { listApiModels } from "../services/ai/api-providers.js";
import { testMcpServer } from "../services/ai/mcp-client.js";
import { mcpServerTested } from "../services/ai/mcp-test-events.js";
import {
  checkAssistantMcpConnection,
  getActiveAssistantMcpServerConfig,
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
    {
      mcpServers: {
        dayboard: {
          type: "http",
          url,
          headers: { Authorization: authorization },
        },
      },
    },
    null,
    2,
  );
}

function describeTarget(server: McpServerConfig): string {
  if (server.transport === "stdio") return [server.command, ...server.args].join(" ").slice(0, 120);
  try {
    const url = new URL(server.url);
    return `${url.host}${url.pathname}`;
  } catch {
    return "HTTP server";
  }
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

  ipcMain.handle("mcp:assistantStatus", async () => {
    if (isDemoMode())
      return {
        state: "unavailable" as const,
        ok: false,
        toolCount: 0,
        serverCount: 0,
      };
    return {
      ...getAssistantMcpStatus(),
      serverCount: resolveAssistantMcpServers(
        (await getSettings()).ai.useMcpInAssistant,
        await getMcpServers(),
      ).length,
    };
  });
  ipcMain.handle("mcp:assistantTest", () => {
    if (isDemoMode()) return { state: "unavailable" as const, ok: false, toolCount: 0 };
    return checkAssistantMcpConnection();
  });

  // External MCP clients (Claude Code, Codex, …)
  ipcMain.handle("mcp:externalInfo", () => ({
    url: isDemoMode() ? null : getExternalMcpUrl(),
  }));

  ipcMain.handle("mcp:copyExternalSetup", async (_event, payload: unknown) => {
    const channel = "mcp:copyExternalSetup";
    assertNotDemo(channel);
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
    assertNotDemo("mcp:regenerateExternalKey");
    await regenerateMcpAccessKey();
    return { regenerated: true };
  });

  ipcMain.handle("mcp:save", async (_event, payload: unknown) => {
    assertNotDemo("mcp:save");
    const servers = await saveMcpServer(payload);
    ipcMain.broadcast("mcp:changed", {});
    return servers;
  });

  ipcMain.handle("mcp:delete", async (_event, payload: unknown) => {
    assertNotDemo("mcp:delete");
    const id = requireString(asObject(payload, "mcp:delete"), "id", "mcp:delete");
    const servers = await deleteMcpServer(id);
    ipcMain.broadcast("mcp:changed", {});
    return servers;
  });

  ipcMain.handle("mcp:test", async (_event, payload: unknown) => {
    assertNotDemo("mcp:test");
    try {
      const server = normalizeMcpServer(payload);
      const result = await testMcpServer(server);
      if (result.ok) mcpServerTested(server, result.tools);
      return result;
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
    if (
      input.provider !== "claude" &&
      input.provider !== "codex" &&
      input.provider !== "gemini" &&
      input.provider !== "muse"
    ) {
      throw new Error("ai:providerStatus: provider must be claude, codex, gemini, or muse");
    }
    if (isDemoMode()) {
      return {
        ok: false as const,
        reason: "failed" as const,
        message: "Sample responses are used in demo mode.",
      };
    }
    return checkCliProvider(input.provider, input.verify === true);
  });

  // The exact model each Claude Code alias ran as, so Settings and the composer can name the default.
  onClaudeModelResolved((models) => ipcMain.broadcast("ai:claudeModelsChanged", models));
  ipcMain.handle("ai:claudeModels", () => (isDemoMode() ? {} : resolvedClaudeModels()));

  ipcMain.handle("ai:codexModels", async (_event, payload: unknown) => {
    if (isDemoMode()) return [];
    const refresh =
      typeof payload === "object" &&
      payload !== null &&
      (payload as { refresh?: unknown }).refresh === true;
    return listCodexModels(refresh);
  });

  // Assistant composer: attachments and dictation
  ipcMain.handle("assistant:pickAttachments", () => {
    assertNotDemo("assistant:pickAttachments");
    return pickAttachments();
  });

  // API keys (OpenAI, Anthropic, Gemini). Keys are write-only from the renderer.
  ipcMain.handle("apiKeys:status", () =>
    isDemoMode()
      ? Object.fromEntries(
          API_PROVIDERS.map((provider) => [provider, { configured: false, hint: null }]),
        )
      : getApiKeyStatuses(),
  );
  ipcMain.handle("apiKeys:save", (_event, payload: unknown) => {
    const channel = "apiKeys:save";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    if (!isApiProvider(input.provider)) throw new Error(`${channel}: unknown provider`);
    return saveApiKey(input.provider, requireString(input, "key", channel, 400));
  });
  ipcMain.handle("apiKeys:clear", (_event, payload: unknown) => {
    const channel = "apiKeys:clear";
    assertNotDemo(channel);
    const provider = asObject(payload, channel).provider;
    if (!isApiProvider(provider)) throw new Error(`${channel}: unknown provider`);
    return clearApiKey(provider);
  });
  ipcMain.handle("ai:apiModels", (_event, payload: unknown) => {
    const input = asObject(payload, "ai:apiModels");
    if (!isApiProvider(input.provider)) throw new Error("ai:apiModels: unknown provider");
    if (isDemoMode()) return [];
    return listApiModels(input.provider, input.refresh === true);
  });
  ipcMain.handle("ai:geminiModels", () => (isDemoMode() ? [] : listGeminiModels()));

  /** Which providers can run now: installed subscription CLIs and saved API keys. */
  ipcMain.handle("ai:availability", async (): Promise<ProviderAvailability> => {
    if (isDemoMode())
      return {
        claude: false,
        codex: false,
        gemini: false,
        muse: false,
        ...(Object.fromEntries(API_PROVIDERS.map((provider) => [provider, false])) as Record<
          ApiProviderId,
          boolean
        >),
      };
    const [claude, codex, gemini, muse, keys] = await Promise.all([
      resolveCli("claude"),
      resolveCli("codex"),
      resolveCli("gemini"),
      resolveCli("muse"),
      getApiKeyStatuses(),
    ]);
    return {
      claude: Boolean(claude),
      codex: Boolean(codex),
      gemini: Boolean(gemini),
      muse: Boolean(muse),
      ...(Object.fromEntries(
        API_PROVIDERS.map((provider) => [provider, keys[provider].configured]),
      ) as Record<ApiProviderId, boolean>),
    };
  });

  // The Assistant's MCP servers, without secrets, and an on-demand connection check.
  ipcMain.handle("mcp:assistantServers", async (): Promise<AssistantMcpServerInfo[]> => {
    if (isDemoMode()) return [];
    const settings = await getSettings();
    const builtInId = getActiveAssistantMcpServerConfig()?.id;
    return resolveAssistantMcpServers(settings.ai.useMcpInAssistant, await getMcpServers()).map(
      (server, index) => ({
        id: server.id || `server-${index}`,
        name: server.name,
        builtIn: server.id === builtInId,
        transport: server.transport,
        target: describeTarget(server),
      }),
    );
  });
  ipcMain.handle("mcp:assistantCheck", async (): Promise<AssistantMcpCheck[]> => {
    if (isDemoMode()) return [];
    const settings = await getSettings();
    const servers = resolveAssistantMcpServers(
      settings.ai.useMcpInAssistant,
      await getMcpServers(),
    );
    return Promise.all(
      servers.map(async (server, index) => {
        const result = await testMcpServer(server).catch((error: unknown) => ({
          ok: false,
          tools: [] as string[],
          error: error instanceof Error ? error.message : String(error),
        }));
        return { id: server.id || `server-${index}`, ...result };
      }),
    );
  });

  ipcMain.handle("assistant:transcribe", async (_event, payload: unknown) => {
    const channel = "assistant:transcribe";
    assertNotDemo(channel);
    const input = asObject(payload, channel);
    const audio = requireString(input, "audio", channel, 30 * 1024 * 1024);
    const mimeType = typeof input.mimeType === "string" ? input.mimeType.slice(0, 80) : "audio/mp4";
    return { text: await transcribe(audio, mimeType) };
  });

  // One-shot generation through the selected CLI or API provider.
  ipcMain.handleStream<unknown, AIStreamChunk, { text: string; usage?: RequestUsage }>(
    "ai:run",
    async (payload, sendChunk, context) => {
      const channel = "ai:run";
      const input = asObject(payload, channel);
      const system = requireString(input, "system", channel);
      const prompt = requireString(input, "prompt", channel);
      if (isDemoMode()) {
        const text = demoCompletion(system, prompt);
        if (!context.signal.aborted) sendChunk({ type: "delta", text });
        return { text };
      }
      return runCompletion({ system, prompt, signal: context.signal, onChunk: sendChunk });
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
          snapshot:
            typeof input.snapshot === "string" ? clipSnapshot(input.snapshot, 400_000) : undefined,
          attachments: Array.isArray(input.attachments)
            ? input.attachments.filter((id): id is string => typeof id === "string").slice(0, 10)
            : [],
        },
        sendChunk,
        context.signal,
      );
    },
  );
}
