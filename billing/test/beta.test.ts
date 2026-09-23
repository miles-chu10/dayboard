import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { normalizeEmail } from "../src/beta.ts";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { LocalDb } from "./local-db.ts";

const service = "https://billing.example.test";
const site = "https://dayboard.example.test";
const endpoint = `${service}/v1/beta-signup`;
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

// Only the signup bindings: no Stripe product, price or secrets.
function setup(overrides: Partial<Env> = {}) {
  const db = new LocalDb();
  dbs.push(db);
  const env = {
    DB: db as unknown as D1Database,
    SERVICE_ORIGIN: service,
    HASH_SECRET: randomToken(),
    SITE_ORIGIN: site,
    ...overrides,
  } as Env;
  const worker = createWorker(() => {
    throw new Error("Stripe must not be used for beta signups");
  });
  const signup = (
    body: unknown,
    init: { origin?: string | null; ip?: string; type?: string } = {},
  ) =>
    worker.fetch(
      new Request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": init.type ?? "application/json",
          "CF-Connecting-IP": init.ip ?? "203.0.113.7",
          ...(init.origin === null ? {} : { Origin: init.origin ?? site }),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
    );
  const rows = () =>
    db.sql
      .prepare("SELECT email FROM beta_signups ORDER BY email")
      .all()
      .map((row) => String(row.email));
  return { env, worker, signup, rows };
}

test("normalizes and validates beta email addresses", () => {
  assert.equal(normalizeEmail("  Alex.Rivera+beta@Example.COM "), "alex.rivera+beta@example.com");
  for (const bad of [
    "",
    "alex",
    "@example.com",
    "alex@",
    "alex@example",
    "a@b@example.com",
    "alex..r@example.com",
    ".alex@example.com",
    "alex @example.com",
    "alex@-example.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
    42,
    null,
  ])
    assert.equal(normalizeEmail(bad), null, String(bad));
});

test("stores a signup once and answers new and repeated addresses the same way", async () => {
  const { signup, rows } = setup();
  const first = await signup({ email: "Alex@Example.com", company: "" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), site);
  assert.equal(first.headers.get("Vary"), "Origin");
  const again = await signup({ email: " alex@example.com " }, { ip: "203.0.113.8" });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true });
  assert.deepEqual(rows(), ["alex@example.com"]);
});

test("answers the CORS preflight only for the configured site", async () => {
  const { env, worker } = setup();
  const preflight = (origin: string) =>
    worker.fetch(
      new Request(endpoint, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      }),
      env,
    );
  const ok = await preflight(site);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), site);
  assert.equal(ok.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(ok.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.equal((await preflight("https://evil.example")).status, 403);
});

test("rejects other origins, bad bodies and bad addresses without storing anything", async () => {
  const { signup, rows } = setup();
  assert.equal(
    (await signup({ email: "a@example.com" }, { origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await signup({ email: "a@example.com" }, { origin: null })).status, 403);
  assert.equal(
    (
      await signup("email=a@example.com", {
        type: "application/x-www-form-urlencoded",
      })
    ).status,
    400,
  );
  assert.equal((await signup("[]", { ip: "203.0.113.9" })).status, 400);
  const invalid = await signup({ email: "not-an-email" }, { ip: "203.0.113.10" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_email" });
  assert.equal(invalid.headers.get("Access-Control-Allow-Origin"), site);
  assert.deepEqual(rows(), []);
});

test("pretends to accept bots that fill the hidden field", async () => {
  const { signup, rows } = setup();
  const response = await signup({ email: "bot@example.com", company: "Acme" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(rows(), []);
});

test("rate-limits repeated attempts from one network", async () => {
  const { signup } = setup();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await signup({ email: `p${i}@example.com` })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("fails closed when signup configuration is missing or wrong", async () => {
  for (const overrides of [
    { SITE_ORIGIN: undefined },
    { SITE_ORIGIN: "http://dayboard.example.test" },
    { SITE_ORIGIN: "https://dayboard.example.test/beta" },
    { HASH_SECRET: "short" },
  ]) {
    const { signup, rows } = setup(overrides);
    const response = await signup({ email: "a@example.com" });
    assert.equal(response.status, 503, JSON.stringify(overrides));
    assert.deepEqual(await response.json(), { error: "signup_unconfigured" });
    assert.deepEqual(rows(), []);
  }
  const { env, worker } = setup();
  const wrongHost = await worker.fetch(
    new Request("https://other.example.test/v1/beta-signup", {
      method: "POST",
      headers: { Origin: site, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    }),
    env,
  );
  assert.equal(wrongHost.status, 403);
  // Purchase routes still require the full Stripe configuration.
  assert.equal((await worker.fetch(new Request(`${service}/buy`), env)).status, 503);
});

test("real Worker and D1 accept a signup with only the signup bindings", async () => {
  const bundle = await build({
    entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      cf: false,
      d1Databases: ["DB"],
      d1Persist: false,
      bindings: {
        SERVICE_ORIGIN: service,
        HASH_SECRET: randomToken(),
        SITE_ORIGIN: site,
      },
      outboundService: () => {
        throw new Error("beta signups must not make outbound requests");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = await readFile(new URL(file, dir), "utf8");
      await db.batch(
        sql
          .split(";")
          .map((statement) => statement.trim())
          .filter(Boolean)
          .map((statement) => db.prepare(statement)),
      );
    }
    const preflight = await mf.dispatchFetch(endpoint, {
      method: "OPTIONS",
      headers: { Origin: site, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), site);
    for (const email of ["Priya@Example.com", "priya@example.com"]) {
      const response = await mf.dispatchFetch(endpoint, {
        method: "POST",
        headers: {
          Origin: site,
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.20",
        },
        body: JSON.stringify({ email, company: "" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
    const stored = await db.prepare("SELECT email, created_at FROM beta_signups").all();
    assert.equal(stored.results.length, 1);
    assert.equal(stored.results[0].email, "priya@example.com");
    assert.ok(Number(stored.results[0].created_at) > 0);
  } finally {
    await mf.dispose();
  }
});
