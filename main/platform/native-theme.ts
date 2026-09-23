import { app, nativeTheme } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ThemeSource } from "../../shared/bridge-protocol.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./fs-atomic.js";
import { logger } from "./logger.js";

const writes = createSerialQueue();
let savedPath: string | undefined;

function preferencePath(): string {
  if (!savedPath) {
    const userData = app.getPath("userData");
    const demo = existsSync(path.join(userData, "demo-mode"));
    savedPath = path.join(userData, demo ? "demo-native-theme.json" : "native-theme.json");
  }
  return savedPath;
}

function isThemeSource(value: unknown): value is ThemeSource {
  return value === "system" || value === "light" || value === "dark";
}

export async function loadNativeTheme(): Promise<void> {
  try {
    const data = await readFileIfExists(preferencePath());
    if (!data) return;
    const parsed: unknown = JSON.parse(data.toString("utf8"));
    if (isThemeSource(parsed)) nativeTheme.themeSource = parsed;
  } catch {
    logger.warn("appearance", "Could not restore the saved appearance; using system theme.");
  }
}

export function saveNativeTheme(source: ThemeSource): Promise<void> {
  if (!isThemeSource(source)) return Promise.reject(new Error("Invalid theme source"));
  return writes(async () => {
    await writeFileAtomic(preferencePath(), `${JSON.stringify(source)}\n`);
    nativeTheme.themeSource = source;
  });
}

export const drainNativeThemeWrites = writes.drain;
