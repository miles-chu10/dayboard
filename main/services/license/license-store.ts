// Real (Electron-backed) LicenseStore. Kept out of license-service.ts and loaded lazily via
// dynamic import from index.ts, mirroring main/platform/oauth-store.ts, so unit-testing the
// service's state machine never has to touch Electron.

import * as path from "node:path";

import { app, safeStorage } from "../../platform/index.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "../file-store.js";
import type { LicenseRecord, LicenseStore } from "./license-service.js";

function licensePath(): string {
  return path.join(app.getPath("userData"), "license.bin");
}

class FileLicenseStore implements LicenseStore {
  private readonly queue = createSerialQueue();

  async read(): Promise<LicenseRecord | null> {
    return this.queue(async () => {
      const raw = await readFileIfExists(licensePath());
      if (!raw || !raw.length) return null;
      const decrypted = await safeStorage.decryptString(raw);
      return JSON.parse(decrypted) as LicenseRecord;
    });
  }

  async write(record: LicenseRecord): Promise<void> {
    return this.queue(async () => {
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
