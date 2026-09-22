import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, safeStorage } from "@glaze/core/backend";

import type { OpenAIKeyStatus } from "../../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "../file-store.js";

type ApiProvider = "openai";

const queue = createSerialQueue();
const cache = new Map<ApiProvider, string | null>();

function keyPath(provider: ApiProvider): string {
  return path.join(app.getPath("userData"), `${provider}-api-key.bin`);
}

function statusFor(key: string | null): OpenAIKeyStatus {
  return {
    configured: !!key,
    hint: key ? key.slice(-4) : null,
  };
}

async function loadKey(provider: ApiProvider): Promise<string | null> {
  if (cache.has(provider)) return cache.get(provider) ?? null;
  const stored = await readFileIfExists(keyPath(provider));
  if (!stored) {
    cache.set(provider, null);
    return null;
  }
  const key = await safeStorage.decryptString(stored);
  cache.set(provider, key);
  return key;
}

export function getApiKey(provider: ApiProvider): Promise<string | null> {
  return queue(() => loadKey(provider));
}

export function getApiKeyStatus(provider: ApiProvider): Promise<OpenAIKeyStatus> {
  return queue(async () => statusFor(await loadKey(provider)));
}

export function saveApiKey(provider: ApiProvider, key: string): Promise<OpenAIKeyStatus> {
  return queue(async () => {
    const normalized = key.trim();
    if (!normalized) throw new Error("OpenAI API key is required.");
    await writeFileAtomic(keyPath(provider), await safeStorage.encryptString(normalized));
    cache.set(provider, normalized);
    return statusFor(normalized);
  });
}

export function clearApiKey(provider: ApiProvider): Promise<OpenAIKeyStatus> {
  return queue(async () => {
    cache.set(provider, null);
    await fs.rm(keyPath(provider), { force: true }).catch(() => undefined);
    return statusFor(null);
  });
}
