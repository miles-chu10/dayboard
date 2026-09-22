import { execFile } from "node:child_process";

import type { CodexModelInfo } from "../../shared-types.js";
import { getToolEnv } from "../shell-env.js";
import { resolveCli } from "./cli-binaries.js";

const CACHE_MS = 10 * 60_000;

let cache: { at: number; models: CodexModelInfo[] } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function runCatalog(bin: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["-c", 'model_provider="openai"', "debug", "models"],
      { env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              "Could not load Codex models. Check Codex sign-in, then refresh the model list.",
            ),
          );
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

export function parseCodexCatalog(raw: string): CodexModelInfo[] {
  const start = raw.indexOf("{");
  const parsed: unknown = JSON.parse(start >= 0 ? raw.slice(start) : raw);
  const models =
    isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models.filter(isRecord) : [];
  return models
    .filter((model) => text(model.slug) && model.visibility === "list")
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
    .map((model) => ({
      slug: text(model.slug),
      name: text(model.display_name) || text(model.slug),
      description: text(model.description),
      defaultEffort: text(model.default_reasoning_level) || null,
      efforts: (Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels
        : []
      )
        .filter(isRecord)
        .filter((level) => text(level.effort))
        .map((level) => ({ effort: text(level.effort), description: text(level.description) })),
      tiers: (Array.isArray(model.service_tiers) ? model.service_tiers : [])
        .filter(isRecord)
        .filter((tier) => text(tier.id))
        .map((tier) => ({
          id: text(tier.id),
          name: text(tier.name) || text(tier.id),
          description: text(tier.description),
        })),
    }));
}

/** Models the installed Codex CLI offers for this account, from `codex debug models`. */
export async function listCodexModels(refresh = false): Promise<CodexModelInfo[]> {
  if (cache && !refresh && Date.now() - cache.at < CACHE_MS) return cache.models;
  const bin = await resolveCli("codex");
  if (!bin) throw new Error("Codex CLI isn't installed, so its model list isn't available.");
  const models = parseCodexCatalog(
    await runCatalog(bin, await getToolEnv(["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"])),
  );
  if (!models.length)
    throw new Error("Codex didn't report any models. Try updating the Codex CLI.");
  cache = { at: Date.now(), models };
  return models;
}
