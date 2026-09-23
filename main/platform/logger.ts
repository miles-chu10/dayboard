// JSON-lines file logger under ~/Library/Logs/DayBoard, mirrored to the console. Never pass
// secrets or tokens as `data` — this module does not redact anything.

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const MAX_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let logPath: string | null = null;

function resolveLogPath(): string {
  if (logPath) return logPath;
  logPath = path.join(app.getPath("logs"), "dayboard.log");
  return logPath;
}

function rotateIfNeeded(target: string): void {
  try {
    const stats = fs.statSync(target);
    if (stats.size < MAX_BYTES) return;
  } catch {
    return;
  }
  stream?.end();
  stream = null;
  try {
    fs.renameSync(target, `${target}.1`);
  } catch {
    // Best-effort; a failed rotation just means the current file keeps growing.
  }
}

function openStream(): fs.WriteStream {
  if (stream) return stream;
  const target = resolveLogPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  rotateIfNeeded(target);
  stream = fs.createWriteStream(target, { flags: "a" });
  return stream;
}

function write(level: Level, scope: string, message: string, data?: unknown): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data !== undefined ? { data: serializeData(data) } : {}),
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    openStream().write(line);
  } catch {
    // A disk write failure should never crash the app; the console line below still lands.
  }
  const consoleMethod: "log" | "info" | "warn" | "error" = level === "debug" ? "log" : level;
  console[consoleMethod](`[${scope}] ${message}`, data ?? "");
}

function serializeData(data: unknown): unknown {
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  return data;
}

export const logger = {
  debug(scope: string, message: string, data?: unknown): void {
    write("debug", scope, message, data);
  },
  info(scope: string, message: string, data?: unknown): void {
    write("info", scope, message, data);
  },
  warn(scope: string, message: string, data?: unknown): void {
    write("warn", scope, message, data);
  },
  error(scope: string, message: string, data?: unknown): void {
    write("error", scope, message, data);
  },
};
