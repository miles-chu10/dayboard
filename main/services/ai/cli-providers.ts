import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { app, logger } from "../../platform/index.js";

import type {
  CliProviderId,
  McpServerConfig,
  ProviderStatus,
  ToolCallStatus,
} from "../../shared-types.js";
import { getSettings } from "../settings-store.js";
import { getToolEnv, toStringEnv } from "../shell-env.js";

import { resolveCli } from "./cli-binaries.js";
import { listCodexModels } from "./codex-models.js";
import { claudeModelArgs, codexModelArgs } from "./model-options.js";

export { resolveCli } from "./cli-binaries.js";

export type CliProvider = CliProviderId;

export interface ToolEvent {
  id: string;
  name?: string;
  status: ToolCallStatus;
}

export interface CliRunOptions {
  provider: CliProvider;
  system: string;
  prompt: string;
  mcpServers: McpServerConfig[];
  signal: AbortSignal;
  timeoutMs: number;
  onDelta: (text: string) => void;
  onTool: (event: ToolEvent) => void;
  /** Exact model ID reported by the CLI at the start of a run. */
  onModel?: (id: string) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  /** Codex model slug to pass explicitly instead of the saved setting. */
  codexModel?: string;
}

const LABEL: Record<CliProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Antigravity",
  muse: "Muse Code",
};

const MISSING_MESSAGE: Record<CliProvider, string> = {
  claude:
    "Claude Code isn't installed. Install it from claude.com/claude-code, then run `claude` in Terminal to sign in.",
  codex:
    "Codex CLI isn't installed. Install it with `npm i -g @openai/codex`, then run `codex login` in Terminal.",
  gemini:
    "Google's Antigravity CLI (agy) isn't installed. Install Antigravity from antigravity.google, then run `agy` in Terminal to sign in with your Google account.",
  muse: "Meta's Muse Code CLI isn't installed. Install it with `curl -fsSL https://dev.meta.ai/install.sh | bash`, then run `muse login` in Terminal.",
};

const LOGIN_MESSAGE: Record<CliProvider, string> = {
  claude:
    "Claude Code isn't signed in. Run `claude` in Terminal and complete login, then try again.",
  codex:
    "Codex isn't signed in. Run `codex login` in Terminal and choose Sign in with ChatGPT, then try again.",
  gemini:
    "Antigravity isn't signed in. Run `agy` in Terminal and sign in with your Google account, then try again.",
  muse: "Muse isn't signed in. Run `muse login` in Terminal and approve the code with your Meta account, then try again.",
};

// Subscription mode: API-key variables would silently override the user's subscription login.
const STRIPPED_ENV: Record<CliProvider, string[]> = {
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ],
  codex: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
  muse: ["META_API_KEY", "MODEL_API_KEY"],
};

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

// ── Output helpers ─────────────────────────────────────────────────────────────────

// Terminal escape sequences, built from char codes so the patterns contain no literal control characters.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_PATTERNS = [
  new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g"),
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g"),
  new RegExp(`${ESC}[()][0-9A-Z]`, "g"),
  new RegExp(`${ESC}[78]`, "g"),
  new RegExp(`[${String.fromCharCode(0x0e)}${String.fromCharCode(0x0f)}]`, "g"),
];

function stripAnsi(value: string): string {
  return ANSI_PATTERNS.reduce((text, pattern) => text.replace(pattern, ""), value);
}

function redact(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/(KEY|TOKEN|SECRET|AUTH|PASSWORD)\s*[=:]/i.test(line))
    .join("\n");
}

function looksLikeLoginError(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "not logged in",
    "please run /login",
    "/login",
    "codex login",
    "muse login",
    "not signed in",
    "invalid api key",
    "authentication_error",
    "unauthorized",
    "401",
  ].some((needle) => normalized.includes(needle));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serverKey(server: McpServerConfig): string {
  return (
    server.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "server"
  );
}

function prettyToolName(name: string): string {
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  return match ? `${match[1]}: ${match[2]}` : name;
}

// ── Process runners ────────────────────────────────────────────────────────────────

interface ProcessRun {
  label: string;
  bin: string;
  args: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  onLine: (line: string) => void;
}

interface ProcessOutcome {
  code: number | null;
  /** Tail of stderr and non-JSON stdout, for error messages. */
  output: string;
}

class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "AbortError";
  }
}

function runDirect(run: ProcessRun): Promise<ProcessOutcome> {
  return new Promise((resolve, reject) => {
    if (run.signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const child = spawn(run.bin, run.args, {
      cwd: run.cwd,
      env: run.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let tail = "";
    let bytes = 0;
    let settled = false;

    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new CancelledError()));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`${run.label} timed out.`)));
    }, run.timeoutMs);
    run.signal.addEventListener("abort", onAbort, { once: true });

    const emitLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      if (!line.startsWith("{")) tail = `${tail}\n${line}`.slice(-4000);
      run.onLine(line);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(() => reject(new Error(`${run.label} produced too much output.`)));
        return;
      }
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        emitLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      tail = `${tail}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      emitLine(buffer);
      finish(() => resolve({ code, output: tail }));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(run.stdin);
  });
}

/**
 * GUI processes may not share the Terminal's login/keychain context, so subscription
 * logins can fail under a direct spawn. Re-run inside a login-shell PTY in that case.
 */
async function runInLoginPty(run: ProcessRun): Promise<ProcessOutcome> {
  const ptyModule = (await import("node-pty")) as typeof import("node-pty") & {
    default?: typeof import("node-pty");
  };
  const spawnPty = ptyModule.spawn ?? ptyModule.default?.spawn;
  if (!spawnPty) throw new Error("Terminal helper is unavailable.");

  const nonce = randomBytes(8).toString("hex");
  const stdinFile = path.join(run.cwd, `stdin-${nonce}.txt`);
  await fs.writeFile(stdinFile, run.stdin, { mode: 0o600 });

  const env = toStringEnv(run.env);
  env.GLZ_BIN = run.bin;
  env.GLZ_STDIN = stdinFile;
  run.args.forEach((arg, index) => {
    env[`GLZ_ARG_${index}`] = arg;
  });
  const argRefs = run.args.map((_, index) => `"$GLZ_ARG_${index}"`).join(" ");
  const command = [
    `printf "%s\\n" "BEGIN_${nonce}"`,
    `"$GLZ_BIN" ${argRefs} < "$GLZ_STDIN"`,
    "rc=$?",
    `printf "%s\\n" "END_${nonce}"`,
    'exit "$rc"',
  ].join("; ");

  try {
    return await new Promise<ProcessOutcome>((resolve, reject) => {
      const child = spawnPty(
        "/usr/bin/login",
        ["-fpq", os.userInfo().username, process.env.SHELL || "/bin/zsh", "-lc", command],
        { name: "xterm-256color", cwd: run.cwd, env, cols: 400, rows: 50 },
      );
      let buffer = "";
      let inside = false;
      let tail = "";
      let settled = false;

      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        run.signal.removeEventListener("abort", onAbort);
        complete();
      };
      const onAbort = () => {
        child.kill();
        finish(() => reject(new CancelledError()));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`${run.label} timed out.`)));
      }, run.timeoutMs);
      run.signal.addEventListener("abort", onAbort, { once: true });

      const handleLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        if (line === `BEGIN_${nonce}`) inside = true;
        else if (line === `END_${nonce}`) inside = false;
        else if (inside) {
          if (!line.startsWith("{")) tail = `${tail}\n${line}`.slice(-4000);
          run.onLine(line);
        }
      };

      child.onData((data) => {
        buffer += stripAnsi(data);
        let index: number;
        while ((index = buffer.search(/\r?\n/)) >= 0) {
          handleLine(buffer.slice(0, index));
          buffer = buffer.slice(buffer[index] === "\r" ? index + 2 : index + 1);
        }
      });
      child.onExit(({ exitCode }) => {
        handleLine(buffer);
        finish(() => resolve({ code: exitCode, output: tail }));
      });
    });
  } finally {
    await fs.rm(stdinFile, { force: true });
  }
}

async function workDir(): Promise<string> {
  const dir = path.join(app.getPath("userData"), "ai-workspace");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ── Claude Code ──────────────────────────────────────────────────────────────────

interface ParseState {
  text: string;
  sawDelta: boolean;
  final: string | null;
  error: string | null;
}

function createState(): ParseState {
  return { text: "", sawDelta: false, final: null, error: null };
}

function emitText(state: ParseState, options: CliRunOptions, text: string) {
  if (!text) return;
  state.text += text;
  options.onDelta(text);
}

function separateMessages(state: ParseState, options: CliRunOptions) {
  if (state.text && !state.text.endsWith("\n\n")) emitText(state, options, "\n\n");
}

function handleClaudeLine(line: string, state: ParseState, options: CliRunOptions) {
  const event = parseJsonLine(line);
  if (!event) return;

  if (event.type === "stream_event" && isRecord(event.event)) {
    const inner = event.event;
    if (inner.type === "message_start") separateMessages(state, options);
    if (
      inner.type === "content_block_delta" &&
      isRecord(inner.delta) &&
      inner.delta.type === "text_delta"
    ) {
      state.sawDelta = true;
      emitText(state, options, typeof inner.delta.text === "string" ? inner.delta.text : "");
    }
    return;
  }

  if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") {
    options.onModel?.(event.model);
    return;
  }

  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content.filter(isRecord) : [];

  if (event.type === "assistant") {
    for (const block of content) {
      if (block.type === "tool_use" && typeof block.id === "string") {
        options.onTool({
          id: block.id,
          name: prettyToolName(String(block.name ?? "tool")),
          status: "running",
        });
      } else if (block.type === "text" && !state.sawDelta && typeof block.text === "string") {
        separateMessages(state, options);
        emitText(state, options, block.text);
      }
    }
  } else if (event.type === "user") {
    for (const block of content) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        options.onTool({
          id: block.tool_use_id,
          status: block.is_error ? "error" : "success",
        });
      }
    }
  } else if (event.type === "result") {
    if (isRecord(event.usage)) {
      const usage = event.usage;
      const count = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
      options.onUsage?.({
        inputTokens:
          count("input_tokens") +
          count("cache_read_input_tokens") +
          count("cache_creation_input_tokens"),
        outputTokens: count("output_tokens"),
      });
    }
    if (typeof event.result === "string") state.final = event.result;
    if (event.is_error)
      state.error =
        typeof event.result === "string" ? event.result : String(event.subtype ?? "failed");
  }
}

async function claudeArgs(options: CliRunOptions): Promise<string[]> {
  const settings = await getSettings();
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--system-prompt",
    options.system,
  ];
  args.push(...claudeModelArgs(settings.ai));
  if (options.mcpServers.length) {
    const mcpServers = Object.fromEntries(
      options.mcpServers.map((server) => [
        serverKey(server),
        server.transport === "stdio"
          ? {
              type: "stdio",
              command: server.command,
              args: server.args,
              env: server.env,
            }
          : { type: "http", url: server.url, headers: server.headers },
      ]),
    );
    args.push(
      "--mcp-config",
      JSON.stringify({ mcpServers }),
      "--strict-mcp-config",
      "--allowedTools",
      options.mcpServers.map((server) => `mcp__${serverKey(server)}`).join(","),
    );
  } else {
    args.push("--strict-mcp-config");
  }
  // Built-in tools (shell, file edits) stay off; only MCP tools from --mcp-config are available.
  args.push("--tools", "");
  return args;
}

async function runClaude(options: CliRunOptions): Promise<string> {
  const bin = await resolveCli("claude");
  if (!bin) throw new Error(MISSING_MESSAGE.claude);

  const run = async (usePty: boolean): Promise<{ state: ParseState; outcome: ProcessOutcome }> => {
    const state = createState();
    const processRun: ProcessRun = {
      label: LABEL.claude,
      bin,
      args: await claudeArgs(options),
      stdin: options.prompt,
      env: await getToolEnv(STRIPPED_ENV.claude),
      cwd: await workDir(),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onLine: (line) => handleClaudeLine(line, state, options),
    };
    const outcome = usePty ? await runInLoginPty(processRun) : await runDirect(processRun);
    return { state, outcome };
  };

  let { state, outcome } = await run(false);
  const failure = () =>
    state.error ?? (outcome.code !== 0 ? outcome.output || `${LABEL.claude} failed.` : null);

  if (failure() && looksLikeLoginError(failure()!) && !state.text) {
    logger.info("ai", "Claude Code direct spawn was not authenticated; retrying in login shell");
    ({ state, outcome } = await run(true));
  }

  const error = failure();
  if (error)
    throw new Error(
      looksLikeLoginError(error) ? LOGIN_MESSAGE.claude : redact(error).slice(0, 1200),
    );
  if (!state.text && state.final) emitText(state, options, state.final);
  return state.text;
}

// ── Codex (ChatGPT subscription) ───────────────────────────────────────────────────

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlTable(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${tomlKey(key)}=${JSON.stringify(value)}`)
    .join(",")}}`;
}

function handleCodexLine(line: string, state: ParseState, options: CliRunOptions) {
  const event = parseJsonLine(line);
  if (!event) return;
  const msg = isRecord(event.msg) ? event.msg : event;
  const type = msg.type;
  const item = isRecord(msg.item) ? msg.item : null;

  if (type === "agent_message_delta" && typeof msg.delta === "string") {
    state.sawDelta = true;
    emitText(state, options, msg.delta);
  } else if (type === "agent_message" && typeof msg.message === "string" && !state.sawDelta) {
    separateMessages(state, options);
    emitText(state, options, msg.message);
  } else if (item?.type === "agent_message" && type === "item.completed" && !state.sawDelta) {
    const text =
      typeof item.text === "string"
        ? item.text
        : Array.isArray(item.content)
          ? item.content
              .filter(isRecord)
              .map((part) => (typeof part.text === "string" ? part.text : ""))
              .join("")
          : "";
    separateMessages(state, options);
    emitText(state, options, text);
  } else if (type === "mcp_tool_call_begin" && typeof msg.call_id === "string") {
    const invocation = isRecord(msg.invocation) ? msg.invocation : {};
    options.onTool({
      id: msg.call_id,
      name: `${invocation.server ?? "mcp"}: ${invocation.tool ?? "tool"}`,
      status: "running",
    });
  } else if (type === "mcp_tool_call_end" && typeof msg.call_id === "string") {
    const result = isRecord(msg.result) ? msg.result : {};
    options.onTool({
      id: msg.call_id,
      status: "Err" in result ? "error" : "success",
    });
  } else if (item?.type === "mcp_tool_call" && typeof item.id === "string") {
    const failed = item.status === "failed" || Boolean(item.error);
    options.onTool({
      id: item.id,
      name: `${item.server ?? "mcp"}: ${item.tool ?? "tool"}`,
      status: type === "item.started" ? "running" : failed ? "error" : "success",
    });
  } else if (type === "turn.completed" && isRecord(msg.usage)) {
    const usage = msg.usage;
    options.onUsage?.({
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    });
  } else if (type === "error" || type === "turn.failed" || type === "stream_error") {
    const detail = isRecord(msg.error) ? msg.error.message : msg.message;
    state.error = typeof detail === "string" ? detail : "Codex failed.";
  }
}

async function runCodex(options: CliRunOptions): Promise<string> {
  const bin = await resolveCli("codex");
  if (!bin) throw new Error(MISSING_MESSAGE.codex);
  const settings = await getSettings();
  const cwd = await workDir();
  const lastMessageFile = path.join(cwd, `codex-last-${randomBytes(6).toString("hex")}.txt`);

  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    // Dashboard owns these settings and MCP connections; keep CLI preferences separate.
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-C",
    cwd,
    "-o",
    lastMessageFile,
    "-c",
    'approval_policy="never"',
  ];
  const ai = options.codexModel ? { ...settings.ai, codexModel: options.codexModel } : settings.ai;
  args.push(...codexModelArgs(ai, ai.codexModel ? await listCodexModels() : []));
  for (const server of options.mcpServers) {
    const key = `mcp_servers.${serverKey(server)}`;
    if (server.transport === "stdio") {
      args.push("-c", `${key}.command=${JSON.stringify(server.command)}`);
      args.push("-c", `${key}.args=${JSON.stringify(server.args)}`);
      if (Object.keys(server.env).length) args.push("-c", `${key}.env=${tomlTable(server.env)}`);
    } else {
      args.push("-c", `${key}.url=${JSON.stringify(server.url)}`);
      if (Object.keys(server.headers).length)
        args.push("-c", `${key}.http_headers=${tomlTable(server.headers)}`);
    }
  }
  args.push("-");

  const state = createState();
  try {
    const outcome = await runDirect({
      label: LABEL.codex,
      bin,
      args,
      stdin: `${options.system}\n\n---\n\n${options.prompt}`,
      env: await getToolEnv(STRIPPED_ENV.codex),
      cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onLine: (line) => handleCodexLine(line, state, options),
    });
    if (!state.text) {
      const last = await fs.readFile(lastMessageFile, "utf8").catch(() => "");
      emitText(state, options, last.trim());
    }
    const error = state.text
      ? null
      : (state.error ?? (outcome.code !== 0 ? outcome.output || "Codex failed." : null));
    if (error)
      throw new Error(
        looksLikeLoginError(error) ? LOGIN_MESSAGE.codex : redact(error).slice(0, 1200),
      );
    return state.text;
  } finally {
    await fs.rm(lastMessageFile, { force: true });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────────

// ── Antigravity (Gemini subscription) ──────────────────────────────────────────────

/**
 * agy's print mode mirrors Claude Code's stream-json events; also accept plain text deltas
 * and a final `result`, since its schema isn't documented.
 */
function handleGeminiLine(line: string, state: ParseState, options: CliRunOptions) {
  const event = parseJsonLine(line);
  if (!event) return;
  if (typeof event.model === "string" && (event.type === "system" || event.type === "init")) {
    options.onModel?.(event.model);
    return;
  }
  if (
    typeof event.text === "string" &&
    typeof event.type === "string" &&
    event.type.includes("delta")
  ) {
    state.sawDelta = true;
    emitText(state, options, event.text);
    return;
  }
  handleClaudeLine(line, state, options);
}

async function runGemini(options: CliRunOptions): Promise<string> {
  const bin = await resolveCli("gemini");
  if (!bin) throw new Error(MISSING_MESSAGE.gemini);
  const settings = await getSettings();
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--mode",
    "plan",
    "--disable-slash-commands",
  ];
  if (settings.ai.geminiModel) args.push("--model", settings.ai.geminiModel);
  const state = createState();
  const outcome = await runDirect({
    label: LABEL.gemini,
    bin,
    args,
    stdin: `${options.system}\n\n---\n\n${options.prompt}`,
    env: await getToolEnv(STRIPPED_ENV.gemini),
    cwd: await workDir(),
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onLine: (line) => handleGeminiLine(line, state, options),
  });
  if (!state.text && state.final) emitText(state, options, state.final);
  const error = state.text
    ? null
    : (state.error ?? (outcome.code !== 0 ? outcome.output || "Antigravity failed." : null));
  if (error)
    throw new Error(
      looksLikeLoginError(error) ? LOGIN_MESSAGE.gemini : redact(error).slice(0, 1200),
    );
  return state.text;
}

/** Model names reported by `agy models`, one per line. */
export async function listGeminiModels(): Promise<string[]> {
  const bin = await resolveCli("gemini");
  if (!bin) throw new Error(MISSING_MESSAGE.gemini);
  const output = await new Promise<string>((resolve, reject) =>
    execFile(bin, ["models"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(new Error("Couldn't list Antigravity models.")) : resolve(String(stdout)),
    ),
  );
  return [
    ...new Set(
      stripAnsi(output)
        .split("\n")
        .map(
          (line) =>
            line
              .trim()
              .replace(/^[-*•]\s*/, "")
              .split(/\s+/)[0] ?? "",
        )
        .filter((token) => /^[a-z][a-z0-9._:/-]*\d[a-z0-9._:/-]*$/i.test(token)),
    ),
  ].slice(0, 40);
}

// ── Muse Code (Meta account) ──────────────────────────────────────────────────────────────

interface MuseState extends ParseState {
  kinds: Map<string, string>;
  streamed: Set<string>;
}

function museParams(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.params) ? event.params : event;
}

/** `muse exec --json` emits MSP view notifications: `item/*`, `turn/completed`, `session/*`. */
function handleMuseLine(line: string, state: MuseState, options: CliRunOptions) {
  const event = parseJsonLine(line);
  if (!event) return;
  const method = String(event.method ?? event.type ?? "");
  const params = museParams(event);
  if (method === "session/modelChanged" && typeof params.modelId === "string") {
    options.onModel?.(params.modelId);
  } else if (method === "item/delta" && typeof params.delta === "string") {
    const id = String(params.itemId ?? "");
    if ((params.field ?? "text") !== "text" || state.kinds.get(id) !== "agentMessage") return;
    if (!state.streamed.has(id)) separateMessages(state, options);
    state.streamed.add(id);
    state.sawDelta = true;
    emitText(state, options, params.delta);
  } else if (method.startsWith("item/") && isRecord(params.item)) {
    const item = params.item;
    const id = String(item.itemId ?? "");
    const kind = String(item.kind ?? "");
    state.kinds.set(id, kind);
    if (kind === "toolCall") {
      const status = String(item.status ?? "");
      options.onTool({
        id,
        name: typeof item.tool === "string" ? item.tool : undefined,
        status: status === "inProgress" ? "running" : status === "completed" ? "success" : "error",
      });
    } else if (
      kind === "agentMessage" &&
      method === "item/completed" &&
      !state.streamed.has(id) &&
      typeof item.text === "string"
    ) {
      separateMessages(state, options);
      state.streamed.add(id);
      emitText(state, options, item.text);
    }
  } else if (method === "turn/completed") {
    if (isRecord(params.usage)) {
      options.onUsage?.({
        inputTokens: Number(params.usage.inputTokens ?? 0),
        outputTokens: Number(params.usage.outputTokens ?? 0),
      });
    }
    if (isRecord(params.error) && typeof params.error.message === "string")
      state.error = params.error.message;
  } else if (typeof event.error === "string") {
    state.error = event.error;
  }
}

async function runMuse(options: CliRunOptions): Promise<string> {
  const bin = await resolveCli("muse");
  if (!bin) throw new Error(MISSING_MESSAGE.muse);
  const settings = await getSettings();
  const cwd = await workDir();
  const promptFile = path.join(os.tmpdir(), `dayboard-muse-${randomBytes(8).toString("hex")}.md`);
  await fs.writeFile(promptFile, `${options.system}\n\n---\n\n${options.prompt}`, {
    mode: 0o600,
  });
  // Answer-only: no file writes, no web tools, and no personal skills from other folders.
  const args = [
    "exec",
    "--json",
    "--prompt-file",
    promptFile,
    "--disable-write",
    "--disable-web-tools",
    "--no-foreign-personal-context",
    "--user-input-auto-resolve",
    "--max-model-steps",
    "12",
  ];
  if (settings.ai.museModel) args.push("--model", settings.ai.museModel);
  const state: MuseState = {
    ...createState(),
    kinds: new Map(),
    streamed: new Set(),
  };
  try {
    const outcome = await runDirect({
      label: LABEL.muse,
      bin,
      args,
      stdin: "",
      env: await getToolEnv(STRIPPED_ENV.muse),
      cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onLine: (line) => handleMuseLine(line, state, options),
    });
    const error = state.text
      ? null
      : (state.error ?? (outcome.code !== 0 ? outcome.output || "Muse failed." : null));
    if (error)
      throw new Error(
        looksLikeLoginError(error) ? LOGIN_MESSAGE.muse : redact(error).slice(0, 1200),
      );
    return state.text;
  } finally {
    await fs.rm(promptFile, { force: true });
  }
}

export function runCliCompletion(options: CliRunOptions): Promise<string> {
  return options.provider === "claude"
    ? runClaude(options)
    : options.provider === "gemini"
      ? runGemini(options)
      : options.provider === "muse"
        ? runMuse(options)
        : runCodex(options);
}

function runVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--version"],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve((String(stdout).trim() || String(stderr).trim()).split("\n").pop() ?? "");
      },
    );
  });
}

export async function checkCliProvider(
  provider: CliProvider,
  verifyLogin: boolean,
): Promise<ProviderStatus> {
  const bin = await resolveCli(provider, true);
  if (!bin) return { ok: false, reason: "missing", message: MISSING_MESSAGE[provider] };
  let version: string;
  try {
    version = await runVersion(bin);
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!verifyLogin) return { ok: true, version };
  try {
    await runCliCompletion({
      provider,
      system: "Reply with the single word OK.",
      prompt: "Are you there?",
      mcpServers: [],
      signal: new AbortController().signal,
      timeoutMs: 120_000,
      onDelta: () => undefined,
      onTool: () => undefined,
    });
    return { ok: true, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message === LOGIN_MESSAGE[provider] ? "not-logged-in" : "failed",
      message,
    };
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
