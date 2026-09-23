import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  Field,
  FieldGroup,
  FieldSet,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Status,
  Switch,
  Textarea,
  toast,
} from "@renderer/ui";
import type { McpServerConfig, McpTestResult } from "@main/shared-types";

import { errorMessage, invoke } from "../lib/ipc";
import { queryKeys, useMcpServers } from "../lib/queries";
import { featureOn, useSettingsEditor } from "../lib/settings";

function describeServer(server: McpServerConfig): string {
  const target =
    server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url;
  return target.length > 90 ? `${target.slice(0, 87)}…` : target;
}

function formatPairs(values: Record<string, string>, separator: string): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

function parsePairs(text: string, separator: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (key) result[key] = line.slice(index + separator.length).trim();
  }
  return result;
}

type BuiltInMcpStatus = {
  state: "unavailable" | "checking" | "ready" | "error";
  ok: boolean;
  toolCount: number;
};

function McpServerDialog({
  server,
  onClose,
}: {
  server: McpServerConfig | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<McpServerConfig["transport"]>(
    server?.transport ?? "stdio",
  );
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState(server?.args.join("\n") ?? "");
  const [env, setEnv] = useState(formatPairs(server?.env ?? {}, "="));
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState(formatPairs(server?.headers ?? {}, ": "));
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const ready =
    Boolean(name.trim()) && (transport === "stdio" ? Boolean(command.trim()) : Boolean(url.trim()));

  const config = (): McpServerConfig => ({
    id: server?.id ?? "",
    name: name.trim(),
    enabled: server?.enabled ?? true,
    transport,
    command: command.trim(),
    args: args
      .split("\n")
      .map((arg) => arg.trim())
      .filter(Boolean),
    env: parsePairs(env, "="),
    url: url.trim(),
    headers: parsePairs(headers, ":"),
  });

  async function save() {
    try {
      const servers = await invoke<McpServerConfig[]>("mcp:save", config());
      queryClient.setQueryData(queryKeys.mcpServers, servers);
      toast.success(`Saved ${name.trim()}`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await invoke<McpTestResult>("mcp:test", config()));
    } catch (error) {
      setTestResult({ ok: false, tools: [], error: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!server) return;
    try {
      const servers = await invoke<McpServerConfig[]>("mcp:delete", { id: server.id });
      queryClient.setQueryData(queryKeys.mcpServers, servers);
      toast.success(`Removed ${server.name}`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="large"
      title={server ? "Edit MCP Server" : "Add MCP Server"}
      description="Tools from this server become available to the Assistant."
      confirmLabel="Save"
      confirmDisabled={!ready}
      onConfirm={save}
      destructiveAction={server ? { label: "Remove", onClick: remove } : undefined}
    >
      <div className="flex flex-col gap-4">
        <FieldGroup>
          <Field label="Name">
            <Input
              className="w-72"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. notion"
              autoFocus
            />
          </Field>
          <Field label="Type">
            <SegmentedControl
              size="small"
              value={transport}
              onValueChange={(value: string) => setTransport(value as McpServerConfig["transport"])}
              aria-label="Server type"
            >
              <SegmentedControlItem value="stdio">Local Command</SegmentedControlItem>
              <SegmentedControlItem value="http">Remote URL</SegmentedControlItem>
            </SegmentedControl>
          </Field>
          {transport === "stdio" ? (
            <Field label="Command">
              <Input
                className="w-72"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                spellCheck={false}
              />
            </Field>
          ) : (
            <Field label="URL">
              <Input
                className="w-72"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                spellCheck={false}
              />
            </Field>
          )}
        </FieldGroup>

        {transport === "stdio" ? (
          <>
            <Field orientation="vertical" label="Arguments" description="One per line.">
              <Textarea
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/Users/you/Documents"}
                spellCheck={false}
              />
            </Field>
            <Field
              orientation="vertical"
              label="Environment"
              description="KEY=value, one per line. Stored encrypted."
            >
              <Textarea
                value={env}
                onChange={(event) => setEnv(event.target.value)}
                placeholder="API_TOKEN=…"
                spellCheck={false}
              />
            </Field>
          </>
        ) : (
          <Field
            orientation="vertical"
            label="Headers"
            description="Header: value, one per line. Stored encrypted."
          >
            <Textarea
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              placeholder="Authorization: Bearer …"
              spellCheck={false}
            />
          </Field>
        )}

        <div className="flex items-center gap-3">
          <Button size="small" onClick={() => void test()} disabled={!ready || testing}>
            Test Connection
          </Button>
          {testing ? <Status variant="loading">Connecting…</Status> : null}
        </div>
        {testResult ? (
          testResult.ok ? (
            <Callout color="green">
              {`Connected with ${testResult.tools.length} ${testResult.tools.length === 1 ? "tool" : "tools"}${
                testResult.tools.length
                  ? `: ${testResult.tools.slice(0, 8).join(", ")}${testResult.tools.length > 8 ? ", …" : ""}`
                  : ""
              }`}
            </Callout>
          ) : (
            <Callout color="red">{testResult.error ?? "Couldn't connect."}</Callout>
          )
        ) : null}
      </div>
    </Dialog>
  );
}

type McpClientKind = "claude" | "codex" | "json";

const CLIENT_COPIED: Record<McpClientKind, string> = {
  claude: "Claude Code command copied. Run it in Terminal.",
  codex: "Codex setup copied. Paste it into ~/.codex/config.toml.",
  json: "MCP JSON copied. Paste it into your client's MCP settings.",
};

/** Local endpoint for external MCP clients; off by default and keyed. */
function ExternalMcpSettings() {
  const { settings, edit } = useSettingsEditor();
  const info = useQuery({
    queryKey: ["mcp-external"],
    queryFn: () => invoke<{ url: string | null }>("mcp:externalInfo"),
  });
  const copy = useMutation({
    mutationFn: (client: McpClientKind) => invoke("mcp:copyExternalSetup", { client }),
    onSuccess: (_result, client) => toast.success(CLIENT_COPIED[client]),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const regenerate = useMutation({
    mutationFn: () => invoke("mcp:regenerateExternalKey"),
    onSuccess: () => toast.success("New access key created. Copy the setup again for each client."),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!settings) return null;
  const { enabled, allowWrites } = settings.mcpServer;

  return (
    <FieldSet
      title="Dayboard MCP Server"
      description="Let Claude Code, Codex, and other MCP clients on this Mac use your Dayboard sources while the app is running. Clients need your access key."
    >
      <Field
        label="Allow MCP clients"
        description={enabled ? (info.data?.url ?? "Starting…") : "Off. Clients can't connect."}
      >
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.mcpServer.enabled = checked;
            })
          }
          aria-label="Allow MCP clients"
        />
      </Field>
      <Field
        label="Allow changes"
        description="Let clients add and complete tasks and reminders, create events, save reply drafts, and archive email. Off keeps clients read-only."
        disabled={!enabled}
      >
        <Switch
          checked={allowWrites}
          disabled={!enabled}
          onCheckedChange={(checked) =>
            edit((draft) => {
              draft.mcpServer.allowWrites = checked;
            })
          }
          aria-label="Allow MCP clients to make changes"
        />
      </Field>
      {enabled ? (
        <>
          <Field
            label="Connect a client"
            description="Copies setup that includes your access key. Keep it private."
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="small" onClick={() => copy.mutate("claude")} disabled={copy.isPending}>
                Claude Code
              </Button>
              <Button size="small" onClick={() => copy.mutate("codex")} disabled={copy.isPending}>
                Codex
              </Button>
              <Button size="small" onClick={() => copy.mutate("json")} disabled={copy.isPending}>
                JSON
              </Button>
            </div>
          </Field>
          <Field
            label="Access key"
            description="A new key disconnects every client until you copy the setup again."
          >
            <Button
              size="small"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              New Key
            </Button>
          </Field>
        </>
      ) : null}
    </FieldSet>
  );
}

export function McpTab() {
  const queryClient = useQueryClient();
  const { settings, edit } = useSettingsEditor();
  const servers = useMcpServers();
  const [editing, setEditing] = useState<McpServerConfig | "new" | null>(null);
  const [builtInStatus, setBuiltInStatus] = useState<BuiltInMcpStatus | null>(null);
  const [testingBuiltIn, setTestingBuiltIn] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke<BuiltInMcpStatus>("mcp:assistantStatus")
      .then((status) => {
        if (active) setBuiltInStatus(status);
      })
      .catch(() => {
        if (active) setBuiltInStatus({ state: "error", ok: false, toolCount: 0 });
      });
    return () => {
      active = false;
    };
  }, []);

  async function testBuiltIn() {
    setTestingBuiltIn(true);
    try {
      const status = await invoke<BuiltInMcpStatus>("mcp:assistantTest");
      setBuiltInStatus(status);
      if (status.ok) toast.success("Dayboard MCP connected");
      else toast.error("Dayboard MCP connection failed");
    } catch (error) {
      setBuiltInStatus({ state: "error", ok: false, toolCount: 0 });
      toast.error(errorMessage(error));
    } finally {
      setTestingBuiltIn(false);
    }
  }

  const toggle = useMutation({
    mutationFn: (server: McpServerConfig) => invoke<McpServerConfig[]>("mcp:save", server),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.mcpServers, next),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <FieldSet
        title="MCP Servers"
        description="Connect Model Context Protocol servers so the Assistant can use their tools with Claude or ChatGPT."
      >
        <Field
          label="Dayboard"
          description="Built into the Assistant while this app is running. It can read tasks, reminders, inbox, email, calendar, and weekly review data."
        >
          <div className="flex items-center gap-3">
            <Status
              variant={
                builtInStatus?.state === "checking"
                  ? "loading"
                  : builtInStatus?.ok
                    ? "success"
                    : builtInStatus?.state === "error"
                      ? "error"
                      : "neutral"
              }
            >
              {builtInStatus?.state === "checking"
                ? "Checking…"
                : builtInStatus?.ok
                  ? `${builtInStatus.toolCount} read-only tools`
                  : builtInStatus?.state === "error"
                    ? "Unavailable"
                    : "Starting…"}
            </Status>
            <Button size="small" onClick={() => void testBuiltIn()} disabled={testingBuiltIn}>
              Test Connection
            </Button>
          </div>
        </Field>
        {settings ? (
          <Field
            label="Use MCP tools in Assistant"
            description={
              featureOn(settings, "assistant")
                ? "Let the Assistant use Dayboard tools and your enabled servers."
                : "Turn on the Assistant in the AI tab to use these tools."
            }
          >
            <Switch
              checked={settings.ai.useMcpInAssistant}
              onCheckedChange={(checked) =>
                edit((draft) => {
                  draft.ai.useMcpInAssistant = checked;
                })
              }
              aria-label="Use MCP tools in Assistant"
            />
          </Field>
        ) : (
          <Status variant="loading">Loading…</Status>
        )}
      </FieldSet>

      <ExternalMcpSettings />

      <FieldSet title="Custom servers">
        {servers.isPending ? (
          <Field label="Servers">
            <Status variant="loading">Loading…</Status>
          </Field>
        ) : servers.isError ? (
          <Field label="Servers" description={errorMessage(servers.error)} />
        ) : servers.data.length === 0 ? (
          <Field
            label="No custom servers"
            description="Dayboard tools are already included. Add other services here."
          />
        ) : (
          servers.data.map((server) => (
            <Field key={server.id} label={server.name} description={describeServer(server)}>
              <div className="flex items-center gap-3">
                <Button size="small" onClick={() => setEditing(server)}>
                  Edit
                </Button>
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(checked) => toggle.mutate({ ...server, enabled: checked })}
                  aria-label={`Enable ${server.name}`}
                />
              </div>
            </Field>
          ))
        )}
        <Field>
          <Button onClick={() => setEditing("new")}>Add Server…</Button>
        </Field>
      </FieldSet>

      {editing ? (
        <McpServerDialog
          key={editing === "new" ? "new" : editing.id}
          server={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
