import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

async function loadOAuthService() {
  const result = await build({
    entryPoints: [path.join(root, "main/platform/oauth.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

function memoryStore() {
  const byProvider = new Map();
  return {
    async read(providerId) {
      return byProvider.get(providerId) ?? null;
    },
    async write(providerId, tokens) {
      byProvider.set(providerId, tokens);
    },
    async remove(providerId) {
      byProvider.delete(providerId);
    },
    _dump: byProvider,
  };
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function baseOptions(overrides = {}) {
  return {
    providerId: "google-desktop",
    clientId: "client-id",
    clientSecret: "client-secret",
    authorizeUrl: "https://example.test/authorize",
    tokenUrl: "https://example.test/token",
    scopes: ["email"],
    ...overrides,
  };
}

async function loadGoogleApi(service) {
  globalThis.__fixtureOAuth = service;
  const bundled = await build({
    entryPoints: [path.join(root, "main/services/google-api.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "oauth-account-fixture",
        setup(api) {
          api.onResolve({ filter: /google-auth\.js$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export class GoogleAuthError extends Error {} export const getGoogleAccessToken = () => globalThis.__fixtureOAuth.getAccessToken();",
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n// ${bundleSequence++}`).toString("base64")}`
  );
}

for (const boundary of ["read", "refresh", "commit"]) {
  test(`Google mutations reject an account replacement during token ${boundary}`, async () => {
    const { OAuthService } = await loadOAuthService();
    const store = memoryStore();
    const started = deferred();
    const release = deferred();
    let pauseRead = boundary === "read";
    const read = store.read;
    store.read = async (id) => {
      const snapshot = await read(id);
      if (pauseRead) {
        pauseRead = false;
        started.resolve();
        await release.promise;
      }
      return snapshot;
    };
    const write = store.write;
    store.write = async (id, tokens) => {
      if (boundary === "commit" && tokens.accessToken === "stale") {
        started.resolve();
        await release.promise;
      }
      await write(id, tokens);
    };
    const service = new OAuthService(baseOptions(), {
      store,
      fetchImpl: fakeFetch(async () => {
        if (boundary === "refresh") {
          started.resolve();
          await release.promise;
        }
        return jsonResponse(200, { access_token: "stale", expires_in: 3600 });
      }),
    });
    await service.setTokens({
      accessToken: "account-a",
      refreshToken: "refresh-a",
      expiresIn: -10,
    });
    const google = await loadGoogleApi(service);
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, authorization: init.headers.Authorization });
      return new Response(JSON.stringify({ id: "fixture-task" }), { status: 200 });
    };
    try {
      const mutation = google.createTask({ title: "Account A request" });
      const rejected = assert.rejects(mutation, /token state changed/);
      await started.promise;
      const replace = service.setTokens({
        accessToken: "account-b",
        refreshToken: "refresh-b",
        expiresIn: 3600,
      });
      if (boundary !== "commit") await replace;
      release.resolve();
      await replace;
      await rejected;
      assert.equal(requests.length, 0, "an old request must not use the replacement account");
      assert.equal((await service.getTokens()).accessToken, "account-b");
      await google.createTask({ title: "New account B request" });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].authorization, "Bearer account-b");
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.__fixtureOAuth;
    }
  });
}

test("setTokens/getTokens/removeTokens round-trip through the injected store", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const service = new OAuthService(baseOptions(), { store });

  assert.equal(await service.getTokens(), null);
  await service.setTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600 });
  const tokens = await service.getTokens();
  assert.equal(tokens.accessToken, "at-1");
  assert.equal(tokens.isExpired(), false);

  await service.removeTokens();
  assert.equal(await service.getTokens(), null);
});

test("getAccessToken returns the stored token without a network call when not expired", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const fetchImpl = fakeFetch(() => {
    throw new Error("should not fetch");
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600 });

  assert.equal(await service.getAccessToken(), "at-1");
  assert.equal(fetchImpl.calls.length, 0);
});

test("getAccessToken refreshes via tokenUrl when the stored token has expired", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const fetchImpl = fakeFetch((url) => {
    assert.equal(url, "https://example.test/token");
    return jsonResponse(200, {
      access_token: "at-2",
      expires_in: 3600,
      token_type: "Bearer",
    });
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: -10 });

  const accessToken = await service.getAccessToken();
  assert.equal(accessToken, "at-2");
  assert.equal(fetchImpl.calls.length, 1);

  const body = fetchImpl.calls[0].init.body;
  const params = new URLSearchParams(body.toString());
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "rt-1");
  assert.equal(params.get("client_id"), "client-id");

  // The refreshed token, including the carried-over refresh token, was persisted.
  const stored = await store.read("google-desktop");
  assert.equal(stored.accessToken, "at-2");
  assert.equal(stored.refreshToken, "rt-1");
});

test("concurrent getAccessToken calls during a refresh only hit the network once", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  let calls = 0;
  const fetchImpl = fakeFetch(() => {
    calls += 1;
    return jsonResponse(200, { access_token: "at-2", expires_in: 3600 });
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: -10 });

  const [first, second] = await Promise.all([service.getAccessToken(), service.getAccessToken()]);
  assert.equal(first, "at-2");
  assert.equal(second, "at-2");
  assert.equal(calls, 1);
});

test("removing tokens during a delayed refresh cannot restore or return the old account", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const fetchStarted = deferred();
  const response = deferred();
  const fetchImpl = fakeFetch(() => {
    fetchStarted.resolve();
    return response.promise;
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "old", refreshToken: "old-refresh", expiresIn: -10 });

  const pending = service.getAccessToken();
  await fetchStarted.promise;
  await service.removeTokens();
  response.resolve(jsonResponse(200, { access_token: "stale", expires_in: 3600 }));

  await assert.rejects(pending, /token state changed/);
  assert.equal(await service.getTokens(), null);
  assert.equal(store._dump.size, 0);
});

test("replacing tokens during a delayed refresh rejects the old request and permits new requests", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const oldStarted = deferred();
  const oldResponse = deferred();
  const fetchImpl = fakeFetch((_url, init) => {
    const refreshToken = new URLSearchParams(init.body.toString()).get("refresh_token");
    if (refreshToken === "old-refresh") {
      oldStarted.resolve();
      return oldResponse.promise;
    }
    assert.equal(refreshToken, "new-refresh");
    return jsonResponse(200, { access_token: "new-fresh", expires_in: 3600 });
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "old", refreshToken: "old-refresh", expiresIn: -10 });

  const pendingOld = service.getAccessToken();
  await oldStarted.promise;
  await service.setTokens({
    accessToken: "new-expired",
    refreshToken: "new-refresh",
    expiresIn: -10,
  });
  assert.equal(await service.getAccessToken(), "new-fresh");
  oldResponse.resolve(jsonResponse(200, { access_token: "stale", expires_in: 3600 }));

  await assert.rejects(pendingOld, /token state changed/);
  assert.equal((await service.getTokens()).accessToken, "new-fresh");
  assert.equal((await service.getTokens()).refreshToken, "new-refresh");
  assert.equal(fetchImpl.calls.length, 2);
});

test("a read started before removal cannot return its stale snapshot", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const readStarted = deferred();
  const releaseRead = deferred();
  let delayRead = false;
  const originalRead = store.read;
  store.read = async (providerId) => {
    const snapshot = await originalRead(providerId);
    if (delayRead) {
      delayRead = false;
      readStarted.resolve();
      await releaseRead.promise;
    }
    return snapshot;
  };
  const fetchImpl = fakeFetch(() => {
    throw new Error("stale read must not refresh");
  });
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "old", refreshToken: "old-refresh", expiresIn: -10 });
  delayRead = true;

  const pending = service.getAccessToken();
  await readStarted.promise;
  await service.removeTokens();
  releaseRead.resolve();

  await assert.rejects(pending, /token state changed/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("getTokens retries a delayed read after replacement", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const readStarted = deferred();
  const releaseRead = deferred();
  let delayRead = false;
  const originalRead = store.read;
  store.read = async (providerId) => {
    const snapshot = await originalRead(providerId);
    if (delayRead) {
      delayRead = false;
      readStarted.resolve();
      await releaseRead.promise;
    }
    return snapshot;
  };
  const service = new OAuthService(baseOptions(), { store });
  await service.setTokens({ accessToken: "old", expiresIn: 3600 });
  delayRead = true;

  const pending = service.getTokens();
  await readStarted.promise;
  await service.setTokens({ accessToken: "new", expiresIn: 3600 });
  releaseRead.resolve();

  assert.equal((await pending).accessToken, "new");
});

test("a replacement queued during a refresh write wins and the stale token is not returned", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const originalWrite = store.write;
  store.write = async (providerId, tokens) => {
    if (tokens.accessToken === "stale") {
      writeStarted.resolve();
      await releaseWrite.promise;
    }
    await originalWrite(providerId, tokens);
  };
  const fetchImpl = fakeFetch(() => jsonResponse(200, { access_token: "stale", expires_in: 3600 }));
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "old", refreshToken: "old-refresh", expiresIn: -10 });

  const pendingOld = service.getAccessToken();
  await writeStarted.promise;
  const replacement = service.setTokens({
    accessToken: "new",
    refreshToken: "new-refresh",
    expiresIn: 3600,
  });
  releaseWrite.resolve();
  await replacement;

  await assert.rejects(pendingOld, /token state changed/);
  assert.equal((await service.getTokens()).accessToken, "new");
});

test("getAccessToken fails clearly when there is no refresh token", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const service = new OAuthService(baseOptions(), {
    store,
    fetchImpl: fakeFetch(() => jsonResponse(200, {})),
  });
  await service.setTokens({ accessToken: "at-1", expiresIn: -10 });

  await assert.rejects(service.getAccessToken(), /no refresh token is available/);
});

test("getAccessToken fails clearly when the provider rejects the refresh", async () => {
  const { OAuthService } = await loadOAuthService();
  const store = memoryStore();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(400, { error: "invalid_grant", error_description: "Token has been revoked." }),
  );
  const service = new OAuthService(baseOptions(), { store, fetchImpl });
  await service.setTokens({ accessToken: "at-1", refreshToken: "rt-1", expiresIn: -10 });

  await assert.rejects(service.getAccessToken(), /Token has been revoked\./);
});

test("getAccessToken fails when there are no stored tokens at all", async () => {
  const { OAuthService } = await loadOAuthService();
  const service = new OAuthService(baseOptions(), { store: memoryStore() });
  await assert.rejects(service.getAccessToken(), /No stored tokens/);
});

test("authorize() throws, pointing at the loopback flow", async () => {
  const { OAuthService } = await loadOAuthService();
  const service = new OAuthService(baseOptions(), { store: memoryStore() });
  await assert.rejects(service.authorize(), /loopback/);
});
