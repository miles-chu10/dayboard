import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Callout, Dialog, Status, Text } from "@glaze/core/components";
import { Server } from "lucide-react";
import type { AssistantMcpCheck, AssistantMcpServerInfo } from "@main/shared-types";

import { invoke, openSettings } from "../lib/ipc";

export function useAssistantMcpServers() {
  return useQuery({
    queryKey: ["assistant-mcp-servers"],
    queryFn: () => invoke<AssistantMcpServerInfo[]>("mcp:assistantServers"),
    staleTime: 30_000,
  });
}

/** Live connection check (tool lists) for the Assistant's MCP servers, shared by the sidebar and dialog. */
export function useAssistantMcpCheck(enabled: boolean) {
  return useQuery({
    queryKey: ["assistant-mcp-check"],
    queryFn: () => invoke<AssistantMcpCheck[]>("mcp:assistantCheck"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The MCP servers the Assistant will connect to, with a live connection check. */
export function McpServersDialog({
  open,
  onOpenChange,
  providerNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerNote?: string | null;
}) {
  const servers = useAssistantMcpServers();
  const check = useAssistantMcpCheck(open && Boolean(servers.data?.length));
  const results = new Map(check.data?.map((result) => [result.id, result]));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="MCP Servers"
      description="Tools the Assistant can use while answering."
      confirmLabel="Done"
      onConfirm={() => onOpenChange(false)}
    >
      <div className="flex flex-col gap-3">
        {providerNote ? <Callout color="orange">{providerNote}</Callout> : null}
        {servers.data?.length ? (
          <div className="flex flex-col divide-y divide-separator rounded-lg bg-well">
            {servers.data.map((server) => {
              const result = results.get(server.id);
              return (
                <div key={server.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Server className="size-4 shrink-0 text-secondary" aria-hidden="true" />
                    <Text variant="strong" truncate className="min-w-0 flex-1">
                      {server.name}
                    </Text>
                    {server.builtIn ? <Badge color="blue">Built-in</Badge> : null}
                    {check.isFetching && !result ? (
                      <Status variant="loading">Checking…</Status>
                    ) : result ? (
                      <Status variant={result.ok ? "success" : "error"}>
                        {result.ok
                          ? `Connected · ${result.tools.length} ${result.tools.length === 1 ? "tool" : "tools"}`
                          : "Unavailable"}
                      </Status>
                    ) : null}
                  </div>
                  <Text variant="small" color="tertiary" truncate>
                    {server.transport === "http" ? "HTTP" : "Local command"} · {server.target}
                  </Text>
                  {result?.ok && result.tools.length ? (
                    <Text variant="small" color="secondary" className="break-words">
                      {result.tools.join(", ")}
                    </Text>
                  ) : null}
                  {result && !result.ok && result.error ? (
                    <Text variant="small" color="red" className="break-words">
                      {result.error}
                    </Text>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Text color="secondary">
            {servers.isPending
              ? "Loading…"
              : "No MCP servers are connected. Turn on “Use in Assistant” or add servers in Settings → MCP Servers."}
          </Text>
        )}
        <div className="flex gap-2">
          <Button
            size="small"
            onClick={() => void check.refetch()}
            disabled={!servers.data?.length || check.isFetching}
          >
            Check Again
          </Button>
          <Button size="small" variant="transparent" onClick={() => void openSettings()}>
            Manage Servers…
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
