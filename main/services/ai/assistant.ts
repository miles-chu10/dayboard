import {
  aggregateStepUsage,
  tokenUsage,
  type RequestUsage,
  type TokenUsage,
} from "../../../shared/ai-usage.js";
import { oneLine } from "../../../shared/ai-snapshot.js";
import { apiPromptOptions, insertIntoSnapshot, withCurrentSnapshot } from "./prompt-cache.js";
import { stepCountIs, streamText, tool } from "ai";

import { logger } from "../../platform/index.js";

import type { AIStreamChunk, AssistantMessageInput, AssistantResult } from "../../shared-types.js";
import { demoAssistantReply, isDemoMode } from "../demo-data.js";
import { getMcpServers, getSettings } from "../settings-store.js";
import { isApiProvider } from "./api-keys.js";
import { apiLanguageModel, resolveApiModel } from "./api-providers.js";
import { attachmentContext } from "./attachments.js";
import { runCliCompletion, type CliUsage } from "./cli-providers.js";
import { listCodexModels } from "./codex-models.js";
import {
  claudeDisplayName,
  describeModel,
  modelSystemNote,
  rememberClaudeModel,
} from "./model-options.js";
import {
  effortProviderOptions,
  resolveAssistantEffort,
  withAssistantEffort,
  withProviderOptions,
} from "./assistant-effort.js";
import { resolveAssistantMcpServers } from "./assistant-mcp.js";
import { resolveConfiguredProvider } from "./provider-resolution.js";
import { openMcpSession, type McpSession } from "./mcp-client.js";
import { asError } from "./stream-error.js";

const ASSISTANT_TIMEOUT_MS = 5 * 60_000;

/**
 * The AI SDK recognizes schema objects by this registered symbol. MCP tools publish raw
 * JSON Schema, so wrap it directly instead of converting through zod.
 */
const AI_SCHEMA_SYMBOL = Symbol.for("vercel.ai.schema");

function jsonSchemaInput(schema: Record<string, unknown>) {
  return {
    [AI_SCHEMA_SYMBOL]: true,
    _type: undefined,
    jsonSchema: schema,
    validate: (value: unknown) => ({ success: true as const, value }),
  };
}

function transcript(messages: AssistantMessageInput[]): string {
  const history = messages.slice(0, -1);
  const latest = messages[messages.length - 1];
  const lines = history.map(
    (message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
  );
  return `${lines.length ? `Conversation so far:\n${lines.join("\n\n")}\n\n` : ""}User's latest message:\n${latest?.content ?? ""}`;
}

const MCP_HINT = "MCP tools are connected; use them when they help.";

/** MCP errors quote remote servers, so they are untrusted text inside the snapshot block. */
function mcpErrorSection(errors: string[]): string {
  return `## MCP servers\nCould not be reached (text reported by the servers): ${errors.map(oneLine).join("; ")}`;
}

/** The snapshot for an API request, with the MCP status folded in. */
function apiSnapshot(snapshot: string | undefined, session: McpSession | null): string | undefined {
  if (session?.errors.length) return insertIntoSnapshot(snapshot, mcpErrorSection(session.errors));
  if (session?.tools.length) return [snapshot, MCP_HINT].filter(Boolean).join("\n\n");
  return snapshot;
}

export async function runAssistant(
  params: {
    messages: AssistantMessageInput[];
    system: string;
    snapshot?: string;
    attachments?: string[];
  },
  send: (chunk: AIStreamChunk) => void,
  signal: AbortSignal,
): Promise<AssistantResult> {
  if (isDemoMode()) {
    const text = demoAssistantReply(params.messages[params.messages.length - 1]?.content ?? "");
    if (!signal.aborted) send({ type: "delta", text });
    return { text };
  }
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.providerChosen) return { blocked: "not-configured" };
  const provider = await resolveConfiguredProvider(
    settings.ai.assistantProvider || settings.ai.provider,
  );
  if (!provider) return { blocked: "not-configured" };
  const codexModels = provider === "codex" ? await listCodexModels().catch(() => []) : [];
  const apiModel = isApiProvider(provider)
    ? await resolveApiModel(provider, settings.ai)
    : undefined;
  // The composer's effort, checked against the model that will run; "" is the model default.
  const effort = resolveAssistantEffort(settings.ai, provider, codexModels, apiModel?.id);
  const model = describeModel(
    withAssistantEffort(settings.ai, provider, effort),
    codexModels,
    provider,
    apiModel,
  );
  send({ type: "meta", model });
  const attached = params.attachments?.length ? await attachmentContext(params.attachments) : "";
  if (attached) {
    const last = params.messages[params.messages.length - 1];
    params = {
      ...params,
      messages: [...params.messages.slice(0, -1), { ...last, content: last.content + attached }],
    };
  }
  const system = params.system + modelSystemNote(model);
  const messages = withCurrentSnapshot(params.messages, params.snapshot);
  let requestUsage: RequestUsage | undefined;
  let resolvedModelId: string | null = null;
  // Each route starts its clock immediately before the provider call, so setup work is not counted.
  const reportUsage = (usage: CliUsage, startedAt: number) => {
    requestUsage = {
      ...tokenUsage(usage),
      modelId: resolvedModelId,
      requestedModelId: model.id,
      route: provider,
      durationMs: Date.now() - startedAt,
    };
    send({
      type: "usage",
      ...requestUsage,
      inputTokens: requestUsage.inputTokens ?? usage.displayInputTokens ?? 0,
      outputTokens: requestUsage.outputTokens ?? 0,
      usage: requestUsage,
      contextWindow: model.contextWindow,
    });
  };
  // Antigravity and Muse have no per-run MCP configuration, so they answer from the snapshot alone.
  const servers =
    provider === "gemini" || provider === "muse"
      ? []
      : resolveAssistantMcpServers(
          settings.ai.useMcpInAssistant,
          settings.ai.useMcpInAssistant ? await getMcpServers() : [],
        );

  if (
    provider === "claude" ||
    provider === "codex" ||
    provider === "gemini" ||
    provider === "muse"
  ) {
    const startedAt = Date.now();
    const text = await runCliCompletion({
      provider,
      system: system + (servers.length ? `\n\n${MCP_HINT}` : ""),
      codexModel: provider === "codex" ? (model.id ?? undefined) : undefined,
      effort,
      onModel: (id) => {
        if (provider === "claude") rememberClaudeModel(settings.ai.claudeModel, id);
        resolvedModelId = id;
        const name =
          provider === "claude" ? claudeDisplayName(settings.ai.claudeModel, id) : model.name;
        send({ type: "meta", model: { ...model, id, name } });
      },
      onUsage: (usage) => reportUsage(usage, startedAt),
      prompt: transcript(messages),
      mcpServers: servers,
      signal,
      timeoutMs: ASSISTANT_TIMEOUT_MS,
      onDelta: (text) => send({ type: "delta", text }),
      onTool: (event) => send({ type: "tool", ...event }),
    });
    return { text, usage: requestUsage };
  }

  const session = servers.length ? await openMcpSession(servers) : null;
  try {
    const displayNames = new Map(
      session?.tools.map((handle) => [handle.qualifiedName, `${handle.server}: ${handle.tool}`]),
    );
    const tools = Object.fromEntries(
      (session?.tools ?? []).map((handle) => [
        handle.qualifiedName,
        tool({
          description: `[${handle.server}] ${handle.description}`.slice(0, 1000),
          inputSchema: jsonSchemaInput(handle.inputSchema) as never,
          execute: async (args: unknown) => handle.call(args),
        }),
      ]),
    );

    // The CLI branch above returns first, so reaching here means an API-key provider.
    if (!apiModel || !isApiProvider(provider))
      throw new Error(`No model available for ${provider}.`);
    const languageModel = await apiLanguageModel(provider, apiModel.id);
    const startedAt = Date.now();
    const result = streamText({
      model: languageModel,
      ...withProviderOptions(
        apiPromptOptions(
          provider,
          apiModel?.id ?? "",
          system,
          withCurrentSnapshot(params.messages, apiSnapshot(params.snapshot, session)),
          "implicit",
        ),
        effortProviderOptions(provider, effort),
      ),
      tools,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 4000,
      abortSignal: signal,
    });

    let text = "";
    const steps: TokenUsage[] = [];
    for await (const rawPart of result.fullStream) {
      const part = rawPart as {
        type: string;
        text?: string;
        textDelta?: string;
        toolCallId?: string;
        toolName?: string;
        error?: unknown;
        usage?: Parameters<typeof tokenUsage>[0];
        response?: { modelId?: string };
      };
      switch (part.type) {
        case "text-delta": {
          const delta = part.text ?? part.textDelta ?? "";
          text += delta;
          send({ type: "delta", text: delta });
          break;
        }
        case "start-step":
          if (text && !text.endsWith("\n\n")) {
            text += "\n\n";
            send({ type: "delta", text: "\n\n" });
          }
          break;
        case "tool-call":
          send({
            type: "tool",
            id: part.toolCallId ?? "",
            name: displayNames.get(part.toolName ?? "") ?? part.toolName,
            status: "running",
          });
          break;
        case "tool-result":
          send({ type: "tool", id: part.toolCallId ?? "", status: "success" });
          break;
        case "tool-error":
          send({ type: "tool", id: part.toolCallId ?? "", status: "error" });
          break;
        case "finish-step":
          steps.push(tokenUsage(part.usage ?? {}, provider));
          if (part.response?.modelId) resolvedModelId = part.response.modelId;
          break;
        case "finish":
          reportUsage(aggregateStepUsage(steps), startedAt);
          break;
        case "error":
          throw asError(part.error);
      }
    }
    return { text, usage: requestUsage };
  } catch (error) {
    logger.error("ai", "Assistant request failed", error);
    throw error;
  } finally {
    await session?.close();
  }
}
