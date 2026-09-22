import * as path from "node:path";

import { app, safeStorage } from "@glaze/core/backend";

import type { OpenAIKeyStatus } from "../../shared-types.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "../file-store.js";
import * as fs from "node:fs/promises";

// The OpenAI API key is used only for dictation, stored encrypted, and never sent to the renderer.

const queue = createSerialQueue();
let cachedKey: string | null | undefined;

function keyPath(): string {
  return path.join(app.getPath("userData"), "openai-key.bin");
}

async function readKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  const stored = await readFileIfExists(keyPath());
  cachedKey = stored ? await safeStorage.decryptString(stored) : null;
  return cachedKey;
}

export function getOpenAIKeyStatus(): Promise<OpenAIKeyStatus> {
  return queue(async () => {
    const key = await readKey();
    return { configured: Boolean(key), hint: key ? key.slice(-4) : null };
  });
}

export function saveOpenAIKey(key: string): Promise<OpenAIKeyStatus> {
  const trimmed = key.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed))
    throw new Error("That doesn't look like an OpenAI API key (it should start with sk-).");
  return queue(async () => {
    await writeFileAtomic(keyPath(), await safeStorage.encryptString(trimmed));
    cachedKey = trimmed;
    return { configured: true, hint: trimmed.slice(-4) };
  });
}

export function clearOpenAIKey(): Promise<OpenAIKeyStatus> {
  return queue(async () => {
    await fs.rm(keyPath(), { force: true });
    cachedKey = null;
    return { configured: false, hint: null };
  });
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MODELS = ["gpt-4o-mini-transcribe", "whisper-1"];

/** Sends recorded audio to OpenAI's transcription API and returns the text. */
export async function transcribe(
  audioBase64: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = await queue(readKey);
  if (!key) throw new Error("Add an OpenAI API key in Settings → AI to use dictation.");
  const audio = Buffer.from(audioBase64, "base64");
  if (!audio.length) throw new Error("No audio was recorded.");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("That recording is too long to transcribe.");
  const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "m4a";

  let lastError = "Transcription failed.";
  for (const model of MODELS) {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([audio], { type: mimeType }), `dictation.${extension}`);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { text?: unknown };
      return typeof body.text === "string" ? body.text.trim() : "";
    }
    if (response.status === 401)
      throw new Error("OpenAI rejected the API key. Update it in Settings → AI.");
    if (response.status === 429)
      throw new Error(
        "OpenAI rate limit or quota reached. Check your OpenAI billing and try again.",
      );
    lastError = `OpenAI transcription failed (${response.status}).`;
    // Try the next model only when this one isn't available to the key.
    if (response.status !== 404 && response.status !== 400) break;
  }
  throw new Error(lastError);
}
