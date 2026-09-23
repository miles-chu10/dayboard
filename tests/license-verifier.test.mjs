import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;
const META = { store_id: 1, product_id: 4, variant_id: 5 };
const LICENSE = { status: "active", expires_at: null };

async function loadVerifier() {
  const result = await build({
    entryPoints: [path.join(root, "main/services/license/lemonsqueezy-verifier.ts")],
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

test("activate posts license_key + instance_name and returns the instance id", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(200, {
      activated: true,
      license_key: LICENSE,
      instance: { id: "inst-1" },
      meta: META,
    }),
  );
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  const result = await verifier.activate("LICENSE-KEY", "Test Mac");

  assert.equal(result.activated, true);
  assert.equal(result.instanceId, "inst-1");
  assert.equal(result.license?.status, "active");
  assert.deepEqual(result.meta, { storeId: "1", productId: "4", variantId: "5" });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "https://api.lemonsqueezy.com/v1/licenses/activate");
  const body = new URLSearchParams(fetchImpl.calls[0].init.body.toString());
  assert.equal(body.get("license_key"), "LICENSE-KEY");
  assert.equal(body.get("instance_name"), "Test Mac");
});

test("activate surfaces a server-reported error without throwing", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(200, { activated: false, error: "license_key not found." }),
  );
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  const result = await verifier.activate("BAD-KEY", "Test Mac");

  assert.equal(result.activated, false);
  assert.equal(result.error, "license_key not found.");
});

test("an incomplete successful activation retains its instance ID for cleanup", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(200, { activated: true, instance: { id: "inst-created" } }),
  );
  const result = await new LemonSqueezyVerifier({ fetchImpl }).activate("MATCHING-KEY", "Test Mac");
  assert.equal(result.activated, true);
  assert.equal(result.instanceId, "inst-created");
  assert.equal(result.meta, undefined);
});

test("validate returns valid: true for an active key", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(200, {
      valid: true,
      license_key: LICENSE,
      instance: { id: "inst-1" },
      meta: META,
    }),
  );
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  const result = await verifier.validate("LICENSE-KEY", "inst-1");

  assert.equal(result.valid, true);
  assert.equal(result.license?.status, "active");
  assert.equal(result.instanceId, "inst-1");
});

test("validate throws when the network is unreachable, distinct from an invalid-key response", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  await assert.rejects(verifier.validate("LICENSE-KEY", "inst-1"), /Couldn't reach Lemon Squeezy/);
});

test("a timed-out request throws without claiming a key is invalid", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const verifier = new LemonSqueezyVerifier({ fetchImpl, timeoutMs: 5 });
  await assert.rejects(verifier.validate("LICENSE-KEY", "inst-1"), /Couldn't reach Lemon Squeezy/);
});

test("validate throws on a non-JSON response", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  }));
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  await assert.rejects(verifier.validate("LICENSE-KEY"), /unexpected response/);
});

test("deactivate posts instance_id and reports the result", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() => jsonResponse(200, { deactivated: true }));
  const verifier = new LemonSqueezyVerifier({ fetchImpl });

  const result = await verifier.deactivate("LICENSE-KEY", "inst-1");

  assert.equal(result.deactivated, true);
  const body = new URLSearchParams(fetchImpl.calls[0].init.body.toString());
  assert.equal(body.get("instance_id"), "inst-1");
});

test("rate limits and server failures throw even if a body claims a key is invalid", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  for (const status of [429, 500, 502, 503]) {
    const fetchImpl = fakeFetch(() => jsonResponse(status, { valid: false, error: "not found" }));
    await assert.rejects(
      new LemonSqueezyVerifier({ fetchImpl }).validate("LICENSE-KEY", "inst-1"),
      /temporarily unavailable/,
    );
  }
});

test("well-formed explicit invalid response remains distinct from a transient failure", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  const fetchImpl = fakeFetch(() =>
    jsonResponse(404, { valid: false, error: "license_key not found." }),
  );
  const result = await new LemonSqueezyVerifier({ fetchImpl }).validate("BAD-KEY", "inst-1");
  assert.deepEqual(result, {
    valid: false,
    error: "license_key not found.",
    license: undefined,
    meta: undefined,
    instanceId: undefined,
  });
});

test("malformed positive responses throw instead of granting access", async () => {
  const { LemonSqueezyVerifier } = await loadVerifier();
  for (const body of [
    { valid: true },
    { valid: true, license_key: LICENSE, instance: { id: "inst-1" } },
    {
      valid: true,
      license_key: LICENSE,
      instance: { id: "inst-1" },
      meta: { ...META, variant_id: null },
    },
    { valid: true, license_key: { status: "active" }, instance: { id: "inst-1" }, meta: META },
    { valid: true, license_key: LICENSE, instance: { id: "other" }, meta: META, error: null },
  ]) {
    const fetchImpl = fakeFetch(() => jsonResponse(200, body));
    if (body.instance?.id === "other") {
      const result = await new LemonSqueezyVerifier({ fetchImpl }).validate("KEY", "inst-1");
      assert.equal(result.instanceId, "other", "service checks instance binding");
    } else {
      await assert.rejects(
        new LemonSqueezyVerifier({ fetchImpl }).validate("KEY", "inst-1"),
        /malformed/,
      );
    }
  }
});
