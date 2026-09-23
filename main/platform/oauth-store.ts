// Real (Electron-backed) TokenStore for OAuthService. Kept out of oauth.ts and loaded lazily via
// dynamic import so unit-testing oauth.ts's refresh logic never has to touch Electron.

import { app } from "electron";
import * as path from "node:path";

import { safeStorage } from "./safe-storage.js";
import { createSerialQueue, readFileIfExists, writeFileAtomic } from "./fs-atomic.js";
import type { OAuthTokensInput, TokenStore } from "./oauth.js";

interface StoredTokensInput extends Omit<OAuthTokensInput, "updatedAt"> {
  updatedAt: string;
}

function tokensPath(): string {
  return path.join(app.getPath("userData"), "oauth-tokens.json");
}

function serialize(tokens: OAuthTokensInput): StoredTokensInput {
  return {
    ...tokens,
    updatedAt: (tokens.updatedAt ?? new Date()).toISOString(),
  };
}

function deserialize(stored: StoredTokensInput): OAuthTokensInput {
  return { ...stored, updatedAt: new Date(stored.updatedAt) };
}

/** One encrypted JSON file under userData holding every provider's tokens, keyed by providerId. */
class FileTokenStore implements TokenStore {
  private readonly queue = createSerialQueue();

  private async readAll(): Promise<Record<string, StoredTokensInput>> {
    const raw = await readFileIfExists(tokensPath());
    if (!raw || !raw.length) return {};
    const decrypted = await safeStorage.decryptString(raw);
    const parsed: unknown = JSON.parse(decrypted);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, StoredTokensInput>)
      : {};
  }

  private async writeAll(all: Record<string, StoredTokensInput>): Promise<void> {
    const encrypted = await safeStorage.encryptString(JSON.stringify(all));
    await writeFileAtomic(tokensPath(), encrypted);
  }

  async read(providerId: string): Promise<OAuthTokensInput | null> {
    return this.queue(async () => {
      const all = await this.readAll();
      const stored = all[providerId];
      return stored ? deserialize(stored) : null;
    });
  }

  async write(providerId: string, tokens: OAuthTokensInput): Promise<void> {
    return this.queue(async () => {
      const all = await this.readAll();
      all[providerId] = serialize(tokens);
      await this.writeAll(all);
    });
  }

  async remove(providerId: string): Promise<void> {
    return this.queue(async () => {
      const all = await this.readAll();
      if (!(providerId in all)) return;
      delete all[providerId];
      await this.writeAll(all);
    });
  }
}

let shared: FileTokenStore | undefined;

export function createDefaultTokenStore(): TokenStore {
  shared ??= new FileTokenStore();
  return shared;
}
