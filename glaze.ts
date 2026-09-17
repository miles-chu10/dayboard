#!/usr/bin/env node

/**
 * Thin wrapper that resolves the glaze CLI from the Glaze SDK.
 * Uses explicit SDK paths so `npm run build` etc. work without
 * relying on PATH.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const candidates = [
  // Set by the host when it launches a build — independent of where the project lives on disk.
  ...(process.env.GLAZE_SDK_PATH ? [resolve(process.env.GLAZE_SDK_PATH, "@glaze/core/cli/glaze.js")] : []),
  // Monorepo template development.
  resolve(__dirname, "../glaze-core/cli/glaze.js"),
  // Deployed app: <projects root>/<project>/sources -> <projects root>/.sdk
  // No pre-GLAZE-860 fallback here: scaffolded apps are always born in the current layout, and
  // carrying the old `sdk/current` literal makes migration 025's content check flag every fresh
  // app as needing a migration it does not need.
  resolve(__dirname, "../../.sdk/@glaze/core/cli/glaze.js"),
];

const cli = candidates.find(existsSync);
if (!cli) {
  console.error("[glaze] CLI not found. Searched:");
  candidates.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

await import(cli);
