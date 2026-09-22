import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, safeStorage } from "@glaze/core/backend";

import type { ApiKeyStatuses, ApiProviderId, OpenAIKeyStatus } from "../../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "../file-store.js";

// API keys are stored encrypted in userData and never sent to the renderer.

export const API_PROVIDERS: ApiProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
  "openrouter",
];

const FILES: Record<ApiProviderId, string> = {
  openai: "openai-key.bin",
  anthropic: "anthropic-key.bin",
  google: "google-ai-key.bin",
  xai: "xai-key.bin",
  mistral: "mistral-key.bin",
  deepseek: "deepseek-key.bin",
  groq: "groq-key.bin",
  openrouter: "openrouter-key.bin",
};

const PATTERNS: Record<ApiProviderId, { re: RegExp; hint: string }> = {
  openai: {
    re: /^sk-[A-Za-z0-9_-]{20,}$/,
    hint: "OpenAI keys start with sk-.",
  },
  anthropic: {
    re: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    hint: "Anthropic keys start with sk-ant-.",
  },
  google: {
    re: /^[A-Za-z0-9_-]{30,}$/,
    hint: "Paste the key from Google AI Studio.",
  },
  xai: { re: /^xai-[A-Za-z0-9_-]{20,}$/, hint: "xAI keys start with xai-." },
  mistral: {
    re: /^[A-Za-z0-9]{24,}$/,
    hint: "Paste the key from console.mistral.ai.",
  },
  deepseek: {
    re: /^sk-[A-Za-z0-9_-]{20,}$/,
    hint: "DeepSeek keys start with sk-.",
  },
  groq: { re: /^gsk_[A-Za-z0-9_-]{20,}$/, hint: "Groq keys start with gsk_." },
  openrouter: {
    re: /^sk-or-[A-Za-z0-9_-]{20,}$/,
    hint: "OpenRouter keys start with sk-or-.",
  },
};

const queue = createSerialQueue();
const cache = new Map<ApiProviderId, string | null>();

function keyPath(provider: ApiProviderId): string {
  return path.join(app.getPath("userData"), FILES[provider]);
}

async function read(provider: ApiProviderId): Promise<string | null> {
  if (cache.has(provider)) return cache.get(provider)!;
  const stored = await readFileIfExists(keyPath(provider));
  const key = stored ? await safeStorage.decryptString(stored) : null;
  cache.set(provider, key);
  return key;
}

function status(key: string | null): OpenAIKeyStatus {
  return { configured: Boolean(key), hint: key ? key.slice(-4) : null };
}

export function getApiKey(provider: ApiProviderId): Promise<string | null> {
  return queue(() => read(provider));
}

export function getApiKeyStatuses(): Promise<ApiKeyStatuses> {
  return queue(async () => {
    const entries = await Promise.all(
      API_PROVIDERS.map(async (provider) => [provider, status(await read(provider))] as const),
    );
    return Object.fromEntries(entries) as ApiKeyStatuses;
  });
}

export function saveApiKey(provider: ApiProviderId, key: string): Promise<OpenAIKeyStatus> {
  const trimmed = key.trim();
  if (!PATTERNS[provider].re.test(trimmed))
    throw new Error(`That doesn't look like a valid key. ${PATTERNS[provider].hint}`);
  return queue(async () => {
    await writeFileAtomic(keyPath(provider), await safeStorage.encryptString(trimmed));
    cache.set(provider, trimmed);
    return status(trimmed);
  });
}

export function clearApiKey(provider: ApiProviderId): Promise<OpenAIKeyStatus> {
  return queue(async () => {
    await fs.rm(keyPath(provider), { force: true });
    cache.set(provider, null);
    return status(null);
  });
}

export function isApiProvider(value: unknown): value is ApiProviderId {
  return API_PROVIDERS.includes(value as ApiProviderId);
}
