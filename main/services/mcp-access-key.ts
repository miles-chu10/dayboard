import { randomBytes, timingSafeEqual } from "node:crypto";
import * as path from "node:path";

import { app, safeStorage } from "../platform/index.js";

import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./file-store.js";

// Access key for external MCP clients (Claude Code, Codex, …). It persists across launches
// so configured clients keep working, and is stored encrypted like other credentials.

const queue = createSerialQueue();
let cachedKey: string | null = null;

function keyPath(): string {
  return path.join(app.getPath("userData"), "mcp-access-key.bin");
}

async function writeNewKey(): Promise<string> {
  const key = `dayboard_${randomBytes(32).toString("base64url")}`;
  await writeFileAtomic(keyPath(), await safeStorage.encryptString(key));
  cachedKey = key;
  return key;
}

export function getMcpAccessKey(): Promise<string> {
  return queue(async () => {
    if (cachedKey) return cachedKey;
    const stored = await readFileIfExists(keyPath());
    if (!stored) return writeNewKey();
    const key = await safeStorage.decryptString(stored);
    cachedKey = key;
    return key;
  });
}

/** Replaces the key, disconnecting every client until it is given the new one. */
export function regenerateMcpAccessKey(): Promise<string> {
  return queue(writeNewKey);
}

export async function isValidMcpBearer(header: string | undefined): Promise<boolean> {
  const expected = Buffer.from(`Bearer ${await getMcpAccessKey()}`);
  const supplied = Buffer.from(header ?? "");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
