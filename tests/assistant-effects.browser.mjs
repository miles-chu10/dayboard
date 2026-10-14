import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { chromium } from "@playwright/test";
import { build } from "esbuild";

// Run explicitly with node --test; ordinary unit tests do not require a browser installation.
// Real React effects run offline; every IPC, AI response, and source-item creation is synthetic.
const root = fileURLToPath(new URL("..", import.meta.url));
let browser;
let historyBundle;
let assistantBundle;

const harness = `
  import React, { act } from "react";
  import { createRoot } from "react-dom/client";
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let sequence = 0;
  if (!crypto.randomUUID) crypto.randomUUID = () => "fixture-" + (++sequence);
  const empty = scope => ({ scope, chats: [], activeChatId: null, legacyImported: true });
  const fixture = globalThis.__fixture = {
    initial: empty("account-a"), demo: false, prompt: undefined,
    settings: { enabled: true, ai: { assistantPermission: "ask" } },
    calls: [], saves: [], streams: [], creates: [], navigations: [],
    holdSaves: false, holdCreates: false, notifications: new Map(),
    queryClient: {},
    actions: [
      { kind: "task", title: "First fixture task", added: false },
      { kind: "task", title: "Second fixture task", added: false },
    ],
  };
  function pending(list, data) {
    return new Promise((resolve, reject) => list.push({ data, resolve, reject }));
  }
  fixture.invoke = (channel, input) => {
    fixture.calls.push({ channel, input: structuredClone(input) });
    if (channel === "assistant:getHistory") return Promise.resolve(fixture.initial);
    if (channel === "assistant:saveChat") {
      const result = { ...empty(input.expectedScope), chats: [input.chat], activeChatId: input.chat.id };
      return fixture.holdSaves ? pending(fixture.saves, result) : Promise.resolve(result);
    }
    throw new Error("Unexpected fixture IPC: " + channel);
  };
  fixture.navigate = options => {
    fixture.navigations.push(options);
    return Promise.resolve();
  };
  fixture.createItem = action => {
    if (fixture.holdCreates) return pending(fixture.creates, action);
    fixture.creates.push({ data: action });
    return Promise.resolve();
  };
  globalThis.dayboard = { ipc: {
    invoke: fixture.invoke,
    onNotification: (channel, listener) => {
      fixture.notifications.set(channel, listener);
      return () => fixture.notifications.delete(channel);
    },
    cancelStream: () => {},
    stream: (channel, input) => {
      if (channel !== "ai:assistant") throw new Error("Unexpected fixture stream");
      return pending(fixture.streams, input);
    },
  } };
  const container = document.getElementById("root");
  let reactRoot = createRoot(container);
  fixture.update = async patch => {
    await act(async () => { Object.assign(fixture, patch); render(); });
  };
  fixture.unmount = async () => {
    await act(async () => reactRoot.unmount());
    reactRoot = createRoot(container);
  };
  fixture.resolve = async (collection, index) => {
    await act(async () => fixture[collection][index].resolve(fixture[collection][index].data));
  };
  fixture.finishReply = async text => {
    await act(async () => fixture.streams.at(-1).resolve({ text }));
  };
  fixture.snapshot = () => ({
    calls: fixture.calls, streams: fixture.streams.map(item => item.data),
    creates: fixture.creates.map(item => item.data), navigations: fixture.navigations,
    input: document.querySelector("textarea")?.value,
  });
`;

const ipcStub = `
  export const invoke = (...args) => globalThis.__fixture.invoke(...args);
  export const errorMessage = error => error.message;
  export const openSettings = () => { throw new Error("Unexpected settings request"); };
`;

async function bundle(contents, stubs) {
  const result = await build({
    stdin: {
      contents,
      resolveDir: root,
      sourcefile: "assistant-effects-fixture.jsx",
      loader: "jsx",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    write: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "synthetic-assistant-boundaries",
        setup(api) {
          api.onResolve({ filter: /.*/ }, ({ path }) =>
            stubs[path] ? { path, namespace: "fixture" } : undefined,
          );
          api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents: stubs[path],
            resolveDir: root,
            loader: "jsx",
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

before(async () => {
  historyBundle = await bundle(
    `${harness}
      import { useAssistantHistory } from "./renderer/lib/assistant-history.ts";
      function History() {
        const client = useAssistantHistory(fixture.initial, fixture.demo);
        React.useLayoutEffect(() => { fixture.client = client; });
        return <output>{client.history.scope}:{client.messages.length}</output>;
      }
      function render() { reactRoot.render(<History />); }
      fixture.changeMessages = async messages => {
        await act(async () => fixture.client.setMessages(messages));
      };
      fixture.rejectSave = async index => {
        await act(async () => fixture.saves[index].reject(new Error("Synthetic save failure")));
      };
      fixture.historySnapshot = () => ({
        scope: fixture.client.history.scope, messages: fixture.client.messages,
        saving: fixture.client.saving, saveError: fixture.client.saveError,
      });`,
    { "./ipc": ipcStub },
  );
  assistantBundle = await bundle(
    `${harness}
      import { AssistantView } from "./renderer/main/assistant-view.tsx";
      function render() { reactRoot.render(<AssistantView />); }`,
    {
      "./ipc": ipcStub,
      "../lib/ipc": ipcStub,
      "@tanstack/react-query": `export const useQueryClient = () => globalThis.__fixture.queryClient;`,
      "@tanstack/react-router": `
        export const useNavigate = () => globalThis.__fixture.navigate;
        export const useSearch = () => ({ prompt: globalThis.__fixture.prompt });`,
      "@renderer/ui": `
        import React from "react";
        const Box = ({ children }) => <div>{children}</div>;
        export const Button = ({ children, onClick, disabled, "aria-label": label }) =>
          <button onClick={onClick} disabled={disabled} aria-label={label}>{children}</button>;
        export const ScrollArea = ({ children, footer, actions }) => <main>{actions}{children}{footer}</main>;
        export const Callout = Box, Text = Box, Markdown = Box;
        export const EmptyState = ({ title, actions }) => <div>{title}{actions}</div>;
        export const AIChat = {
          Message: { Root: Box, Content: Box },
          Tool: { Root: Box, Trigger: Box, Name: Box },
          Reasoning: { Root: Box, Trigger: Box },
          Conversation: { Content: Box, Anchor: () => null },
        };
        export const toast = { success: () => {}, error: message => { throw new Error(message); } };`,
      "../components/assistant-composer": `
        import React from "react";
        export const AssistantComposer = ({ input, setInput, onSend }) => <div>
          <textarea value={input} onChange={event => setInput(event.target.value)} />
          <button onClick={onSend}>Send fixture message</button>
        </div>;`,
      "../components/license-gate": `export const LicenseGate = ({ children }) => children;`,
      "../components/app-sidebar": `export const displayName = () => "Fixture User";`,
      "../components/history-nav": `export const HistoryNav = () => null;`,
      "../components/mcp-servers-dialog": `
        export const McpServersDialog = () => null;
        export const useAssistantMcpServers = () => ({ data: [] });`,
      "../components/provider-logo": `export const ProviderMark = () => null, ProviderTile = () => null;`,
      "../components/section-card": `export const ListCard = ({ children }) => children;`,
      "../components/source-dot": `export const SourceDot = () => null;`,
      "../components/chat-history-dialog": `export const ChatHistoryDialog = () => null;`,
      "../lib/ai": `export const BLOCKED_MESSAGE = {};`,
      "../lib/ai-models": `
        export const assistantProvider = () => "fixture";
        export const selectedModel = () => ({ label: "Fixture model" });
        export const useCodexModels = () => ({ data: [] });`,
      "../lib/demo": `export const isRendererDemoMode = () => false;`,
      "../lib/ai-prompts": `export const buildAssistantSnapshot = () => "", buildAssistantSystem = () => "";`,
      "../lib/assistant": `
        export const ASSISTANT_SUGGESTIONS = [], loadLegacyConversation = () => [];
        export const splitActions = text => ({
          body: text, actions: text === "fixture actions" ? globalThis.__fixture.actions : [],
        });`,
      "../lib/create-items": `
        export const KIND_LABEL = { task: "Task" }, KIND_SOURCE = { task: "tasks" };
        export const createItem = action => globalThis.__fixture.createItem(action);`,
      "../lib/dates": `export const dayHeading = value => value, formatClock = value => value;`,
      "../lib/queries": `
        const query = () => ({ data: undefined });
        export const useAccounts = query, useCalendar = query, useMail = query,
          useAssistantMcpStatus = query, useReminders = query, useTasks = query;`,
      "../lib/settings": `
        export const PROVIDER_LABEL = { fixture: "Fixture" };
        export const featureOn = settings => settings?.enabled === true;
        export const sourceOn = () => false, providerUsesMcp = () => false;
        export const useSettings = () => ({ data: globalThis.__fixture.settings });`,
      "../lib/todos": `export const buildTodos = () => [];`,
      "../lib/triage": `export const readTriageMap = () => ({});`,
    },
  );
  browser = await chromium.launch({ headless: true });
});

after(async () => browser?.close());

async function pageFixture(t, contents) {
  const context = await browser.newContext({ offline: true });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  t.after(async () => {
    try {
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({ content: contents });
  return page;
}

test("history rerenders do not seed or save the demo conversation again", async (t) => {
  const page = await pageFixture(t, historyBundle);
  await page.evaluate(() => globalThis.__fixture.update({ demo: true }));
  const before = await page.evaluate(() => globalThis.__fixture.historySnapshot());
  assert.equal(before.messages.length, 2);
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => {
      const fixture = globalThis.__fixture;
      return fixture.update({ initial: { ...fixture.initial, chats: [] } });
    });
  }
  const state = await page.evaluate(() => globalThis.__fixture.snapshot());
  assert.equal(state.calls.filter(({ channel }) => channel === "assistant:saveChat").length, 1);
  assert.deepEqual(await page.evaluate(() => globalThis.__fixture.historySnapshot()), before);
});

test("unmount retries an unsaved draft in its original account without updating the next session", async (t) => {
  const page = await pageFixture(t, historyBundle);
  await page.evaluate(() => globalThis.__fixture.update({ holdSaves: true }));
  await page.evaluate(() =>
    globalThis.__fixture.changeMessages([
      {
        id: "draft",
        role: "user",
        content: "Fixture draft",
        tools: [],
        actions: [],
        error: null,
        blocked: null,
      },
    ]),
  );
  await page.evaluate(() => globalThis.__fixture.rejectSave(0));
  assert.match(
    (await page.evaluate(() => globalThis.__fixture.historySnapshot())).saveError,
    /not|hasn.t/,
  );
  await page.evaluate(() => globalThis.__fixture.unmount());
  await page.evaluate(() => {
    const fixture = globalThis.__fixture;
    return fixture.update({ initial: { ...fixture.initial, scope: "account-b" } });
  });
  await page.evaluate(() => globalThis.__fixture.resolve("saves", 1));
  const snapshot = await page.evaluate(() => globalThis.__fixture.snapshot());
  const saves = snapshot.calls.filter(({ channel }) => channel === "assistant:saveChat");
  assert.equal(saves.length, 2);
  assert.ok(saves.every(({ input }) => input.expectedScope === "account-a"));
  assert.equal(saves[1].input.chat.messages[0].content, "Fixture draft");
  const current = await page.evaluate(() => globalThis.__fixture.historySnapshot());
  assert.equal(current.scope, "account-b");
  assert.equal(current.messages.length, 0);
  assert.equal(current.saveError, null);
});

test("handoff waits for settings, sends once across rerenders, and queues while a reply runs", async (t) => {
  const page = await pageFixture(t, assistantBundle);
  await page.evaluate(() =>
    globalThis.__fixture.update({ settings: undefined, prompt: "First handoff" }),
  );
  assert.equal((await page.evaluate(() => globalThis.__fixture.snapshot())).streams.length, 0);
  await page.evaluate(() => globalThis.__fixture.update({ settings: { enabled: true, ai: {} } }));
  await page.evaluate(() => globalThis.__fixture.update({ settings: { enabled: true, ai: {} } }));
  assert.equal((await page.evaluate(() => globalThis.__fixture.snapshot())).streams.length, 1);
  await page.evaluate(() => globalThis.__fixture.update({ prompt: undefined }));
  await page.evaluate(() => globalThis.__fixture.update({ prompt: "Queued handoff" }));
  let snapshot = await page.evaluate(() => globalThis.__fixture.snapshot());
  assert.equal(snapshot.input, "Queued handoff");
  assert.equal(snapshot.streams.length, 1);
  await page.evaluate(() => globalThis.__fixture.finishReply("Fixture reply"));
  await page.evaluate(() => globalThis.__fixture.update({ settings: { enabled: true, ai: {} } }));
  snapshot = await page.evaluate(() => globalThis.__fixture.snapshot());
  assert.equal(snapshot.streams.length, 1);
  assert.equal(snapshot.input, "Queued handoff");
  assert.equal(snapshot.navigations.length, 2);
});

test("disabled Assistant consumes a handoff without sending when it is later enabled", async (t) => {
  const page = await pageFixture(t, assistantBundle);
  await page.evaluate(() =>
    globalThis.__fixture.update({
      settings: { enabled: false, ai: {} },
      prompt: "Disabled handoff",
    }),
  );
  await page.evaluate(() => globalThis.__fixture.update({ settings: { enabled: true, ai: {} } }));
  const snapshot = await page.evaluate(() => globalThis.__fixture.snapshot());
  assert.equal(snapshot.streams.length, 0);
  assert.equal(snapshot.navigations.length, 1);
});

test("auto actions are consumed once even as each create and save causes rerenders", async (t) => {
  const page = await pageFixture(t, assistantBundle);
  await page.evaluate(() =>
    globalThis.__fixture.update({
      settings: { enabled: true, ai: { assistantPermission: "auto" } },
      holdCreates: true,
      prompt: "Propose fixture tasks",
    }),
  );
  await page.evaluate(() => globalThis.__fixture.finishReply("fixture actions"));
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => {
      const fixture = globalThis.__fixture;
      return fixture.update({ settings: { ...fixture.settings } });
    });
  }
  assert.equal((await page.evaluate(() => globalThis.__fixture.snapshot())).creates.length, 1);
  await page.evaluate(() => globalThis.__fixture.resolve("creates", 0));
  assert.equal((await page.evaluate(() => globalThis.__fixture.snapshot())).creates.length, 2);
  await page.evaluate(() => globalThis.__fixture.update({ prompt: undefined }));
  await page.evaluate(() => globalThis.__fixture.resolve("creates", 1));
  await page.evaluate(() =>
    globalThis.__fixture.update({
      settings: { enabled: true, ai: { assistantPermission: "auto" } },
    }),
  );
  const snapshot = await page.evaluate(() => globalThis.__fixture.snapshot());
  assert.deepEqual(
    snapshot.creates.map(({ title }) => title),
    ["First fixture task", "Second fixture task"],
  );
  const finalSave = snapshot.calls.filter(({ channel }) => channel === "assistant:saveChat").at(-1);
  assert.equal(finalSave.input.chat.messages.at(-1).actions.filter(({ added }) => added).length, 2);
  assert.equal(snapshot.streams.length, 1);
});
