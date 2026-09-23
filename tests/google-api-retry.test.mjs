import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const output = await build({
  entryPoints: [new URL("../main/services/google-api.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "fake-auth",
      setup(api) {
        api.onResolve({ filter: /google-auth\.js$/ }, () => ({
          path: "fake-auth",
          namespace: "fixture",
        }));
        api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            'export class GoogleAuthError extends Error { constructor(reason, message){super(message);this.reason=reason;} } export async function getGoogleAccessToken(){return "fixture-token"}',
          loader: "js",
        }));
      },
    },
  ],
});
const adapter = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);

const errorResponse = (status) =>
  new Response(JSON.stringify({ error: { message: "synthetic failure" } }), {
    status,
    headers: { "retry-after": "0.001" },
  });

for (const [name, create] of [
  ["task", () => adapter.createTask({ title: "Fixture" })],
  ["event", () => adapter.createEvent({ title: "Fixture", date: "2027-01-01", timeZone: "UTC" })],
]) {
  for (const status of [429, 503]) {
    test(`${name} POST ${status} is attempted once and surfaces its failure`, async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        assert.equal(init.method, "POST");
        calls++;
        return errorResponse(status);
      };
      try {
        await assert.rejects(create(), (error) => {
          assert.equal(error.status, status);
          assert.match(error.message, /synthetic failure/);
          return true;
        });
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

test("GET retries transient failures, disposes retry bodies, then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let disposed = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "GET");
    calls++;
    if (calls === 3) return new Response(JSON.stringify({ items: [] }), { status: 200 });
    return new Response(new ReadableStream({ cancel: () => disposed++ }), {
      status: calls === 1 ? 429 : 503,
      headers: { "retry-after": "0.001" },
    });
  };
  try {
    assert.deepEqual(await adapter.listTasks(), []);
    assert.equal(calls, 3);
    assert.equal(disposed, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET stops after four attempts and consumes the final failure", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let disposed = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "GET");
    calls++;
    if (calls === 4) return errorResponse(503);
    return new Response(new ReadableStream({ cancel: () => disposed++ }), {
      status: 503,
      headers: { "retry-after": "0.001" },
    });
  };
  try {
    await assert.rejects(adapter.listTasks(), (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /synthetic failure/);
      return true;
    });
    assert.equal(calls, 4);
    assert.equal(disposed, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("401 disposes its body before reporting expired authentication", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let disposed = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream({ cancel: () => disposed++ }), { status: 401 });
  };
  try {
    await assert.rejects(adapter.listTasks(), /Google session expired/);
    assert.equal(calls, 1);
    assert.equal(disposed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
