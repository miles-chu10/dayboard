// Real (Electron-backed) LicenseStore. Kept out of license-service.ts and loaded lazily via
// dynamic import from index.ts, mirroring main/platform/oauth-store.ts, so unit-testing the
// service's state machine never has to touch Electron.

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { INSTALLATION_ID_PATTERN, LICENSE_KEY_PATTERN } from "../../../shared/license-contract.js";

import { app, safeStorage } from "../../platform/index.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "../file-store.js";
import type { LicenseRecord, LicenseStore } from "./license-service.js";

function licensePath(): string {
  return path.join(app.getPath("userData"), "license-stripe-v2.bin");
}

function legacyPath(): string {
  return path.join(app.getPath("userData"), "license.bin");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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
    (raw.productBinding !== null &&
      (!object(raw.productBinding) ||
        typeof raw.productBinding.issuer !== "string" ||
        typeof raw.productBinding.productId !== "string" ||
        (raw.productBinding.environment !== "test" && raw.productBinding.environment !== "live")))
  ) {
    throw new Error("Saved DayBoard license record is invalid.");
  }
  return raw as unknown as LicenseRecord;
}

class FileLicenseStore implements LicenseStore {
  private readonly queue = createSerialQueue();

  async read(): Promise<LicenseRecord | null> {
    return this.queue(async () => {
      const raw = await readFileIfExists(licensePath());
      if (raw?.length) {
        const decrypted = await safeStorage.decryptString(raw);
        return parseCurrent(JSON.parse(decrypted) as unknown);
      }
      // Migrate the trial anchor only. The original encrypted file remains untouched and no
      // legacy key, instance, or merchant binding enters the new service.
      const legacy = await readFileIfExists(legacyPath());
      if (!legacy?.length) return null;
      const decoded: unknown = JSON.parse(await safeStorage.decryptString(legacy));
      if (!object(decoded) || !validTimestamp(decoded.firstLaunchAt)) return null;
      const migrated: LicenseRecord = {
        version: 2,
        installationId: randomUUID(),
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
        await safeStorage.encryptString(JSON.stringify(migrated)),
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
}

let shared: FileLicenseStore | undefined;

export function createDefaultLicenseStore(): LicenseStore {
  shared ??= new FileLicenseStore();
  return shared;
}
