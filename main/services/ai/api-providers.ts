import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

import type { ApiModelInfo, ApiProviderId, AppSettings } from "../../shared-types.js";
import { getApiKey } from "./api-keys.js";

export const API_LABEL: Record<ApiProviderId, string> = {
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  google: "Gemini API",
  xai: "xAI Grok API",
  mistral: "Mistral API",
  deepseek: "DeepSeek API",
  groq: "Groq API",
  openrouter: "OpenRouter",
};

type CompatibleProvider = Exclude<ApiProviderId, "openai" | "anthropic" | "google">;

/** Providers with OpenAI-compatible chat completions and `/models` listing. */
const COMPATIBLE_BASE_URL: Record<CompatibleProvider, string> = {
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function isCompatible(provider: ApiProviderId): provider is CompatibleProvider {
  return provider in COMPATIBLE_BASE_URL;
}

const NON_CHAT = /(embed|whisper|tts|audio|image|vision-preview|moderation|guard|ocr|transcri)/i;

const CACHE_MS = 10 * 60_000;
const modelCache = new Map<ApiProviderId, { at: number; models: ApiModelInfo[] }>();

async function requireKey(provider: ApiProviderId): Promise<string> {
  const key = await getApiKey(provider);
  if (!key) throw new Error(`Add your ${API_LABEL[provider]} key in Settings → AI.`);
  return key;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403)
    throw new Error("The API key was rejected. Check it in Settings → AI.");
  if (!response.ok) throw new Error(`Couldn't load models (${response.status}).`);
  return response.json();
}

function records(value: unknown, key: string): Record<string, unknown>[] {
  const list = (value as Record<string, unknown> | null)?.[key];
  return Array.isArray(list)
    ? list.filter(
        (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
      )
    : [];
}

/** Chat-capable models the key can use, newest first. */
export async function listApiModels(
  provider: ApiProviderId,
  refresh = false,
): Promise<ApiModelInfo[]> {
  const cached = modelCache.get(provider);
  if (cached && !refresh && Date.now() - cached.at < CACHE_MS) return cached.models;
  const key = await requireKey(provider);
  let models: ApiModelInfo[];
  if (provider === "openai") {
    const body = await fetchJson("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${key}`,
    });
    models = records(body, "data")
      .filter((model) => {
        const id = String(model.id ?? "");
        return (
          /^(gpt-|o\d|chatgpt-)/.test(id) &&
          !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(id)
        );
      })
      .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
      .map((model) => ({
        id: String(model.id),
        name: String(model.id),
        contextWindow: null,
      }));
  } else if (provider === "anthropic") {
    const body = await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
    models = records(body, "data")
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .map((model) => ({
        id: String(model.id),
        name: String(model.display_name ?? model.id),
        contextWindow: typeof model.max_input_tokens === "number" ? model.max_input_tokens : null,
      }));
  } else if (isCompatible(provider)) {
    const body = await fetchJson(`${COMPATIBLE_BASE_URL[provider]}/models`, {
      Authorization: `Bearer ${key}`,
    });
    models = records(body, "data")
      .filter((model) => !NON_CHAT.test(String(model.id ?? "")))
      .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
      .slice(0, 200)
      .map((model) => ({
        id: String(model.id),
        name: String(model.name ?? model.id),
        contextWindow:
          typeof model.context_length === "number"
            ? model.context_length
            : typeof model.context_window === "number"
              ? model.context_window
              : typeof model.max_context_length === "number"
                ? model.max_context_length
                : null,
      }));
  } else {
    const body = await fetchJson(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      {
        "x-goog-api-key": key,
      },
    );
    models = records(body, "models")
      .filter(
        (model) =>
          String(model.name ?? "").startsWith("models/gemini") &&
          Array.isArray(model.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes("generateContent"),
      )
      .map((model) => ({
        id: String(model.name).replace(/^models\//, ""),
        name: String(model.displayName ?? model.name),
        contextWindow: typeof model.inputTokenLimit === "number" ? model.inputTokenLimit : null,
      }))
      .reverse();
  }
  if (!models.length)
    throw new Error(`${API_LABEL[provider]} didn't list any chat models for this key.`);
  modelCache.set(provider, { at: Date.now(), models });
  return models;
}

/** The chosen model, or the newest listed one when none is chosen. */
export async function resolveApiModel(
  provider: ApiProviderId,
  ai: AppSettings["ai"],
): Promise<ApiModelInfo> {
  const chosen = ai.apiModels[provider];
  const models = await listApiModels(provider).catch(() => [] as ApiModelInfo[]);
  const match = models.find((model) => model.id === chosen) ?? (chosen ? null : models[0]);
  if (match) return match;
  if (chosen) return { id: chosen, name: chosen, contextWindow: null };
  throw new Error(`Choose a ${API_LABEL[provider]} model in Settings → AI.`);
}

export async function apiLanguageModel(provider: ApiProviderId, modelId: string) {
  const apiKey = await requireKey(provider);
  if (provider === "openai") return createOpenAI({ apiKey })(modelId);
  if (provider === "anthropic") return createAnthropic({ apiKey })(modelId);
  if (isCompatible(provider))
    return createOpenAI({
      apiKey,
      baseURL: COMPATIBLE_BASE_URL[provider],
      name: provider,
    }).chat(modelId);
  return createGoogleGenerativeAI({ apiKey })(modelId);
}
