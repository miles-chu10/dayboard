import type { AIProvider, CliProviderId } from "../../shared-types.js";
import { getApiKey, isApiProvider } from "./api-keys.js";
import { resolveCli } from "./cli-binaries.js";

/** A saved choice is never replaced by another provider implicitly. */
export async function resolveConfiguredProvider(preferred: AIProvider): Promise<AIProvider | null> {
  if (isApiProvider(preferred)) {
    return (await getApiKey(preferred)) ? preferred : null;
  }
  const cliProviders: readonly CliProviderId[] = ["claude", "codex", "gemini", "muse"];
  if (!cliProviders.includes(preferred as CliProviderId)) return null;
  // An executable is only an installation check; the request itself verifies authentication.
  return (await resolveCli(preferred as CliProviderId)) ? preferred : null;
}
