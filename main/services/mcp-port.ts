// The standalone package has no Glaze project id. Keep the local MCP port stable across builds:
// clients set up from Settings point at port 54809.
export const MCP_PROJECT_ID = "com.mileschu.dayboard";

export function stableMcpPort(projectId: string): number {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 49152 + (hash % 16000);
}

/** A dev, test or QA profile gets its own port, so it can never answer the installed app's clients. */
export function mcpProjectIdForProfile(isolatedProfile: string | undefined): string {
  return isolatedProfile ? `${MCP_PROJECT_ID}:${isolatedProfile}` : MCP_PROJECT_ID;
}
