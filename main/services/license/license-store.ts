// Real (Electron-backed) LicenseStore. Kept out of license-service.ts and loaded lazily via
// dynamic import from index.ts, mirroring main/platform/oauth-store.ts, so unit-testing the
// service's state machine never has to touch Electron.

import * as path from "node:path";
import { INSTALLATION_ID_PATTERN, LICENSE_KEY_PATTERN } from "../../../shared/license-contract.js";

import { app, safeStorage } from "../../platform/index.js";
import {
  copyFileIfPresent,
  createSerialQueue,
  readFileIfExists,
  writeFileAtomic,
} from "../file-store.js";
import { createInstallationIdSource } from "./installation-id.js";
import {
  MAX_PENDING_RELEASES,
  UnreadableLicenseRecordError,
  type LicenseRecord,
  type LicenseStore,
} from "./license-service.js";

function licensePath(): string {
  return path.join(app.getPath("userData"), "license-stripe-v2.bin");
}

function legacyPath(): string {
  return path.join(app.getPath("userData"), "license.bin");
}

/** Next to the license file, e.g. license-stripe-v2.unreadable-2026-11-04T09-30-00-000Z.bin. */
function backupPath(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(app.getPath("userData"), `license-stripe-v2.unreadable-${stamp}.bin`);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validBinding(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.issuer === "string" &&
    typeof value.productId === "string" &&
    (value.environment === "test" || value.environment === "live")
  );
}

function validPendingReleases(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_PENDING_RELEASES &&
      value.every(
        (item) =>
          object(item) &&
          typeof item.licenseKey === "string" &&
          LICENSE_KEY_PATTERN.test(item.licenseKey) &&
          typeof item.instanceId === "string" &&
          item.instanceId.trim().length > 0 &&
          validBinding(item.binding),
      ))
  );
}

function parseCurrent(raw: unknown): LicenseRecord {
  if (
    !object(raw) ||
    raw.version !== 2 ||
    typeof raw.installationId !== "string" ||
    !INSTALLATION_ID_PATTERN.test(raw.installationId) ||
    !validTimestamp(raw.firstLaunchAt) ||
    (raw.licenseKey !== null &&
      (typeof raw.licenseKey !== "string" || !LICENSE_KEY_PATTERN.test(raw.licenseKey))) ||
    (raw.instanceId !== null && (typeof raw.instanceId !== "string" || !raw.instanceId.trim())) ||
    (raw.instanceName !== null && typeof raw.instanceName !== "string") ||
    (raw.lastValidationAt !== null && !validTimestamp(raw.lastValidationAt)) ||
    (raw.lastValidationValid !== null && typeof raw.lastValidationValid !== "boolean") ||
    (raw.lastValidationMessage !== null && typeof raw.lastValidationMessage !== "string") ||
    (raw.productBinding !== null && !validBinding(raw.productBinding)) ||
    !validPendingReleases(raw.pendingReleases)
  ) {
    throw new Error("Saved DayBoard license record is invalid.");
  }
  return raw as unknown as LicenseRecord;
}

/**
 * Decrypts and parses a saved file. A missing Keychain stays a plain (retryable) error; bytes the
 * Keychain can't decrypt, or contents that don't parse, are reported as unreadable.
 */
async function decode<T>(bytes: Buffer, parse: (value: unknown) => T): Promise<T> {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Secure storage (Keychain) is unavailable on this machine.");
  let text: string;
  try {
    text = await safeStorage.decryptString(bytes);
  } catch {
    throw new UnreadableLicenseRecordError(
      "Saved DayBoard license data can't be decrypted on this Mac.",
    );
  }
  try {
    return parse(JSON.parse(text) as unknown);
  } catch {
    throw new UnreadableLicenseRecordError("Saved DayBoard license record is invalid.");
  }
}

class FileLicenseStore implements LicenseStore {
  private readonly queue = createSerialQueue();

  constructor(private readonly installationId: () => Promise<string>) {}

  async read(): Promise<LicenseRecord | null> {
    return this.queue(async () => {
      const raw = await readFileIfExists(licensePath());
      if (raw?.length) return decode(raw, parseCurrent);
      // Migrate the trial anchor only. The original encrypted file remains untouched and no
      // legacy key, instance, or merchant binding enters the new service.
      const legacy = await readFileIfExists(legacyPath());
      if (!legacy?.length) return null;
      const decoded = await decode(legacy, (value) => value);
      if (!object(decoded) || !validTimestamp(decoded.firstLaunchAt)) return null;
      const migrated: LicenseRecord = {
        version: 2,
        installationId: await this.installationId(),
        licenseKey: null,
        instanceId: null,
        instanceName: null,
        firstLaunchAt: decoded.firstLaunchAt,
        lastValidationAt: null,
        lastValidationValid: null,
        lastValidationMessage: null,
        productBinding: null,
      };
      await writeFileAtomic(
        licensePath(),
        await safeStorage.encryptString(JSON.stringify(parseCurrent(migrated))),
      );
      return migrated;
    });
  }

  async write(record: LicenseRecord): Promise<void> {
    return this.queue(async () => {
      parseCurrent(record);
      const encrypted = await safeStorage.encryptString(JSON.stringify(record));
      await writeFileAtomic(licensePath(), encrypted);
    });
  }

  /**
   * Nothing is deleted: the unreadable bytes are copied to a timestamped backup that never
   * replaces another file, and only then is the new record atomically saved over the original.
   * Encrypting first means a broken Keychain changes no files. An unreadable legacy file is
   * left as is, since the new record takes precedence over it.
   */
  async replaceUnreadable(record: LicenseRecord): Promise<void> {
    return this.queue(async () => {
      parseCurrent(record);
      const encrypted = await safeStorage.encryptString(JSON.stringify(record));
      await copyFileIfPresent(licensePath(), backupPath(new Date()));
      await writeFileAtomic(licensePath(), encrypted);
    });
  }
}

let shared: FileLicenseStore | undefined;

/** `installationId` names new records; by default derived from this Mac's hardware UUID. */
export function createDefaultLicenseStore(
  options: { installationId?: () => Promise<string> } = {},
): LicenseStore {
  shared ??= new FileLicenseStore(options.installationId ?? createInstallationIdSource());
  return shared;
}
