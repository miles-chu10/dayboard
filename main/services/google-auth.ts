import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, logger, safeStorage } from "@glaze/core/backend";
import { OAuthService } from "@glaze/core/oauth";

import type { GoogleAccountStatus } from "../shared-types.js";
import { GOOGLE_APP_CLIENT_ID, GOOGLE_APP_CLIENT_SECRET } from "./google-oauth-app-client.js";
import { authorizeGoogleWithLoopback } from "./google-loopback-oauth.js";

export const GOOGLE_REDIRECT_URI = "https://www.glaze.app/api/oauth/callback";

const AUTHORIZATION_PARAMETERS = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
};

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

/** Legacy user-pasted client (pre–public login). */
interface LegacyGoogleConfig {
  clientId: string;
  clientSecret: string;
  email: string | null;
}

/** "app" = built-in Desktop client (loopback sign-in); "legacy" = pasted Web client (Glaze relay). */
interface GoogleClient {
  kind: "app" | "legacy";
  clientId: string;
  clientSecret: string;
}

interface GoogleAccountProfile {
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

let cachedLegacy: LegacyGoogleConfig | null | undefined;
let cachedProfile: GoogleAccountProfile | null | undefined;
let service: { key: string; instance: OAuthService } | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function legacyConfigPath(): string {
  return path.join(app.getPath("userData"), "google-config.bin");
}

function profilePath(): string {
  return path.join(app.getPath("userData"), "google-account.json");
}

function isLegacyConfig(value: unknown): value is LegacyGoogleConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.clientId === "string" &&
    typeof v.clientSecret === "string" &&
    (v.email === null || typeof v.email === "string")
  );
}

function appClient(): GoogleClient | null {
  const clientId = GOOGLE_APP_CLIENT_ID.trim();
  const clientSecret = GOOGLE_APP_CLIENT_SECRET.trim();
  if (!clientId || !clientSecret) return null;
  if (!clientId.endsWith(".apps.googleusercontent.com")) return null;
  return { kind: "app", clientId, clientSecret };
}

async function readLegacyConfig(): Promise<LegacyGoogleConfig | null> {
  if (cachedLegacy !== undefined) return cachedLegacy;
  let encrypted: Buffer;
  try {
    encrypted = await fs.readFile(legacyConfigPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      cachedLegacy = null;
      return null;
    }
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(await safeStorage.decryptString(encrypted));
    cachedLegacy = isLegacyConfig(parsed) ? parsed : null;
  } catch (error) {
    logger.warn("google-auth", "Could not read legacy Google client config", error);
    cachedLegacy = null;
  }
  return cachedLegacy;
}

async function readProfile(): Promise<GoogleAccountProfile> {
  if (cachedProfile !== undefined) return cachedProfile ?? { email: null };
  try {
    const raw = await fs.readFile(profilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const email =
      typeof parsed === "object" &&
      parsed !== null &&
      "email" in parsed &&
      (typeof (parsed as GoogleAccountProfile).email === "string" ||
        (parsed as GoogleAccountProfile).email === null)
        ? (parsed as GoogleAccountProfile).email
        : null;
    cachedProfile = { email };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("google-auth", "Could not read Google account profile", error);
    }
    cachedProfile = { email: null };
  }
  return cachedProfile;
}

function writeProfile(profile: GoogleAccountProfile): Promise<void> {
  const run = async () => {
    await fs.mkdir(path.dirname(profilePath()), { recursive: true });
    const tmp = `${profilePath()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(profile)}\n`, { mode: 0o600 });
    await fs.rename(tmp, profilePath());
    cachedProfile = profile;
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

async function resolveClient(): Promise<GoogleClient | null> {
  const baked = appClient();
  if (baked) return baked;
  const legacy = await readLegacyConfig();
  if (legacy) {
    return { kind: "legacy", clientId: legacy.clientId, clientSecret: legacy.clientSecret };
  }
  return null;
}

function legacyClient(config: LegacyGoogleConfig): GoogleClient {
  return { kind: "legacy", clientId: config.clientId, clientSecret: config.clientSecret };
}

function getService(client: GoogleClient): OAuthService {
  const key = `${client.kind}:${client.clientId}`;
  if (service?.key === key) return service.instance;
  const instance = new OAuthService({
    // Desktop-client tokens live apart from tokens issued to the legacy Web client.
    providerId: client.kind === "app" ? "google-desktop" : "google",
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    extraAuthorizationParameters: AUTHORIZATION_PARAMETERS,
  });
  service = { key, instance };
  return instance;
}

async function resolveEmailHint(): Promise<string | null> {
  const profile = await readProfile();
  if (profile.email) return profile.email;
  const legacy = await readLegacyConfig();
  return legacy?.email ?? null;
}

export async function getGoogleStatus(): Promise<GoogleAccountStatus> {
  const client = await resolveClient();
  if (!client) {
    return { hasCredentials: false, connected: false, email: null, clientIdHint: null };
  }
  const tokens = await getService(client).getTokens();
  return {
    hasCredentials: true,
    connected: tokens !== null,
    email: await resolveEmailHint(),
    clientIdHint: null,
  };
}

/** @deprecated Public apps use the baked-in client; kept for offline tests/migration only. */
export async function saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void> {
  const existing = await readLegacyConfig();
  if (existing && existing.clientId !== clientId) {
    await getService(legacyClient(existing)).removeTokens();
  }
  const next: LegacyGoogleConfig = {
    clientId,
    clientSecret,
    email: existing?.clientId === clientId ? existing.email : null,
  };
  const target = legacyConfigPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, await safeStorage.encryptString(JSON.stringify(next)));
  await fs.rename(tmp, target);
  cachedLegacy = next;
  service = null;
}

/** Removes a legacy pasted client. Does not remove the app-owned client. */
export async function clearGoogleCredentials(): Promise<void> {
  const existing = await readLegacyConfig();
  if (existing && !appClient()) {
    await getService(legacyClient(existing)).removeTokens();
  }
  await fs.rm(legacyConfigPath(), { force: true });
  cachedLegacy = null;
  if (!appClient()) service = null;
}

export async function connectGoogle(): Promise<void> {
  const client = await resolveClient();
  if (!client) {
    throw new GoogleAuthError(
      "needs-setup",
      "Google sign-in isn't configured in this build. Add the app OAuth client and try again.",
    );
  }
  const oauth = getService(client);
  let accessToken: string;
  if (client.kind === "app") {
    const tokens = await authorizeGoogleWithLoopback({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scopes: SCOPES,
      extraParameters: AUTHORIZATION_PARAMETERS,
    });
    await oauth.setTokens(tokens);
    accessToken = tokens.accessToken;
  } else {
    accessToken = (await oauth.authorize()).accessToken;
  }
  let email: string | null = null;
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const info = (await response.json()) as { email?: unknown };
      email = typeof info.email === "string" ? info.email : null;
    }
  } catch (error) {
    logger.warn("google-auth", "Could not read Google account email", error);
  }
  await writeProfile({ email });
  const legacy = await readLegacyConfig();
  if (legacy && legacy.clientId === client.clientId) {
    cachedLegacy = { ...legacy, email };
    const target = legacyConfigPath();
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptString(JSON.stringify(cachedLegacy)));
    await fs.rename(tmp, target);
  }
}

export async function disconnectGoogle(): Promise<void> {
  const client = await resolveClient();
  if (!client) {
    await writeProfile({ email: null });
    return;
  }
  const oauth = getService(client);
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
  await writeProfile({ email: null });
  const legacy = await readLegacyConfig();
  if (legacy) {
    cachedLegacy = { ...legacy, email: null };
    const target = legacyConfigPath();
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptString(JSON.stringify(cachedLegacy)));
    await fs.rename(tmp, target);
  }
}

export async function getGoogleAccessToken(): Promise<string> {
  const client = await resolveClient();
  if (!client) {
    throw new GoogleAuthError("needs-setup", "Google sign-in isn't configured in this build.");
  }
  const oauth = getService(client);
  if (!(await oauth.getTokens())) {
    throw new GoogleAuthError("not-connected", "Google account is not connected.");
  }
  try {
    return await oauth.getAccessToken();
  } catch (error) {
    logger.warn("google-auth", "Google token refresh failed", error);
    throw new GoogleAuthError("not-connected", "Google session expired. Sign in again.");
  }
}
