import type { McpToolHandle } from "./mcp-client.js";

type DiscoveredTool = Omit<McpToolHandle, "qualifiedName"> & { serverId: string };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Finish discovery before assigning collision suffixes; network completion order is unstable. */
export function orderMcpTools(discovered: DiscoveredTool[]): McpToolHandle[] {
  const used = new Set<string>();
  return discovered
    .map((handle) => ({
      ...handle,
      inputSchema: canonical(handle.inputSchema) as Record<string, unknown>,
    }))
    .sort(
      (a, b) =>
        compare(a.server, b.server) ||
        compare(a.serverId, b.serverId) ||
        compare(a.tool, b.tool) ||
        compare(JSON.stringify(a.inputSchema), JSON.stringify(b.inputSchema)) ||
        compare(a.description, b.description),
    )
    .map(({ serverId: _serverId, ...handle }) => {
      const base =
        `${handle.server}_${handle.tool}`
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 60) || "tool";
      let qualifiedName = base;
      for (let suffix = 2; used.has(qualifiedName); suffix++)
        qualifiedName = `${base.slice(0, 56)}_${suffix}`;
      used.add(qualifiedName);
      return { ...handle, qualifiedName };
    });
}
