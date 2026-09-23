// Re-implementation of the `@glaze/core/oauth` surface the app was written against (see
// main/platform/README.md). No Glaze SDK source was copied; only its documented API shape
// (`OAuthService`, `OAuthTokensInput`/`OAuthTokens`) was used as a reference.
//
// Token persistence is factored out as an injectable `TokenStore` so the refresh/expiry logic
// below can be unit-tested under plain `node --test` (see tests/platform-oauth.test.mjs) without
// an Electron runtime.

export interface OAuthTokensInput {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
  updatedAt?: Date;
}

export interface OAuthTokens extends OAuthTokensInput {
  updatedAt: Date;
  isExpired(): boolean;
}

export interface OAuthServiceOptions {
  providerId: string;
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes?: string[];
  extraAuthorizationParameters?: Record<string, string | number | boolean | undefined>;
  extraTokenParameters?: Record<string, string | number | boolean | undefined>;
}

export interface TokenStore {
  read(providerId: string): Promise<OAuthTokensInput | null>;
  write(providerId: string, tokens: OAuthTokensInput): Promise<void>;
  remove(providerId: string): Promise<void>;
}

/** Refresh a bit before the provider actually expires the token, to absorb clock skew and latency. */
const EXPIRY_SKEW_MS = 60_000;

function toTokens(input: OAuthTokensInput): OAuthTokens {
  const updatedAt = input.updatedAt ?? new Date();
  const expiresAt =
    input.expiresIn !== undefined ? updatedAt.getTime() + input.expiresIn * 1000 : null;
  return {
    ...input,
    updatedAt,
    isExpired(): boolean {
      return expiresAt !== null && Date.now() >= expiresAt - EXPIRY_SKEW_MS;
    },
  };
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function flattenParams(
  params: Record<string, string | number | boolean | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) result[key] = String(value);
  }
  return result;
}

/**
 * Drop-in-compatible replacement for `@glaze/core/oauth`'s `OAuthService`. `authorize()` is not
 * implemented here: Google sign-in goes through the PKCE loopback flow in
 * main/services/google-loopback-oauth.ts (outside this layer's ownership), which calls
 * `setTokens()` directly once it has a token response.
 */
export class OAuthTokenStateChangedError extends Error {
  constructor() {
    super("OAuth token state changed during the request. Try again.");
    this.name = "OAuthTokenStateChangedError";
  }
}

export class OAuthService {
  private readonly options: OAuthServiceOptions;
  private readonly fetchImpl: typeof fetch;
  private injectedStore: TokenStore | undefined;
  private defaultStore: Promise<TokenStore> | undefined;
  private lifecycleGeneration = 0;
  private pendingWrites: Promise<void> = Promise.resolve();
  private refreshInFlight: { generation: number; promise: Promise<OAuthTokens> } | null = null;

  /**
   * `deps` is test-only injection (see tests/platform-oauth.test.mjs). Production call sites
   * (main/services/google-auth.ts) construct this with just `options`; the token store then
   * lazily loads the real safeStorage-backed implementation from oauth-store.js on first use,
   * so importing this module never touches Electron.
   */
  constructor(
    options: OAuthServiceOptions,
    deps?: { store?: TokenStore; fetchImpl?: typeof fetch },
  ) {
    this.options = options;
    this.injectedStore = deps?.store;
    this.fetchImpl = deps?.fetchImpl ?? fetch;
  }

  private resolveStore(): Promise<TokenStore> {
    if (this.injectedStore) return Promise.resolve(this.injectedStore);
    if (!this.defaultStore) {
      this.defaultStore = import("./oauth-store.js").then((module) =>
        module.createDefaultTokenStore(),
      );
    }
    return this.defaultStore;
  }

  async authorize(): Promise<OAuthTokens> {
    throw new Error(
      `OAuthService.authorize() is not implemented for provider "${this.options.providerId}". ` +
        "Google sign-in uses the loopback PKCE flow in google-loopback-oauth.ts; call setTokens() with its result.",
    );
  }

  private queueWrite<T>(write: (store: TokenStore) => Promise<T>): Promise<T> {
    const run = this.pendingWrites.then(async () => write(await this.resolveStore()));
    this.pendingWrites = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.lifecycleGeneration) throw new OAuthTokenStateChangedError();
  }

  private async readSnapshot(
    boundGeneration?: number,
  ): Promise<{ generation: number; tokens: OAuthTokens | null }> {
    for (;;) {
      const generation = boundGeneration ?? this.lifecycleGeneration;
      if (boundGeneration !== undefined) this.assertGeneration(generation);
      await this.pendingWrites;
      if (boundGeneration !== undefined) this.assertGeneration(generation);
      const store = await this.resolveStore();
      const stored = await store.read(this.options.providerId);
      if (boundGeneration !== undefined) this.assertGeneration(generation);
      if (generation === this.lifecycleGeneration) {
        return { generation, tokens: stored ? toTokens(stored) : null };
      }
    }
  }

  async getTokens(): Promise<OAuthTokens | null> {
    for (;;) {
      const { generation, tokens } = await this.readSnapshot();
      if (generation === this.lifecycleGeneration) return tokens;
    }
  }

  async setTokens(tokens: OAuthTokensInput): Promise<void> {
    this.lifecycleGeneration++;
    this.refreshInFlight = null;
    const normalized: OAuthTokensInput = {
      ...tokens,
      updatedAt: tokens.updatedAt ?? new Date(),
    };
    await this.queueWrite((store) => store.write(this.options.providerId, normalized));
  }

  async removeTokens(): Promise<void> {
    this.lifecycleGeneration++;
    this.refreshInFlight = null;
    await this.queueWrite((store) => store.remove(this.options.providerId));
  }

  /** Returns a fresh access token, refreshing via `tokenUrl` first if the stored one has expired. */
  async getAccessToken(): Promise<string> {
    // An operation belongs to the account present when it starts. Retrying into a new
    // lifecycle could otherwise send an old task/calendar mutation to a different account.
    const generation = this.lifecycleGeneration;
    const { tokens } = await this.readSnapshot(generation);
    this.assertGeneration(generation);
    if (!tokens) throw new Error(`No stored tokens for provider "${this.options.providerId}".`);
    if (!tokens.isExpired()) return tokens.accessToken;
    const refreshed = await this.refresh(tokens, generation);
    this.assertGeneration(generation);
    return refreshed.accessToken;
  }

  private refresh(current: OAuthTokens, generation: number): Promise<OAuthTokens> {
    if (generation !== this.lifecycleGeneration) {
      return Promise.reject(new OAuthTokenStateChangedError());
    }
    if (this.refreshInFlight?.generation === generation) return this.refreshInFlight.promise;
    const run = async (): Promise<OAuthTokens> => {
      if (!current.refreshToken) {
        throw new Error(
          `Token for provider "${this.options.providerId}" expired and no refresh token is available. Sign in again.`,
        );
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: this.options.clientId,
        ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
        ...flattenParams(this.options.extraTokenParameters),
      });
      const response = await this.fetchImpl(this.options.tokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      let parsed: TokenResponseBody;
      try {
        parsed = (await response.json()) as TokenResponseBody;
      } catch {
        throw new Error(
          `Token refresh for provider "${this.options.providerId}" failed: invalid response (${response.status}).`,
        );
      }
      if (!response.ok || !parsed.access_token) {
        throw new Error(
          `Token refresh for provider "${this.options.providerId}" failed: ${
            parsed.error_description ?? parsed.error ?? `HTTP ${response.status}`
          }`,
        );
      }
      const next: OAuthTokensInput = {
        accessToken: parsed.access_token,
        // Most providers (Google included) omit refresh_token on refresh responses; keep the old one.
        refreshToken: parsed.refresh_token ?? current.refreshToken,
        idToken: parsed.id_token ?? current.idToken,
        expiresIn: parsed.expires_in,
        scope: parsed.scope ?? current.scope,
        tokenType: parsed.token_type ?? current.tokenType,
        updatedAt: new Date(),
      };
      const committed = await this.queueWrite(async (store) => {
        if (generation !== this.lifecycleGeneration) return false;
        await store.write(this.options.providerId, next);
        return true;
      });
      if (!committed || generation !== this.lifecycleGeneration) {
        throw new OAuthTokenStateChangedError();
      }
      return toTokens(next);
    };
    const promise = run().finally(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = null;
    });
    this.refreshInFlight = { generation, promise };
    return promise;
  }
}
