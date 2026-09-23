import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import { request } from "node:http";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
let bundleSequence = 0;

const backendStub = `
export const ipcMain = { broadcast(...args) { (globalThis.__mcpBroadcasts ??= []).push(args); } };
export const logger = { error() {}, warn() {}, info() {} };
`;

const googleStub = `
export async function createEvent() { throw new Error("write should not run"); }
export async function createReplyDraft() { throw new Error("write should not run"); }
export async function createTask() { throw new Error("write should not run"); }
export async function getMessageBody() { return "body"; }
export async function listCompletedTasks() { return []; }
export async function listEvents() { return []; }
export async function listEventsBetween() { return []; }
export async function listInbox() { return []; }
export async function listTasks() { return []; }
export async function modifyMessage() { throw new Error("write should not run"); }
export async function setTaskCompleted() { throw new Error("write should not run"); }
`;

const authStub = `export class GoogleAuthError extends Error {} export const getGoogleStatus = async () => globalThis.__mcpGoogleStatus ?? ({ connected: false, email: null });`;
const remindersStub = `
export async function createReminder() { throw new Error("write should not run"); }
export async function getRemindersAccess() { return "full-access"; }
export async function listCompletedReminders() { return []; }
export async function listReminders() { return []; }
export async function setReminderCompleted(ref, completed) {
  if (!globalThis.__mcpReminderResult) throw new Error("write should not run");
  return { ...globalThis.__mcpReminderResult, ref, completed };
}
`;
const settingsStub = `
export async function getSettings() {
  return {
    sources: { tasks: { enabled: true }, reminders: { enabled: true }, mail: { enabled: true }, calendar: { enabled: true } },
    mail: { maxMessages: 25 },
    calendar: { range: "next-7-days", visibility: {} },
    mcpServer: globalThis.__mcpServerSettings ?? { enabled: true, allowWrites: true },
  };
}
`;
const accessKeyStub = `
export async function getMcpAccessKey() { return "fixture-key"; }
export async function isValidMcpBearer(header) { return header === "Bearer fixture-key"; }
`;
const EXTERNAL_AUTH = { authorization: "Bearer fixture-key" };
const calendarRangeStub = `export function calendarRangeDays() { return 7; }`;

function mcpPlugin() {
  const stubs = new Map([
    ["@glaze/core/backend", backendStub],
    ["./google-api.js", googleStub],
    ["./google-auth.js", authStub],
    ["./apple-reminders.js", remindersStub],
    ["./settings-store.js", settingsStub],
    ["./mcp-access-key.js", accessKeyStub],
    ["./calendar-range.js", calendarRangeStub],
    ["./demo-data.js", `export const isDemoMode = () => false;`],
    ["./agenda-store.js", `export const reconcileAgendaKeys = async () => {
      if (globalThis.__mcpReconcileError) throw new Error("agenda state is temporarily unavailable");
      return { changed: false, state: { focusKeys: [], duplicateLinks: [], scheduledBlocks: [] } };
    };`],
  ]);
  return {
    name: "mcp-built-in-fixtures",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (stubs.has(args.path)) return { path: args.path, namespace: "mcp-fixture" };
        return undefined;
      });
      buildApi.onLoad({ filter: /.*/, namespace: "mcp-fixture" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function loadMcpHarness() {
  const result = await build({
    entryPoints: [path.join(root, "main/services/mcp-http-server.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [mcpPlugin()],
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function loadResolverHarness() {
  const builtIn = {
    id: "dashboard-assistant-readonly",
    name: "Dashboard",
    enabled: true,
    transport: "http",
    command: "",
    args: [],
    env: {},
    url: "http://127.0.0.1:62895/assistant-mcp",
    headers: { Authorization: "Bearer fixture" },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/services/ai/assistant-mcp.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "assistant-mcp-fixture",
        setup(buildApi) {
          buildApi.onResolve({ filter: /mcp-http-server\.js$/ }, () => ({
            path: "mcp-http-server",
            namespace: "assistant-mcp-fixture",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "assistant-mcp-fixture" }, () => ({
            contents: `export function getActiveAssistantMcpServerConfig() { return ${JSON.stringify(builtIn)}; }`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  return { module: await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`), builtIn };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function rawRequest(port, headers, requestPath = "/assistant-mcp") {
  return rawMcpRequest(
    port,
    headers,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    requestPath,
  ).then(({ status }) => status);
}

function rawMcpRequest(port, headers, body, requestPath = "/assistant-mcp") {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...headers,
      },
    });
    client.on("response", (response) => {
      let text = "";
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode, body: text }));
    });
    client.on("error", reject);
    client.end(JSON.stringify(body));
  });
}

test("Assistant MCP exposes exactly six read-only tools and rejects unauthenticated or foreign requests", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  try {
    const config = module.getAssistantMcpServerConfig("fixture");
    const url = new URL(`http://127.0.0.1:${port}/assistant-mcp`);
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: config.headers },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ["get_weekly_review", "list_events", "list_inbox", "list_reminders", "list_tasks", "read_email"],
      );
      const write = await client.callTool({ name: "create_task", arguments: { title: "nope" } });
      assert.equal(write.isError, true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }

    const externalClient = new Client({ name: "external-mcp-test", version: "1.0.0" });
    try {
      await externalClient.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: EXTERNAL_AUTH },
        }),
      );
      assert.equal((await externalClient.listTools()).tools.length, 14);
    } finally {
      await externalClient.close();
    }

    assert.equal(await rawRequest(port, {}), 401);
    assert.equal(await rawRequest(port, { origin: "https://example.test" }), 403);
    assert.equal(await rawRequest(port, { host: "example.test" }), 403);

    const clientBuild = await build({
      entryPoints: [path.join(root, "main/services/ai/mcp-client.ts")],
      bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
      plugins: [{ name: "offline-client", setup(api) {
        api.onResolve({ filter: /^@modelcontextprotocol\/sdk\/client\/stdio\.js$/ }, () => ({ path: "stdio", namespace: "offline-client" }));
        api.onResolve({ filter: /^@glaze\/core\/backend$|shell-env\.js$/ }, (args) => ({ path: args.path, namespace: "offline-client" }));
        api.onLoad({ filter: /.*/, namespace: "offline-client" }, (args) => ({ contents: args.path === "stdio" ? 'export class StdioClientTransport { constructor() { throw new Error("No stdio processes in this fixture"); } }' : `${backendStub}\nexport const getToolEnv = async () => ({}); export const toStringEnv = (env) => env;`, loader: "js" }));
      } }],
    });
    const { openMcpSession } = await import(`data:text/javascript;base64,${Buffer.from(clientBuild.outputFiles[0].text).toString("base64")}`).catch((error) => { throw new Error(error.message); });
    let sessionId;
    server.on("request", (request) => { if (request.headers["mcp-session-id"]) sessionId = request.headers["mcp-session-id"]; });
    const session = await openMcpSession([{ ...config, url: url.toString() }]);
    assert.equal(session.tools.length, 6);
    const previousSessionId = sessionId;
    assert.ok(previousSessionId);
    await session.close();
    const terminated = await rawMcpRequest(port, { ...config.headers, "mcp-session-id": previousSessionId }, { jsonrpc: "2.0", id: 4, method: "tools/list" });
    assert.equal(terminated.status, 400, "closing an HTTP client must invalidate its server session");
  } finally {
    await close(server);
  }
});

test("Assistant MCP resolver honors the global switch and replaces same-app write-capable loopback configs", async () => {
  const { module, builtIn } = await loadResolverHarness();
  const sameApp = { ...builtIn, id: "saved-dashboard", url: "http://localhost:62895/mcp/", headers: {} };
  const savedAssistant = { ...builtIn, id: "saved-assistant", url: "http://[::1]:62895/assistant-mcp/" };
  const external = { ...builtIn, id: "external", name: "External", url: "https://example.test/mcp" };
  const disabled = { ...external, id: "disabled", enabled: false };
  const saved = [sameApp, savedAssistant, external, disabled];
  const before = globalThis.structuredClone(saved);

  assert.deepEqual(module.resolveAssistantMcpServers(false, saved, builtIn), []);
  assert.deepEqual(
    module.resolveAssistantMcpServers(true, saved, builtIn).map((server) => server.id),
    [builtIn.id, external.id],
  );
  assert.deepEqual(
    module.resolveAssistantMcpServers(true, saved, null).map((server) => server.id),
    [sameApp.id, savedAssistant.id, external.id],
  );
  assert.deepEqual(saved, before);
});

test("External MCP is keyed, can be turned off, and hides or blocks writes when changes are off", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    globalThis.__mcpServerSettings = { enabled: false, allowWrites: true };
    assert.equal(await rawRequest(port, EXTERNAL_AUTH, "/mcp"), 403, "off refuses even a valid key");

    globalThis.__mcpServerSettings = { enabled: true, allowWrites: false };
    assert.equal(await rawRequest(port, {}, "/mcp"), 401, "missing key");
    assert.equal(await rawRequest(port, { authorization: "Bearer wrong" }, "/mcp"), 401, "wrong key");
    assert.equal(await rawRequest(port, { ...EXTERNAL_AUTH, host: "example.test" }, "/mcp"), 403);

    const readOnly = new Client({ name: "read-only", version: "1.0.0" });
    const readOnlyTransport = new StreamableHTTPClientTransport(url, { requestInit: { headers: EXTERNAL_AUTH } });
    try {
      await readOnly.connect(readOnlyTransport);
      assert.deepEqual(
        (await readOnly.listTools()).tools.map((tool) => tool.name).sort(),
        ["get_weekly_review", "list_events", "list_inbox", "list_reminders", "list_tasks", "read_email"],
      );
    } finally {
      await readOnlyTransport.terminateSession();
      await readOnly.close();
    }

    globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
    const writer = new Client({ name: "writer", version: "1.0.0" });
    const writerTransport = new StreamableHTTPClientTransport(url, { requestInit: { headers: EXTERNAL_AUTH } });
    try {
      await writer.connect(writerTransport);
      assert.equal((await writer.listTools()).tools.length, 14);
      // Turning changes off applies to sessions that are already open.
      globalThis.__mcpServerSettings = { enabled: true, allowWrites: false };
      const blocked = await writer.callTool({ name: "create_task", arguments: { title: "nope" } });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0].text, /Allow changes/);
    } finally {
      await writerTransport.terminateSession().catch(() => undefined);
      await writer.close();
    }
  } finally {
    delete globalThis.__mcpServerSettings;
    await close(server);
  }
});

test("an MCP reminder write reports link reconciliation separately from its confirmed provider result", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
    globalThis.__mcpGoogleStatus = { connected: false, email: null };
    globalThis.__mcpReminderResult = { identity: "stable-reminder", recurring: false };
    globalThis.__mcpReconcileError = true;
    globalThis.__mcpBroadcasts = [];
    const client = new Client({ name: "reminder-write", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: EXTERNAL_AUTH } });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "complete_reminder",
        arguments: { ref: "old-ref", completed: true },
      });
      assert.notEqual(result.isError, true);
      assert.match(result.content[0].text, /Reminder marked done/);
      assert.match(result.content[0].text, /could not update its saved link yet/);
      assert.ok(globalThis.__mcpBroadcasts.some(([channel, event]) => channel === "data:changed" && event.source === "reminders"));
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    }
  } finally {
    delete globalThis.__mcpServerSettings;
    delete globalThis.__mcpGoogleStatus;
    delete globalThis.__mcpReminderResult;
    delete globalThis.__mcpReconcileError;
    delete globalThis.__mcpBroadcasts;
    await close(server);
  }
});
