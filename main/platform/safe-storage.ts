// Async wrapper over Electron's (synchronous, Keychain-backed) safeStorage, per main/platform/README.md.

import { safeStorage as electronSafeStorage } from "electron";

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return electronSafeStorage.isEncryptionAvailable();
  },
  async encryptString(text: string): Promise<Buffer> {
    if (!electronSafeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage (Keychain) is unavailable on this machine.");
    }
    return electronSafeStorage.encryptString(text);
  },
  async decryptString(buffer: Buffer): Promise<string> {
    if (!electronSafeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage (Keychain) is unavailable on this machine.");
    }
    return electronSafeStorage.decryptString(buffer);
  },
};
