import { OAuthProviderError } from "@glaze/core/oauth";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_ERRORS = new Set([
  "invalid_request",
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "temporarily_unavailable",
  "server_error",
]);

export async function googleOAuthFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const response = await fetch(input, init);
  const url = input instanceof Request ? input.url : String(input);
  if (response.ok || url !== GOOGLE_TOKEN_URL) return response;

  // The SDK can report only HTTP status text; preserve Google's documented error code without
  // logging response bodies, descriptions, request headers or token parameters.
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== "object" || body === null || !("error" in body)) return response;
  const code = body.error;
  if (typeof code !== "string" || !GOOGLE_TOKEN_ERRORS.has(code)) return response;
  await response.body?.cancel().catch(() => {});
  throw new OAuthProviderError(code);
}

export function googleTokenFailure(error: unknown): {
  kind: "reauthentication" | "configuration" | "temporary";
  code: string;
} {
  const code =
    error instanceof OAuthProviderError && GOOGLE_TOKEN_ERRORS.has(error.providerError)
      ? error.providerError
      : "unclassified";
  if (code === "invalid_grant" || code === "access_denied") {
    return { kind: "reauthentication", code };
  }
  if (
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    code === "invalid_request" ||
    code === "unsupported_grant_type" ||
    code === "invalid_scope"
  ) {
    return { kind: "configuration", code };
  }
  return { kind: "temporary", code };
}
