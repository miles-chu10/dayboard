import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { CliProviderId } from "../../shared-types.js";
import { runLoginShell } from "../shell-env.js";

type CliProvider = CliProviderId;

/** Command names; Gemini subscriptions run through Google's Antigravity CLI. */
const COMMAND: Record<CliProvider, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "agy",
  muse: "muse",
};

const BINARY_CANDIDATES: Record<CliProvider, string[]> = {
  claude: [
    ".claude/local/claude",
    ".local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ".npm-global/bin/claude",
    ".bun/bin/claude",
  ],
  codex: [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    ".local/bin/codex",
    ".npm-global/bin/codex",
    ".bun/bin/codex",
  ],
  gemini: [".local/bin/agy", ".gemini/bin/agy", "/opt/homebrew/bin/agy", "/usr/local/bin/agy"],
  muse: [".local/bin/muse", "/opt/homebrew/bin/muse", "/usr/local/bin/muse"],
};

// ── Binary resolution ──────────────────────────────────────────────────────────────

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const resolvedBinaries = new Map<CliProvider, string>();

export async function resolveCli(provider: CliProvider, refresh = false): Promise<string | null> {
  if (!refresh && resolvedBinaries.has(provider)) return resolvedBinaries.get(provider)!;
  for (const candidate of BINARY_CANDIDATES[provider]) {
    const full = path.isAbsolute(candidate) ? candidate : path.join(os.homedir(), candidate);
    if (await isExecutable(full)) {
      resolvedBinaries.set(provider, full);
      return full;
    }
  }
  const command = COMMAND[provider];
  const lookup = await runLoginShell(`whence -p ${command} 2>/dev/null || command -v ${command}`);
  const found = lookup
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("/"));
  if (found && (await isExecutable(found))) {
    resolvedBinaries.set(provider, found);
    return found;
  }
  return null;
}
