import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const output = await build({
  entryPoints: [fileURLToPath(new URL("../main/services/google-auth.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "fakes",
      setup(api) {
        api.onResolve(
          { filter: /(platform\/index|google-oauth-app-client|google-loopback-oauth)\.js$/ },
          (args) => ({
            path: args.path,
            namespace: "fixture",
          }),
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: args.path.includes("platform")
            ? `export const app = { getPath: () => "/tmp" };
               export const logger = { warn: (...a) => globalThis.warns.push(a), info() {}, error() {} };
               export class OAuthTokenStateChangedError extends Error {}
               export class OAuthService {
                 getTokens() { return globalThis.oauth.getTokens(); }
                 getAccessToken() { return globalThis.oauth.getAccessToken(); }
               }`
            : args.path.includes("app-client")
              ? `export const GOOGLE_APP_CLIENT_ID = "fixture.apps.googleusercontent.com"; export const GOOGLE_APP_CLIENT_SECRET = "fixture";`
              : `export async function authorizeGoogleWithLoopback() {}`,
          loader: "js",
        }));
      },
    },
  ],
});
const auth = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);

async function accessWith(oauth) {
  globalThis.oauth = oauth;
  globalThis.warns = [];
  return auth.getGoogleAccessToken();
}

for (const [name, getTokens] of [
  ["no stored tokens", async () => null],
  [
    "an unreadable token store",
    async () => {
      throw new Error("decrypt failed");
    },
  ],
]) {
  test(`reports not connected, without a refresh warning, for ${name}`, async () => {
    await assert.rejects(
      accessWith({ getTokens, getAccessToken: async () => "unused" }),
      (error) =>
        error instanceof auth.GoogleAuthError &&
        error.reason === "not-connected" &&
        error.message === "Google account is not connected.",
    );
    assert.deepEqual(globalThis.warns, []);
  });
}

test("returns the token for a connected account", async () => {
  assert.equal(
    await accessWith({
      getTokens: async () => ({ accessToken: "t" }),
      getAccessToken: async () => "token",
    }),
    "token",
  );
});

test("still reports an expired session when refreshing a connected account fails", async () => {
  await assert.rejects(
    accessWith({
      getTokens: async () => ({ accessToken: "t" }),
      getAccessToken: async () => {
        throw new Error("invalid_grant");
      },
    }),
    (error) =>
      error instanceof auth.GoogleAuthError &&
      error.message === "Google session expired. Sign in again.",
  );
  assert.equal(globalThis.warns.length, 1);
});
