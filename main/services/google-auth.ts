import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, logger, safeStorage } from "@glaze/core/backend";
import { OAuthService } from "@glaze/core/oauth";

import type { GoogleAccountStatus } from "../shared-types.js";

export const GOOGLE_REDIRECT_URI = "https://www.glaze.app/api/oauth/callback";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

interface StoredGoogleConfig {
  clientId: string;
  clientSecret: string;
  email: string | null;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly reason: "needs-setup" | "not-connected",
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

let cachedConfig: StoredGoogleConfig | null | undefined;
let service: { clientId: string; instance: OAuthService } | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function configPath(): string {
  return path.join(app.getPath("userData"), "google-config.bin");
}

function isStoredConfig(value: unknown): value is StoredGoogleConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.clientId === "string" &&
    typeof v.clientSecret === "string" &&
    (v.email === null || typeof v.email === "string")
  );
}

async function readConfig(): Promise<StoredGoogleConfig | null> {
  if (cachedConfig !== undefined) return cachedConfig;
  let encrypted: Buffer;
  try {
    encrypted = await fs.readFile(configPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      cachedConfig = null;
      return null;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(await safeStorage.decryptString(encrypted));
  if (!isStoredConfig(parsed)) {
    throw new Error(`Google configuration at ${configPath()} is malformed. Re-enter your client in Settings.`);
  }
  cachedConfig = parsed;
  return parsed;
}

function writeConfig(config: StoredGoogleConfig | null): Promise<void> {
  const run = async () => {
    const target = configPath();
    if (config === null) {
      await fs.rm(target, { force: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, await safeStorage.encryptString(JSON.stringify(config)));
      await fs.rename(tmp, target);
    }
    cachedConfig = config;
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

function getService(config: StoredGoogleConfig): OAuthService {
  if (service?.clientId === config.clientId) return service.instance;
  const instance = new OAuthService({
    providerId: "google",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    extraAuthorizationParameters: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  });
  service = { clientId: config.clientId, instance };
  return instance;
}

function clientIdHint(clientId: string): string {
  const head = clientId.split(".")[0] ?? clientId;
  return head.length > 12 ? `${head.slice(0, 6)}…${head.slice(-4)}` : head;
}

export async function getGoogleStatus(): Promise<GoogleAccountStatus> {
  const config = await readConfig();
  if (!config) return { hasCredentials: false, connected: false, email: null, clientIdHint: null };
  const tokens = await getService(config).getTokens();
  return {
    hasCredentials: true,
    connected: tokens !== null,
    email: config.email,
    clientIdHint: clientIdHint(config.clientId),
  };
}

export async function saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void> {
  const existing = await readConfig();
  if (existing && existing.clientId !== clientId) {
    await getService(existing).removeTokens();
  }
  await writeConfig({
    clientId,
    clientSecret,
    email: existing?.clientId === clientId ? existing.email : null,
  });
}

export async function clearGoogleCredentials(): Promise<void> {
  const existing = await readConfig();
  if (existing) await getService(existing).removeTokens();
  service = null;
  await writeConfig(null);
}

export async function connectGoogle(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    throw new GoogleAuthError("needs-setup", "Add your Google OAuth Client ID and Secret in Settings first.");
  }
  const tokens = await getService(config).authorize();
  let email: string | null = null;
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (response.ok) {
      const info = (await response.json()) as { email?: unknown };
      email = typeof info.email === "string" ? info.email : null;
    }
  } catch (error) {
    logger.warn("google-auth", "Could not read Google account email", error);
  }
  await writeConfig({ ...config, email });
}

export async function disconnectGoogle(): Promise<void> {
  const config = await readConfig();
  if (!config) return;
  const oauth = getService(config);
  const tokens = await oauth.getTokens();
  const revokable = tokens?.refreshToken ?? tokens?.accessToken;
  if (revokable) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokable)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (error) {
      logger.warn("google-auth", "Token revocation failed; removing local tokens anyway", error);
    }
  }
  await oauth.removeTokens();
  await writeConfig({ ...config, email: null });
}

export async function getGoogleAccessToken(): Promise<string> {
  const config = await readConfig();
  if (!config) {
    throw new GoogleAuthError("needs-setup", "Google is not set up. Add your OAuth client in Settings.");
  }
  const oauth = getService(config);
  if (!(await oauth.getTokens())) {
    throw new GoogleAuthError("not-connected", "Google account is not connected.");
  }
  try {
    return await oauth.getAccessToken();
  } catch (error) {
    logger.warn("google-auth", "Google token refresh failed", error);
    throw new GoogleAuthError("not-connected", "Google session expired. Reconnect your account.");
  }
}
