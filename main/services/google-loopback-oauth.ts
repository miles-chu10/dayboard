import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { shell } from "@glaze/core/backend";
import type { OAuthTokensInput } from "@glaze/core/oauth";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 10 * 60 * 1000;

interface LoopbackOptions {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  extraParameters: Record<string, string>;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function resultPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>DayBoard</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;margin:0"><p>${message}</p></body>`;
}

/**
 * Google "Desktop app" sign-in: PKCE plus a one-shot 127.0.0.1 redirect, as Google requires for
 * installed apps. The Desktop client secret isn't confidential by Google's design.
 */
export async function authorizeGoogleWithLoopback(
  options: LoopbackOptions,
): Promise<OAuthTokensInput> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Google sign-in timed out. Try again.")),
        TIMEOUT_MS,
      );

      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", redirectUri);
        if (url.searchParams.get("state") !== state) {
          response.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get("error");
        const received = url.searchParams.get("code");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          resultPage(
            received && !error
              ? "You're signed in. You can close this tab and return to DayBoard."
              : "Sign-in didn't finish. Return to DayBoard to try again.",
          ),
        );
        clearTimeout(timer);
        if (received && !error) resolve(received);
        else
          reject(
            new Error(
              error === "access_denied"
                ? "Google sign-in was cancelled."
                : `Google sign-in failed (${error ?? "no authorization code"}).`,
            ),
          );
      });

      const authorizeUrl = new URL(AUTHORIZE_URL);
      authorizeUrl.search = new URLSearchParams({
        ...options.extraParameters,
        response_type: "code",
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: options.scopes.join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      shell.openExternal(authorizeUrl.toString()).catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code_verifier: verifier,
      }),
    });
    const body = (await response.json()) as TokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(
        body.error_description ?? body.error ?? `Google sign-in failed (${response.status}).`,
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      idToken: body.id_token,
      expiresIn: body.expires_in,
      scope: body.scope,
      tokenType: body.token_type,
      updatedAt: new Date(),
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
