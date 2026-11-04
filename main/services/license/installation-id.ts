// Per-Mac installation identity for license activations. Wiping app data or using a second
// profile derives the same ID on the same Mac, so the license service reuses that Mac's
// activation slot instead of taking another one. The raw hardware UUID never leaves this module.

import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

import { INSTALLATION_ID_PATTERN } from "../../../shared/license-contract.js";

const IOREG = "/usr/sbin/ioreg";
const IOREG_ARGS = ["-rd1", "-c", "IOPlatformExpertDevice"];
const PLATFORM_UUID =
  /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"/;
// Changing this constant moves every Mac to a new installation ID, which takes a new slot.
const DERIVATION_KEY = "DayBoard license installation ID v1";

export type RunFile = (file: string, args: readonly string[]) => Promise<string>;

/** execFile, never a shell, so no argument is ever interpreted. */
function runFile(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024, shell: false },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** This Mac's IOPlatformUUID, or null off macOS or when ioreg can't run (for example, a sandbox). */
export async function readHardwareUuid(
  platform: NodeJS.Platform = process.platform,
  run: RunFile = runFile,
): Promise<string | null> {
  if (platform !== "darwin") return null;
  try {
    return PLATFORM_UUID.exec(await run(IOREG, IOREG_ARGS))?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 of the hardware UUID, shaped as the version-4 UUID the license contract accepts. */
export function deriveInstallationId(hardwareUuid: string): string {
  const bytes = createHmac("sha256", DERIVATION_KEY)
    .update(hardwareUuid.toUpperCase())
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x40, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * IDs for new license records: derived from this Mac's hardware UUID, or random when it is
 * unavailable. ioreg runs at most once per source.
 */
export function createInstallationIdSource(
  readUuid: () => Promise<string | null> = () => readHardwareUuid(),
): () => Promise<string> {
  let hardware: Promise<string | null> | undefined;
  return async () => {
    hardware ??= readUuid().catch(() => null);
    const uuid = await hardware;
    const derived = uuid ? deriveInstallationId(uuid) : null;
    return derived && INSTALLATION_ID_PATTERN.test(derived) ? derived : randomUUID();
  };
}
