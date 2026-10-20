import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { build } from "esbuild";
import type { Page } from "@playwright/test";

// Specs run from the project folder; Glaze publishes the build to the sibling runtime folder.
const BUILD_DIR = path.resolve(process.cwd(), "..", "runtime", "build");
// The native shell resolves the build's shared modules through an import map and injects the SDK's
// component styles; the harness serves the same files from the project's SDK.
const SDK_DIR = process.env.GLAZE_SDK_PATH
  ? path.resolve(process.env.GLAZE_SDK_PATH, "@glaze/core")
  : path.resolve(process.cwd(), "..", "..", ".sdk", "@glaze", "core");
const IMPORT_MAP = {
  imports: {
    react: "/__glaze/vendor/react.js",
    "react/jsx-runtime": "/__glaze/vendor/react-jsx-runtime.js",
    "react/jsx-dev-runtime": "/__glaze/vendor/react-jsx-dev-runtime.js",
    "react/compiler-runtime": "/__glaze/vendor/react-compiler-runtime.js",
    "react-dom": "/__glaze/vendor/react-dom.js",
    "react-dom/client": "/__glaze/vendor/react-dom-client.js",
    "@tanstack/react-query": "/__glaze/vendor/tanstack-react-query.js",
    sonner: "/__glaze/vendor/sonner.js",
    "@glaze/core/components": "/__glaze/components.js",
    "@glaze/core/hooks": "/__glaze/hooks.js",
    "@glaze/core/utils": "/__glaze/utils.js",
    "@glaze/core/ipc": "/__glaze/ipc.js",
  },
};
const SHELL_HEAD = `<script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>
<link rel="stylesheet" href="/__glaze/components.css" />`;
const ORIGIN = "https://dayboard.test";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The app's real default settings, from the backend's own normalizer. */
export async function defaultSettings(): Promise<Record<string, unknown>> {
  const result = await build({
    entryPoints: [path.resolve(process.cwd(), "main/services/settings-store.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "glaze-backend",
        setup(api) {
          api.onResolve({ filter: /^@glaze\/core\/backend$/ }, () => ({
            path: "backend",
            namespace: "stub",
          }));
          api.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `export const app = { getPath: () => "/nonexistent" };
export const safeStorage = {};
export const logger = { info() {}, warn() {}, error() {}, debug() {} };`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  const module = await import(`data:text/javascript;base64,${source}`);
  return module.normalizeSettings({});
}

export interface BridgeOptions {
  settings: Record<string, unknown>;
  /** Fixed responses by channel; list channels default to an empty "ok" result. */
  responses?: Record<string, unknown>;
  /** Channels that reject with this message. */
  reject?: Record<string, string>;
  /** Channels held until a spec settles their next pending call. */
  defer?: string[];
}

/** Stands in for the native preload: records every call and lets a spec push notifications. */
function installBridge(options: BridgeOptions) {
  type Listener = (payload: unknown) => void;
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }[]
  >();
  let history = {
    scope: "e2e-scope",
    chats: [] as unknown[],
    activeChatId: null as string | null,
    legacyImported: true,
  };
  // A signed-out, non-demo profile with Reminders allowed: what a fresh install shows.
  const defaults: Record<string, unknown> = {
    "app:isDemo": false,
    "accounts:getStatus": {
      google: { hasCredentials: false, connected: false, email: null, clientIdHint: null },
      reminders: "full-access",
    },
    "agenda:getScope": "e2e-scope",
    "agenda:getState": {
      scope: "e2e-scope",
      state: { focusKeys: [], duplicateLinks: [], scheduledBlocks: [] },
    },
    "ai:availability": { glaze: true, claude: false, codex: false, gemini: false, muse: false },
    "capture:recent": [],
    "ai:claudeModels": {},
    "ai:codexModels": [],
    "apiKeys:status": {},
    "mcp:assistantStatus": { state: "ready", ok: true, toolCount: 0, serverCount: 0 },
    "mcp:assistantServers": [],
    "mcp:list": [],
    "system:hotkeyStatus": {
      accelerator: "Control+Alt+Space",
      enabled: true,
      registered: true,
      conflict: null,
    },
    "system:notificationStatus": { status: "unknown" },
  };
  const respond = (channel: string, args: unknown[]): Promise<unknown> => {
    calls.push({ channel, args });
    if (options.defer?.includes(channel))
      return new Promise((resolve, reject) => {
        const queue = pending.get(channel) ?? [];
        queue.push({ resolve, reject });
        pending.set(channel, queue);
      });
    if (options.reject && channel in options.reject)
      return Promise.reject(new Error(options.reject[channel]));
    if (channel === "settings:get") return Promise.resolve(options.settings);
    if (channel === "settings:update") {
      options.settings = args[0] as Record<string, unknown>;
      return Promise.resolve(options.settings);
    }
    if (channel === "assistant:getHistory") return Promise.resolve(history);
    if (channel === "assistant:saveChat") {
      const { chat } = args[0] as { chat: { id: string } };
      history = { ...history, chats: [chat], activeChatId: chat.id };
      return Promise.resolve(history);
    }
    if (options.responses && channel in options.responses)
      return Promise.resolve(options.responses[channel]);
    if (channel in defaults) return Promise.resolve(defaults[channel]);
    if (/:list(Range)?$/.test(channel)) return Promise.resolve({ state: "ok", items: [] });
    return Promise.resolve(null);
  };
  const target = globalThis as unknown as Record<string, unknown>;
  target.__panel = {
    calls,
    setResponse(channel: string, value: unknown) {
      options.responses ??= {};
      options.responses[channel] = value;
    },
    settle(channel: string, value: unknown, error?: string) {
      const call = pending.get(channel)?.shift();
      if (!call) throw new Error(`No pending ${channel} call`);
      if (error) call.reject(new Error(error));
      else call.resolve(value);
    },
    emit(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
  };
  target.glazeAPI = {
    glaze: {
      ipc: {
        invoke: (channel: string, ...args: unknown[]) => respond(channel, args),
        stream: (channel: string, args: unknown) => respond(channel, [args]),
        cancelStream() {},
        onNotification(channel: string, listener: Listener) {
          const set = listeners.get(channel) ?? new Set<Listener>();
          set.add(listener);
          listeners.set(channel, set);
          return () => set.delete(listener);
        },
        isConnected: () => true,
        waitForReady: () => Promise.resolve(),
        disconnect() {},
      },
    },
    nativeTheme: {
      getInfo: () => Promise.resolve({ shouldUseDarkColors: false, themeSource: "system" }),
      setThemeSource: () => Promise.resolve(),
    },
  };
}

async function openWindow(page: Page, entry: string, options: BridgeOptions) {
  await page.route("**/*", (route) => route.abort());
  await page.route(`${ORIGIN}/**`, async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const [root, relative] = pathname.startsWith("/__glaze/")
      ? [SDK_DIR, pathname.slice("/__glaze/".length)]
      : [BUILD_DIR, pathname.slice(1)];
    const file = path.join(root, relative);
    if (!file.startsWith(root)) return route.fulfill({ status: 404 });
    try {
      let body = await readFile(file);
      if (file.endsWith(".html"))
        body = Buffer.from(body.toString("utf8").replace("<head>", `<head>${SHELL_HEAD}`));
      // The SDK stylesheet addresses its fonts on the native glaze-core: scheme.
      if (file.endsWith(".css"))
        body = Buffer.from(body.toString("utf8").replaceAll("glaze-core://", "/__glaze/"));
      return route.fulfill({ body, contentType: TYPES[path.extname(file)] ?? "text/plain" });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  await page.addInitScript(installBridge, options);
  await page.goto(`${ORIGIN}/${entry}`);
}

/** Production components and SDK CSS with an offline bridge; no native app or account access. */
export function openMain(page: Page, options: BridgeOptions) {
  return openWindow(page, "main-window.html", options);
}

export function openPanel(page: Page, surface: "capture" | "menubar", options: BridgeOptions) {
  return openWindow(page, `panel-window.html#${surface}`, options);
}

export function panelCalls(page: Page, channel: string) {
  return page.evaluate((name) => {
    const panel = (
      globalThis as unknown as { __panel: { calls: { channel: string; args: unknown[] }[] } }
    ).__panel;
    return panel.calls.filter((call) => call.channel === name);
  }, channel);
}

export function emitPanel(page: Page, channel: string, payload: unknown = {}) {
  return page.evaluate(
    ({ channel, payload }) => {
      const panel = (
        globalThis as unknown as { __panel: { emit: (name: string, value: unknown) => void } }
      ).__panel;
      panel.emit(channel, payload);
    },
    { channel, payload },
  );
}

export function setPanelResponse(page: Page, channel: string, value: unknown) {
  return page.evaluate(
    ({ channel, value }) => {
      const panel = (
        globalThis as unknown as {
          __panel: { setResponse: (name: string, value: unknown) => void };
        }
      ).__panel;
      panel.setResponse(channel, value);
    },
    { channel, value },
  );
}

export function settlePanel(page: Page, channel: string, value: unknown, error?: string) {
  return page.evaluate(
    async ({ channel, value, error }) => {
      const panel = (
        globalThis as unknown as {
          __panel: { settle: (name: string, value: unknown, error?: string) => void };
        }
      ).__panel;
      panel.settle(channel, value, error);
      await new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      );
    },
    { channel, value, error },
  );
}
