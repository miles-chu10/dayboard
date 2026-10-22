import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { notarize } from "@electron/notarize";

function staple(appPath) {
  const result = spawnSync("xcrun", ["stapler", "staple", "-v", appPath], { encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

/**
 * Stapling looks the ticket up in Apple's CloudKit, which can drop the connection; Apple advises
 * retrying. @electron/notarize 2.5.0 staples once, because it never calls promise-retry's retry.
 */
export async function stapleWithRetries(
  appPath,
  { attempts = 5, delayMs = 15_000, run = staple, wait = delay } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    const result = run(appPath);
    if (result.ok) return attempt;
    if (attempt >= attempts)
      throw new Error(`Stapling failed after ${attempts} attempts.\n\n${result.output}`);
    console.warn(`Stapling attempt ${attempt} of ${attempts} failed; retrying.`);
    await wait(delayMs * attempt);
  }
}

/** electron-builder afterSign hook for the signed workflows, in place of built-in notarization. */
export default async function notarizeApp(
  context,
  { env = process.env, submit = notarize, stapleApp = stapleWithRetries } = {},
) {
  if (context.electronPlatformName !== "darwin") return;
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER)
    throw new Error("Notarization requires APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.");
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    await submit({
      tool: "notarytool",
      appPath,
      appleApiKey: APPLE_API_KEY,
      appleApiKeyId: APPLE_API_KEY_ID,
      appleApiIssuer: APPLE_API_ISSUER,
    });
  } catch (error) {
    // notarize() staples only after Apple accepts the submission, so only stapling is retried.
    if (!(error instanceof Error) || !error.message.startsWith("Failed to staple")) throw error;
    await stapleApp(appPath);
  }
}
