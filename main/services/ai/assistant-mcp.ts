import type { McpServerConfig } from "../../shared-types.js";
import { getActiveAssistantMcpServerConfig } from "../mcp-http-server.js";

function isDashboardLoopbackMcp(server: McpServerConfig, builtIn: McpServerConfig): boolean {
  if (server.transport !== "http") return false;
  try {
    const target = new URL(server.url);
    const assistant = new URL(builtIn.url);
    return (
      target.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
      target.port === assistant.port &&
      ["/mcp", "/mcp/", "/assistant-mcp", "/assistant-mcp/"].includes(target.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Builds the Assistant-only MCP configuration. The bearer value originates in the
 * backend process and is never saved with the user's editable MCP server list.
 */
export function resolveAssistantMcpServers(
  useMcpInAssistant: boolean,
  savedServers: McpServerConfig[],
  builtIn = getActiveAssistantMcpServerConfig(),
): McpServerConfig[] {
  if (!useMcpInAssistant) return [];
  const enabledServers = savedServers.filter((server) => server.enabled);
  if (!builtIn) return enabledServers;
  return [builtIn, ...enabledServers.filter((server) => !isDashboardLoopbackMcp(server, builtIn))];
}
