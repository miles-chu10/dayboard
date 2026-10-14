import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import { inspect } from "node:util";
import test from "node:test";
import { build } from "esbuild";

const output = await build({
  stdin: {
    contents:
      'export * from "./main/services/google-auth.ts"; export * from "./main/services/google-oauth-errors.ts";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "fixture-google-oauth",
      setup(api) {
        api.onResolve({ filter: /^@glaze\/core\/(backend|oauth)$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        api.onResolve({ filter: /google-(oauth-app-client|loopback-oauth)\.js$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          contents: args.path.endsWith("/oauth")
            ? `export class OAuthProviderError extends Error {
                 constructor(providerError, description) {
                   super(description ?? providerError);
                   this.providerError = providerError;
                 }
               }
               export class OAuthService {
                 constructor(options) { this.options = options; }
                 async getTokens() { return globalThis.__googleRefreshFixture.tokens; }
                 async getAccessToken() {
                   const fixture = globalThis.__googleRefreshFixture;
                   fixture.accessCalls++;
                   const response = await (this.options.fetch ?? globalThis.fetch)(this.options.tokenUrl, { method: "POST" });
                   if (!response.ok) throw new OAuthProviderError(response.statusText, "private-fixture-description");
                   return "fresh-fixture-token";
                 }
                 async setTokens() { globalThis.__googleRefreshFixture.setCalls++; }
                 async removeTokens() { globalThis.__googleRefreshFixture.removeCalls++; }
                 async authorize() { throw new Error("Unexpected interactive authorization"); }
               }`
            : args.path.endsWith("/backend")
              ? `export const app = { getPath() { throw new Error("Unexpected app data access"); } };
                 export const safeStorage = {};
                 export const logger = { warn(...args) { globalThis.__googleRefreshFixture.warnings.push(args); } };`
              : args.path.includes("oauth-app-client")
                ? `export const GOOGLE_APP_CLIENT_ID = "fixture.apps.googleusercontent.com";
                   export const GOOGLE_APP_CLIENT_SECRET = "fixture-only";`
                : `export async function authorizeGoogleWithLoopback() { throw new Error("Unexpected browser sign-in"); }`,
        }));
      },
    },
  ],
});
const adapter = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);

async function withFixture(fetchImpl, run, tokens = { refreshToken: "fixture", isExpired: () => true }) {
  const originalFetch = globalThis.fetch;
  const fixture = { tokens, accessCalls: 0, setCalls: 0, removeCalls: 0, warnings: [] };
  globalThis.__googleRefreshFixture = fixture;
  globalThis.fetch = fetchImpl;
  try {
    await run(fixture);
    assert.equal(fixture.setCalls, 0);
    assert.equal(fixture.removeCalls, 0);
    assert.equal(fixture.tokens, tokens);
    assert.ok(!inspect(fixture.warnings, { depth: null }).includes("private-fixture-description"));
    assert.ok(fixture.warnings.every((warning) => warning.length === 3));
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__googleRefreshFixture;
  }
}

const rejected = (code, status = 400) =>
  new globalThis.Response(JSON.stringify({ error: code, error_description: "private-fixture-description" }), {
    status,
    statusText: "Bad Request",
  });

test("Google invalid_grant requires sign-in without removing stored credentials", async () => {
  await withFixture(async () => rejected("invalid_grant"), async (fixture) => {
    await assert.rejects(adapter.getGoogleAccessToken(), (error) => {
      assert.equal(error.reason, "not-connected");
      assert.match(error.message, /stored sign-in.*sign in again/i);
      assert.doesNotMatch(error.message, /expired/i);
      return true;
    });
    assert.deepEqual(fixture.warnings[0][2], { kind: "reauthentication", code: "invalid_grant" });
  });
});

for (const code of ["invalid_client", "invalid_request"]) {
  test(`${code} reports app configuration, not missing user sign-in`, async () => {
    await withFixture(async () => rejected(code), async (fixture) => {
      await assert.rejects(adapter.getGoogleAccessToken(), (error) => {
        assert.equal(error.reason, undefined);
        assert.match(error.message, /app sign-in configuration/);
        return true;
      });
      assert.deepEqual(fixture.warnings[0][2], { kind: "configuration", code });
    });
  });
}

for (const code of ["server_error", "temporarily_unavailable"]) {
  test(`${code} remains retryable and keeps stored authorization`, async () => {
    await withFixture(async () => rejected(code, 503), async (fixture) => {
      await assert.rejects(adapter.getGoogleAccessToken(), (error) => {
        assert.equal(error.reason, undefined);
        assert.match(error.message, /try again/);
        return true;
      });
      assert.deepEqual(fixture.warnings[0][2], { kind: "temporary", code });
    });
  });
}

test("network failure does not instruct the user to sign in again or log raw errors", async () => {
  await withFixture(async () => { throw new Error("private-fixture-description"); }, async (fixture) => {
    await assert.rejects(adapter.getGoogleAccessToken(), (error) => {
      assert.equal(error.reason, undefined);
      assert.match(error.message, /connection/);
      return true;
    });
    assert.deepEqual(fixture.warnings[0][2], { kind: "temporary", code: "unclassified" });
  });
});

test("unknown provider body is not reflected or mistaken for rejected authorization", async () => {
  await withFixture(async () => rejected("private-fixture-description"), async (fixture) => {
    await assert.rejects(adapter.getGoogleAccessToken(), /try again/);
    assert.deepEqual(fixture.warnings[0][2], { kind: "temporary", code: "unclassified" });
  });
});

test("missing stored authorization does not start a token request", async () => {
  await withFixture(async () => { throw new Error("Unexpected request"); }, async (fixture) => {
    await assert.rejects(adapter.getGoogleAccessToken(), (error) => error.reason === "not-connected");
    assert.equal(fixture.accessCalls, 0);
  }, null);
});

test("expired access without refresh authorization requires sign-in without a request", async () => {
  await withFixture(async () => { throw new Error("Unexpected request"); }, async (fixture) => {
    await assert.rejects(adapter.getGoogleAccessToken(), /session expired/i);
    assert.equal(fixture.accessCalls, 0);
  }, { isExpired: () => true });
});

test("successful SDK refresh returns its access token normally", async () => {
  await withFixture(async () => new globalThis.Response("{}"), async (fixture) => {
    assert.equal(await adapter.getGoogleAccessToken(), "fresh-fixture-token");
    assert.equal(fixture.warnings.length, 0);
  });
});

test("successful and non-token responses remain untouched for their caller", async () => {
  const responses = [new globalThis.Response('{"ok":true}'), rejected("invalid_grant")];
  await withFixture(async () => responses.shift(), async () => {
    const success = await adapter.googleOAuthFetch("https://oauth2.googleapis.com/token");
    assert.equal(success.bodyUsed, false);
    assert.deepEqual(await success.json(), { ok: true });
    const other = await adapter.googleOAuthFetch("https://example.invalid/token");
    assert.equal(other.status, 400);
    assert.equal(other.bodyUsed, false);
  });
});


test("unrecognized failed token JSON remains readable for the SDK", async () => {
  const body = JSON.stringify({ error: "unknown-fixture-code", error_description: "private-fixture-description" });
  await withFixture(async () => new globalThis.Response(body, { status: 400 }), async () => {
    const response = await adapter.googleOAuthFetch(adapter.GOOGLE_TOKEN_URL);
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), body);
  });
});

test("non-JSON token failure remains readable for the SDK", async () => {
  const body = "<html>private-fixture-description</html>";
  await withFixture(async () => new globalThis.Response(body, { status: 503 }), async () => {
    const response = await adapter.googleOAuthFetch(adapter.GOOGLE_TOKEN_URL);
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), body);
  });
});

test("URL and Request inputs retain rejected-grant classification", async () => {
  await withFixture(async () => rejected("invalid_grant"), async () => {
    for (const input of [new URL(adapter.GOOGLE_TOKEN_URL), new globalThis.Request(adapter.GOOGLE_TOKEN_URL)]) {
      await assert.rejects(adapter.googleOAuthFetch(input), (error) => {
        assert.deepEqual(adapter.googleTokenFailure(error), { kind: "reauthentication", code: "invalid_grant" });
        assert.ok(!inspect(error).includes("private-fixture-description"));
        return true;
      });
    }
  });
});
