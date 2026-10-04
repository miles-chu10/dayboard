import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { normalizeEmail, type WaitUntil } from "../src/beta.ts";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { LocalDb } from "./local-db.ts";

const service = "https://billing.example.test";
const site = "https://dayboard.example.test";
const waitlist = `${service}/v1/waitlist`;
const legacy = `${service}/v1/beta-signup`;
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

type SignupInit = {
  origin?: string | null;
  ip?: string;
  type?: string;
  url?: string;
  ctx?: WaitUntil;
};

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
    throw new Error("Stripe must not be used for waitlist signups");
  });
  const signup = (body: unknown, init: SignupInit = {}) =>
    worker.fetch(
      new Request(init.url ?? waitlist, {
        method: "POST",
        headers: {
          "Content-Type": init.type ?? "application/json",
          "CF-Connecting-IP": init.ip ?? "203.0.113.7",
          ...(init.origin === null ? {} : { Origin: init.origin ?? site }),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
      init.ctx,
    );
  const rows = () =>
    db.sql
      .prepare("SELECT email FROM beta_signups ORDER BY email")
      .all()
      .map((row) => String(row.email));
  const records = () =>
    db.sql
      .prepare("SELECT email, cohort, classification FROM beta_signups ORDER BY email")
      .all()
      .map((row) => `${row.email} ${row.cohort} ${row.classification}`);
  return { db, env, worker, signup, rows, records };
}

// Collects the work the Worker hands to waitUntil, so a test can wait for it.
function background() {
  const pending: Promise<unknown>[] = [];
  const ctx: WaitUntil = { waitUntil: (promise) => void pending.push(promise) };
  return { ctx, pending };
}

// Lets chosen statements fail the way an unavailable D1 database would.
function unreliable(db: LocalDb, failure: "limit" | "insert" | "unconfirmed") {
  return {
    prepare(query: string) {
      const statement = db.prepare(query);
      const insert = query.startsWith("INSERT INTO beta_signups");
      return {
        bind(...params: unknown[]) {
          const bound = statement.bind(...params);
          return {
            async first<T>() {
              if (failure === "limit") throw new Error("D1_ERROR: rate limit store unavailable");
              return bound.first<T>();
            },
            async run() {
              if (insert && failure === "insert")
                throw new Error(`D1_ERROR: could not store ${String(params[0])}`);
              if (insert && failure === "unconfirmed")
                return { success: false, meta: { changes: 0 } };
              return bound.run();
            },
          };
        },
      };
    },
  };
}

test("normalizes and validates waitlist email addresses", () => {
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
  const { signup, records } = setup();
  const first = await signup({ email: "Alex@Example.com", company: "" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), site);
  assert.equal(first.headers.get("Vary"), "Origin");
  const again = await signup({ email: " alex@example.com " }, { ip: "203.0.113.8" });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true });
  assert.deepEqual(records(), ["alex@example.com waitlist unreviewed"]);
});

test("the legacy route shares the list and answers repeats exactly like new addresses", async () => {
  const { signup, records } = setup();
  const answers = new Set<string>();
  for (const [url, email, ip] of [
    [waitlist, "Sam+List@Example.test", "203.0.113.7"],
    [legacy, " sam+list@example.test ", "203.0.113.8"],
    [legacy, "sam@example.test", "203.0.113.9"],
    [waitlist, "SAM@example.test", "203.0.113.10"],
  ]) {
    const response = await signup({ email, company: "" }, { url, ip });
    const origin = response.headers.get("Access-Control-Allow-Origin");
    answers.add(`${response.status} ${origin} ${await response.text()}`);
  }
  assert.deepEqual([...answers], [`200 ${site} {"ok":true}`]);
  // Plus addressing is kept: the tagged and plain addresses are separate entries.
  assert.deepEqual(records(), [
    "sam+list@example.test waitlist unreviewed",
    "sam@example.test waitlist unreviewed",
  ]);
});

test("the waitlist and its legacy route share one rate limit", async () => {
  const { signup } = setup();
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const url = i % 2 ? legacy : waitlist;
    statuses.push((await signup({ email: `p${i}@example.test` }, { url })).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

test("new entries are unreviewed waitlist rows whatever the request asks for", async () => {
  const { signup, records } = setup();
  const response = await signup({
    email: "chooser@example.test",
    company: "",
    cohort: "early_access",
    classification: "reviewed",
  });
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(records(), ["chooser@example.test waitlist unreviewed"]);
});

test("rejects a hidden field that isn't text but accepts older clients that omit it", async () => {
  const { signup, rows } = setup();
  for (const company of [42, null, ["Acme"], { name: "Acme" }]) {
    const response = await signup({ email: "odd@example.test", company });
    assert.equal(response.status, 400, JSON.stringify(company));
    assert.deepEqual(await response.json(), { error: "invalid_body" });
  }
  const omitted = await signup({ email: "older-client@example.test" });
  assert.deepEqual(await omitted.json(), { ok: true });
  assert.deepEqual(rows(), ["older-client@example.test"]);
});

test("answers the CORS preflight on both routes only for the configured site", async () => {
  const { env, worker } = setup();
  const preflight = (origin: string, url = waitlist) =>
    worker.fetch(
      new Request(url, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      }),
      env,
    );
  for (const url of [waitlist, legacy]) {
    const ok = await preflight(site, url);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), site);
    assert.equal(ok.headers.get("Access-Control-Allow-Methods"), "POST");
    assert.equal(ok.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  }
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

test("drops rate-limit buckets from earlier minutes", async () => {
  const { db, signup } = setup();
  db.sql
    .prepare("INSERT INTO rate_limits (bucket, window_start, hits) VALUES ('stale', 1, 5)")
    .run();
  assert.equal((await signup({ email: "a@example.com" })).status, 200);
  const buckets = db.sql.prepare("SELECT bucket, hits FROM rate_limits").all();
  assert.equal(buckets.length, 1);
  assert.notEqual(buckets[0].bucket, "stale");
  const plan = db.sql
    .prepare("EXPLAIN QUERY PLAN DELETE FROM rate_limits WHERE window_start < ?")
    .all(1)
    .map((row) => String(row.detail));
  assert.match(plan.join("\n"), /USING (COVERING )?INDEX rate_limits_window_start/);
});

test("never answers ok when storage fails, and logs no address", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  for (const failure of ["limit", "insert", "unconfirmed"] as const) {
    const { db, env, signup, rows } = setup();
    env.DB = unreliable(db, failure) as unknown as D1Database;
    const response = await signup({ email: "unsaved@example.test", company: "" });
    assert.equal(response.status, 503, failure);
    assert.deepEqual(await response.json(), { error: "service_unavailable" });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), site);
    assert.deepEqual(rows(), []);
  }
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    Array(3).fill(["Waitlist signup failed"]),
  );
});

test("emails the owner about new signups only", async () => {
  const sent: { to: string; subject: string; text: string; from: { email: string } }[] = [];
  const { signup, rows } = setup({
    SIGNUP_NOTIFY_TO: "owner@example.com",
    SIGNUP_EMAIL: {
      send: async (message: never) => void sent.push(message),
    } as unknown as SendEmail,
  });
  assert.equal((await signup({ email: "Alex@Example.com" })).status, 200);
  assert.equal(
    (await signup({ email: "alex@example.com" }, { url: legacy, ip: "203.0.113.8" })).status,
    200,
  );
  assert.equal(
    (await signup({ email: "bot@example.com", company: "Acme" }, { ip: "203.0.113.9" })).status,
    200,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.equal(sent[0].from.email, "signups@dayboard.example.test");
  assert.equal(sent[0].subject, "New DayBoard waitlist signup");
  assert.equal(sent[0].text, "alex@example.com joined the DayBoard waitlist.");
  assert.deepEqual(rows(), ["alex@example.com"]);
});

test("sends the owner email after the reply, once per new address", async () => {
  const { ctx, pending } = background();
  let release = () => {};
  const outbox = new Promise<void>((resolve) => (release = resolve));
  const delivered: string[] = [];
  const { signup, rows } = setup({
    SIGNUP_NOTIFY_TO: "owner@example.test",
    SIGNUP_EMAIL: {
      send: async (message: { text: string }) => {
        await outbox;
        delivered.push(message.text);
      },
    } as unknown as SendEmail,
  });
  const first = await signup({ email: "early@example.test" }, { ctx });
  assert.deepEqual(await first.json(), { ok: true });
  const again = await signup({ email: "EARLY@example.test" }, { ctx, url: legacy });
  assert.deepEqual(await again.json(), { ok: true });
  // Both answers arrived while the one email was still being sent.
  assert.equal(pending.length, 1);
  assert.deepEqual(delivered, []);
  release();
  await Promise.all(pending);
  assert.deepEqual(delivered, ["early@example.test joined the DayBoard waitlist."]);
  assert.deepEqual(rows(), ["early@example.test"]);
});

test("keeps the signup and logs no address when the owner email fails", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const { ctx, pending } = background();
  const { signup, rows } = setup({
    SIGNUP_NOTIFY_TO: "owner@example.test",
    SIGNUP_EMAIL: {
      send: async () => {
        throw new Error("owner@example.test refused news about kept@example.test");
      },
    } as unknown as SendEmail,
  });
  const awaited = await signup({ email: "kept@example.test" });
  assert.deepEqual(await awaited.json(), { ok: true });
  const deferred = await signup({ email: "later@example.test" }, { ctx });
  assert.deepEqual(await deferred.json(), { ok: true });
  await Promise.all(pending);
  assert.deepEqual(rows(), ["kept@example.test", "later@example.test"]);
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    Array(2).fill(["Waitlist owner notification failed"]),
  );
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

test("real Worker and D1 accept waitlist signups on both routes with only the signup bindings", async () => {
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
        throw new Error("waitlist signups must not make outbound requests");
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
    for (const url of [waitlist, legacy]) {
      const preflight = await mf.dispatchFetch(url, {
        method: "OPTIONS",
        headers: { Origin: site, "Access-Control-Request-Method": "POST" },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), site);
    }
    for (const [url, email] of [
      [waitlist, "Priya@Example.com"],
      [legacy, "priya@example.com"],
    ]) {
      const response = await mf.dispatchFetch(url, {
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
    const stored = await db.prepare("SELECT * FROM beta_signups").all();
    assert.equal(stored.results.length, 1);
    assert.equal(stored.results[0].email, "priya@example.com");
    assert.ok(Number(stored.results[0].created_at) > 0);
    assert.equal(stored.results[0].cohort, "waitlist");
    assert.equal(stored.results[0].classification, "unreviewed");
  } finally {
    await mf.dispose();
  }
});
