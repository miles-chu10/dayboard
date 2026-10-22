import type { McpServerConfig } from "../../shared-types.js";

type Listener = (server: McpServerConfig, tools: string[]) => void;
const listeners = new Set<Listener>();

/** A successful Settings → MCP test, so features can learn what a server offers without launching it. */
export function onMcpServerTested(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mcpServerTested(server: McpServerConfig, tools: string[]): void {
  for (const listener of listeners) listener(server, tools);
}
