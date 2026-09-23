import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app, logger } from "../platform/index.js";
import { OAuthService, OAuthTokenStateChangedError } from "../platform/index.js";

import type { GoogleAccountStatus } from "../shared-types.js";
import { GOOGLE_APP_CLIENT_ID, GOOGLE_APP_CLIENT_SECRET } from "./google-oauth-app-client.js";
import { authorizeGoogleWithLoopback } from "./google-loopback-oauth.js";

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

let cachedProfile: GoogleAccountProfile | null | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function profilePath(): string {
  return path.join(app.getPath("userData"), "google-account.json");
}

function appClient(): { clientId: string; clientSecret: string } | null {
  const clientId = GOOGLE_APP_CLIENT_ID.trim();
  const clientSecret = GOOGLE_APP_CLIENT_SECRET.trim();
  if (!clientId || !clientSecret) return null;
  if (!clientId.endsWith(".apps.googleusercontent.com")) return null;
  return { clientId, clientSecret };
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

let service: OAuthService | null = null;

function getService(client: { clientId: string; clientSecret: string }): OAuthService {
  if (service) return service;
  service = new OAuthService({
    providerId: "google-desktop",
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    extraAuthorizationParameters: AUTHORIZATION_PARAMETERS,
  });
  return service;
}

export async function getGoogleStatus(): Promise<GoogleAccountStatus> {
  const client = appClient();
  if (!client) {
    return { hasCredentials: false, connected: false, email: null, clientIdHint: null };
  }
  const tokens = await getService(client).getTokens();
  return {
    hasCredentials: true,
    connected: tokens !== null,
    email: (await readProfile()).email,
    clientIdHint: null,
  };
}

export async function connectGoogle(): Promise<void> {
  const client = appClient();
  if (!client) {
    throw new GoogleAuthError(
      "needs-setup",
      "Google sign-in isn't configured in this build. Add the app OAuth client and try again.",
    );
  }
  const oauth = getService(client);
  const tokens = await authorizeGoogleWithLoopback({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scopes: SCOPES,
    extraParameters: AUTHORIZATION_PARAMETERS,
  });
  await oauth.setTokens(tokens);
  const accessToken = tokens.accessToken;
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
}

export async function disconnectGoogle(): Promise<void> {
  const client = appClient();
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
}

export async function getGoogleAccessToken(): Promise<string> {
  const client = appClient();
  if (!client) {
    throw new GoogleAuthError("needs-setup", "Google sign-in isn't configured in this build.");
  }
  const oauth = getService(client);
  try {
    return await oauth.getAccessToken();
  } catch (error) {
    if (error instanceof OAuthTokenStateChangedError)
      throw new Error("Your Google account changed during this request. Try again.");
    logger.warn("google-auth", "Google token refresh failed", error);
    throw new GoogleAuthError("not-connected", "Google session expired. Sign in again.");
  }
}
