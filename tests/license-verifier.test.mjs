import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const API = "https://license.example";
const KEY = `DAYB_${"A".repeat(43)}`;
const META = { issuer: API, productId: "prod_abc", environment: "test" };
const LICENSE = { status: "active", expiresAt: null };
let sequence = 0;

async function load() {
  const result = await build({
    entryPoints: [path.join(root, "main/services/license/dayboard-verifier.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(
      result.outputFiles[0].text + `\n// ${sequence++}`,
    ).toString("base64")}`
  );
}

function fetcher(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function response(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function streamingResponse(status, chunks = [], headers = {}) {
  let cancellations = 0;
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      // Stay open to prove the verifier stops unread response bodies.
    },
    cancel() {
      cancellations++;
    },
  });
  return {
    response: new Response(stream, {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
    cancellations: () => cancellations,
  };
}

test("activate posts exact camelCase JSON contract with manual redirects", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const { calls, fetchImpl } = fetcher(() =>
    response(200, {
      activated: true,
      created: true,
      instanceId: "inst-1",
      license: LICENSE,
      meta: META,
    }),
  );
  const verifier = new DayBoardLicenseVerifier(API, fetchImpl);
  assert.deepEqual(await verifier.activate(KEY, "installation-1", "Test Mac"), {
    activated: true,
    created: true,
    instanceId: "inst-1",
    license: LICENSE,
    meta: META,
  });
  assert.equal(calls[0].url, `${API}/v1/licenses/activate`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    licenseKey: KEY,
    installationId: "installation-1",
    instanceName: "Test Mac",
  });
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
});

test("validate and deactivate use exact routes and fields", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const { calls, fetchImpl } = fetcher((url) =>
    response(
      200,
      url.endsWith("validate")
        ? { valid: true, instanceId: "inst-1", license: LICENSE, meta: META }
        : { deactivated: true },
    ),
  );
  const verifier = new DayBoardLicenseVerifier(API, fetchImpl);
  assert.equal((await verifier.validate(KEY, "inst-1")).valid, true);
  assert.equal((await verifier.deactivate(KEY, "inst-1")).deactivated, true);
  assert.equal(calls[0].url, `${API}/v1/licenses/validate`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { licenseKey: KEY, instanceId: "inst-1" });
  assert.deepEqual(JSON.parse(calls[1].init.body), { licenseKey: KEY, instanceId: "inst-1" });
});

test("well-formed invalid and revoked responses are explicit, with redacted text", async () => {
  const { DayBoardLicenseVerifier } = await load();
  for (const status of [200, 400, 404, 422]) {
    const verifier = new DayBoardLicenseVerifier(API, () =>
      response(status, {
        valid: false,
        error: `invalid key ${KEY}`,
      }),
    );
    const result = await verifier.validate(KEY);
    assert.equal(result.valid, false);
    assert.equal(result.error.includes(KEY), false);
  }
});

test("incomplete, wrong type, missing created, and invalid date responses are transient", async () => {
  const { DayBoardLicenseVerifier } = await load();
  for (const body of [
    { activated: true, instanceId: "inst-1", license: LICENSE, meta: META },
    { activated: true, created: "true", instanceId: "inst-1", license: LICENSE, meta: META },
    { activated: true, created: true, instanceId: "", license: LICENSE, meta: META },
    {
      activated: true,
      created: true,
      instanceId: "inst-1",
      license: { ...LICENSE, expiresAt: "bad" },
      meta: META,
    },
    {
      activated: true,
      created: true,
      instanceId: "inst-1",
      license: LICENSE,
      meta: { ...META, environment: "wrong" },
    },
  ]) {
    const verifier = new DayBoardLicenseVerifier(API, () => response(200, body));
    await assert.rejects(verifier.activate(KEY, "id", "Mac"), /temporarily unavailable/);
  }
});

test("429, 5xx, malformed JSON, oversized body, and redirects remain transient", async () => {
  const { DayBoardLicenseVerifier } = await load();
  for (const res of [
    response(429, { valid: false, error: "rate limited" }),
    response(503, { valid: false, error: "unavailable" }),
    response(200, "{"),
    response(200, "x".repeat(16 * 1024 + 1)),
    response(302, { valid: false, error: "redirect" }),
    response(
      200,
      { valid: true, instanceId: "other", license: LICENSE, meta: META },
      { "content-type": "text/html" },
    ),
  ]) {
    const verifier = new DayBoardLicenseVerifier(API, () => res);
    await assert.rejects(verifier.validate(KEY, "inst-1"), /temporarily unavailable/);
  }
});

test("rejected status and content type cancel unread bodies and abort their requests", async () => {
  const { DayBoardLicenseVerifier } = await load();
  for (const { status, headers } of [
    { status: 429, headers: {} },
    { status: 503, headers: {} },
    { status: 302, headers: {} },
    { status: 200, headers: { "content-type": "text/html" } },
    { status: 200, headers: { "content-length": "20000" } },
  ]) {
    const streamed = streamingResponse(status, [], headers);
    let signal;
    const verifier = new DayBoardLicenseVerifier(
      API,
      (_url, init) => {
        signal = init.signal;
        return streamed.response;
      },
      20,
    );
    await assert.rejects(verifier.validate(KEY), /temporarily unavailable/);
    assert.equal(streamed.cancellations(), 1, `status ${status} should cancel its body`);
    assert.equal(signal.aborted, true, `status ${status} should abort its request`);
  }
});

test("oversized streamed response cancels the active reader and aborts", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const streamed = streamingResponse(200, ["x".repeat(16 * 1024 + 1)]);
  let signal;
  const verifier = new DayBoardLicenseVerifier(API, (_url, init) => {
    signal = init.signal;
    return streamed.response;
  });
  await assert.rejects(verifier.validate(KEY), /temporarily unavailable/);
  assert.equal(streamed.cancellations(), 1);
  assert.equal(signal.aborted, true);
});

test("timeout cancels a stalled response body without returning partial JSON", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const streamed = streamingResponse(200, ['{"valid":true']);
  let signal;
  const verifier = new DayBoardLicenseVerifier(
    API,
    (_url, init) => {
      signal = init.signal;
      return streamed.response;
    },
    10,
  );
  let deadline;
  try {
    await assert.rejects(
      Promise.race([
        verifier.validate(KEY),
        new Promise((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error("test timed out waiting for body cancellation")),
            500,
          );
        }),
      ]),
      /temporarily unavailable/,
    );
  } finally {
    clearTimeout(deadline);
  }
  assert.equal(streamed.cancellations(), 1);
  assert.equal(signal.aborted, true);
});

test("complete streamed success parses normally", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const bytes = JSON.stringify({ valid: true, instanceId: "inst-1", license: LICENSE, meta: META });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes.slice(0, 15)));
      controller.enqueue(new TextEncoder().encode(bytes.slice(15)));
      controller.close();
    },
  });
  const verifier = new DayBoardLicenseVerifier(
    API,
    () => new Response(stream, { status: 200, headers: { "content-type": "application/json" } }),
  );
  assert.deepEqual(await verifier.validate(KEY, "inst-1"), {
    valid: true,
    instanceId: "inst-1",
    license: LICENSE,
    meta: META,
  });
});

test("timeout aborts and network exceptions cannot echo key or response body", async () => {
  const { DayBoardLicenseVerifier } = await load();
  const timed = new DayBoardLicenseVerifier(
    API,
    (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error(KEY)), { once: true }),
      ),
    5,
  );
  await assert.rejects(timed.validate(KEY), (error) => !error.message.includes(KEY));
  const failed = new DayBoardLicenseVerifier(API, () => {
    throw new Error(`body ${KEY}`);
  });
  await assert.rejects(failed.validate(KEY), (error) => !error.message.includes(KEY));
});

test("HTTPS origin is required", async () => {
  const { DayBoardLicenseVerifier } = await load();
  for (const candidate of [
    "http://license.example",
    "https://license.example/path",
    "https://license.example/",
  ]) {
    assert.throws(() => new DayBoardLicenseVerifier(candidate), /Invalid license service URL/);
  }
});
