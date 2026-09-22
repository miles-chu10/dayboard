import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "@glaze/core/backend";

import type { McpServerConfig, McpTestResult } from "../../shared-types.js";
import { getToolEnv, toStringEnv } from "../shell-env.js";

const CONNECT_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 60_000;
const MAX_TOOL_OUTPUT = 12_000;

export interface McpToolHandle {
  server: string;
  tool: string;
  /** Unique, model-safe tool name. */
  qualifiedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: unknown) => Promise<string>;
}

export interface McpSession {
  tools: McpToolHandle[];
  errors: string[];
  close: () => Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface McpConnection {
  client: Client;
  close: () => Promise<void>;
}

async function connect(server: McpServerConfig): Promise<McpConnection> {
  const client = new Client({ name: "dashboard", version: "1.0.0" });
  const transport =
    server.transport === "stdio"
      ? new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: { ...toStringEnv(await getToolEnv()), ...server.env },
          stderr: "ignore",
        })
      : new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: server.headers },
        });
  const close = async () => {
    if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
      await withTimeout(
        transport.terminateSession(),
        5_000,
        "MCP session cleanup timed out.",
      ).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  };
  try {
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `Timed out connecting to ${server.name}.`,
    );
  } catch (error) {
    await close();
    throw error;
  }
  return { client, close };
}

function formatToolResult(result: unknown): string {
  const record = (typeof result === "object" && result !== null ? result : {}) as {
    content?: unknown;
    isError?: unknown;
    structuredContent?: unknown;
  };
  const parts = Array.isArray(record.content)
    ? record.content.map((part: unknown) => {
        const item = (typeof part === "object" && part !== null ? part : {}) as {
          type?: unknown;
          text?: unknown;
        };
        return item.type === "text" && typeof item.text === "string"
          ? item.text
          : JSON.stringify(part);
      })
    : [];
  if (!parts.length && record.structuredContent !== undefined)
    parts.push(JSON.stringify(record.structuredContent));
  const text = parts.join("\n").slice(0, MAX_TOOL_OUTPUT);
  return record.isError ? `Tool error: ${text}` : text || "(no output)";
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function openMcpSession(servers: McpServerConfig[]): Promise<McpSession> {
  const connections: McpConnection[] = [];
  const tools: McpToolHandle[] = [];
  const errors: string[] = [];
  const used = new Set<string>();

  await Promise.all(
    servers.map(async (server) => {
      try {
        const connection = await connect(server);
        connections.push(connection);
        const { client } = connection;
        const listed = await withTimeout(
          client.listTools(),
          CONNECT_TIMEOUT_MS,
          `Timed out listing tools from ${server.name}.`,
        );
        for (const tool of listed.tools) {
          let qualifiedName = safeName(`${server.name}_${tool.name}`).slice(0, 60) || "tool";
          for (let suffix = 2; used.has(qualifiedName); suffix++)
            qualifiedName = `${qualifiedName.slice(0, 56)}_${suffix}`;
          used.add(qualifiedName);
          tools.push({
            server: server.name,
            tool: tool.name,
            qualifiedName,
            description: tool.description ?? "",
            inputSchema: {
              type: "object",
              properties: {},
              ...(tool.inputSchema as Record<string, unknown>),
            },
            call: async (args) => {
              const result = await withTimeout(
                client.callTool({
                  name: tool.name,
                  arguments:
                    typeof args === "object" && args !== null
                      ? (args as Record<string, unknown>)
                      : {},
                }),
                TOOL_TIMEOUT_MS,
                `${server.name} took too long to respond.`,
              );
              return formatToolResult(result);
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("mcp", `Could not connect to MCP server ${server.name}`, { message });
        errors.push(`${server.name}: ${message}`);
      }
    }),
  );

  return {
    tools,
    errors,
    close: async () => {
      await Promise.all(connections.map((connection) => connection.close()));
    },
  };
}

export async function testMcpServer(server: McpServerConfig): Promise<McpTestResult> {
  const session = await openMcpSession([server]);
  try {
    if (session.errors.length) return { ok: false, tools: [], error: session.errors[0] };
    return { ok: true, tools: session.tools.map((tool) => tool.tool), error: null };
  } finally {
    await session.close();
  }
}
