import { GlazeAIError, glaze, stepCountIs, streamText, tool } from "@glaze/core/ai";
import { logger } from "@glaze/core/backend";

import type { AIStreamChunk, AssistantMessageInput, AssistantResult } from "../../shared-types.js";
import { demoAssistantReply, isDemoMode } from "../demo-data.js";
import { getMcpServers, getSettings } from "../settings-store.js";
import { isApiProvider } from "./api-keys.js";
import { apiLanguageModel, resolveApiModel } from "./api-providers.js";
import { attachmentContext } from "./attachments.js";
import { runCliCompletion } from "./cli-providers.js";
import { listCodexModels } from "./codex-models.js";
import { describeModel, modelSystemNote, rememberClaudeModel } from "./model-options.js";
import { resolveAssistantMcpServers } from "./assistant-mcp.js";
import { openMcpSession, type McpSession } from "./mcp-client.js";

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

function mcpNote(session: McpSession | null, cliServers: number): string {
  if (session?.errors.length)
    return `\n\nSome MCP servers could not be reached: ${session.errors.join("; ")}`;
  if (session?.tools.length || cliServers)
    return "\n\nMCP tools are connected; use them when they help.";
  return "";
}

export async function runAssistant(
  params: { messages: AssistantMessageInput[]; system: string; attachments?: string[] },
  send: (chunk: AIStreamChunk) => void,
  signal: AbortSignal,
): Promise<AssistantResult> {
  if (isDemoMode()) {
    const text = demoAssistantReply(params.messages[params.messages.length - 1]?.content ?? "");
    if (!signal.aborted) send({ type: "delta", text });
    return { text };
  }
  const settings = await getSettings();
  const provider = settings.ai.assistantProvider || settings.ai.provider;
  const codexModels = provider === "codex" ? await listCodexModels().catch(() => []) : [];
  const apiModel = isApiProvider(provider)
    ? await resolveApiModel(provider, settings.ai)
    : undefined;
  const model = describeModel(settings.ai, codexModels, provider, apiModel);
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
  const reportUsage = (usage: { inputTokens: number; outputTokens: number }) =>
    send({ type: "usage", ...usage, contextWindow: model.contextWindow });
  // Antigravity has no per-run MCP configuration, so it answers from the snapshot alone.
  const servers =
    provider === "gemini"
      ? []
      : resolveAssistantMcpServers(
          settings.ai.useMcpInAssistant,
          settings.ai.useMcpInAssistant ? await getMcpServers() : [],
        );

  if (provider === "claude" || provider === "codex" || provider === "gemini") {
    const text = await runCliCompletion({
      provider,
      system: system + mcpNote(null, servers.length),
      codexModel: provider === "codex" ? (model.id ?? undefined) : undefined,
      onModel: (id) => {
        if (provider === "claude") rememberClaudeModel(settings.ai.claudeModel, id);
        send({ type: "meta", model: { ...model, id } });
      },
      onUsage: reportUsage,
      prompt: transcript(params.messages),
      mcpServers: servers,
      signal,
      timeoutMs: ASSISTANT_TIMEOUT_MS,
      onDelta: (text) => send({ type: "delta", text }),
      onTool: (event) => send({ type: "tool", ...event }),
    });
    return { text };
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

    const result = streamText({
      model:
        apiModel && isApiProvider(provider)
          ? await apiLanguageModel(provider, apiModel.id)
          : glaze("fast"),
      system: system + mcpNote(session, 0),
      messages: params.messages,
      tools,
      stopWhen: stepCountIs(8),
      maxOutputTokens: apiModel ? 4000 : 1500,
      abortSignal: signal,
    });

    let text = "";
    for await (const rawPart of result.fullStream) {
      const part = rawPart as {
        type: string;
        text?: string;
        textDelta?: string;
        toolCallId?: string;
        toolName?: string;
        error?: unknown;
        totalUsage?: { inputTokens?: number; outputTokens?: number };
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
        case "finish":
          if (part.totalUsage)
            reportUsage({
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            });
          break;
        case "error":
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
    return { text };
  } catch (error) {
    if (error instanceof GlazeAIError) return { blocked: error.state };
    logger.error("ai", "Assistant request failed", error);
    throw error;
  } finally {
    await session?.close();
  }
}
