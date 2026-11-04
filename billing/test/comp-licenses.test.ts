import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type Stripe from "stripe";
import type { Env } from "../src/config.ts";
import { randomToken } from "../src/crypto.ts";
import { createWorker } from "../src/index.ts";
import { LocalDb } from "./local-db.ts";

const origin = "https://billing.example.test";
const adminPath = "/v1/admin/comp-licenses";
const revokePath = "/v1/admin/comp-licenses/revoke";
const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

interface Issued {
  licenseId: string;
  licenseKey: string;
  label: string;
  createdAt: number;
  meta: { issuer: string; productId: string; environment: string };
}
type LicenseReply = Record<string, unknown> & { error?: string; instanceId?: string };
interface AdminInit {
  method?: string;
  body?: unknown;
  auth?: string | null;
  ip?: string;
}

function setup(overrides: Partial<Env> = {}) {
  const db = new LocalDb();
  dbs.push(db);
  const token = randomToken();
  const env: Env = {
    DB: db as unknown as D1Database,
    SERVICE_ORIGIN: origin,
    PRODUCT_ID: "prod_TEST",
    PRICE_ID: "price_TEST",
    PRICE_CURRENCY: "usd",
    ENVIRONMENT: "test",
    ACTIVATION_LIMIT: "2",
    STRIPE_SECRET_KEY: "sk_test_disposable_only",
    STRIPE_WEBHOOK_SECRET: "whsec_disposable_only",
    ENCRYPTION_KEY: randomToken(),
    HASH_SECRET: randomToken(),
    ADMIN_TOKEN: token,
    ...overrides,
  };
  // Comp licenses never involve a payment, so any use of the Stripe client fails the test.
  const worker = createWorker(
    () =>
      new Proxy({} as Stripe, {
        get() {
          throw new Error("Stripe must not be used for comp licenses");
        },
      }),
  );
  const admin = (path: string, init: AdminInit = {}) => {
    const { body, auth = `Bearer ${token}` } = init;
    return worker.fetch(
      new Request(origin + path, {
        method: init.method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "CF-Connecting-IP": init.ip ?? "198.51.100.7",
          ...(auth === null ? {} : { Authorization: auth }),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
    );
  };
  const issue = async (label = "beta tester 1") => {
    const response = await admin(adminPath, { body: { label } });
    assert.equal(response.status, 201);
    return (await response.json()) as Issued;
  };
  const license = async (kind: "validate" | "activate" | "deactivate", body: unknown) =>
    (await (
      await worker.fetch(
        new Request(`${origin}/v1/licenses/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      )
    ).json()) as LicenseReply;
  const count = (table: string) =>
    Number(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  return { db, env, token, worker, admin, issue, license, count };
}

test("admin routes stay closed without a strong ADMIN_TOKEN or licensing config", async () => {
  for (const ADMIN_TOKEN of [undefined, "", "x".repeat(31)]) {
    const f = setup({ ADMIN_TOKEN });
    const auth = `Bearer ${ADMIN_TOKEN ?? ""}`;
    for (const response of [
      await f.admin(adminPath, { body: { label: "beta tester 1" }, auth }),
      await f.admin(adminPath, { auth }),
      await f.admin(revokePath, { body: { licenseId: randomToken(24) }, auth }),
      await f.admin("/v1/admin/anything", { auth: null }),
    ]) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "admin_unconfigured" });
    }
    assert.equal(f.count("licenses") + f.count("rate_limits") + f.count("comp_licenses"), 0);
  }
  // Licensing itself unconfigured (the waitlist-only deployment): the whole service is closed.
  const g = setup({ STRIPE_SECRET_KEY: "" });
  const response = await g.admin(adminPath, { body: { label: "beta tester 1" } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_unconfigured" });
  assert.equal(g.count("licenses"), 0);
});

test("wrong or missing tokens get 401, and repeated failures are rate limited", async () => {
  const f = setup();
  const attempts = [null, "Bearer", "Bearer wrong", `Basic ${f.token}`, `Bearer ${f.token}x`];
  for (const auth of attempts) {
    const response = await f.admin(adminPath, { body: { label: "beta tester 1" }, auth });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("WWW-Authenticate"), "Bearer");
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  // The sixth request from that address waits for the next minute, even with the right token.
  const locked = await f.admin(adminPath, { body: { label: "beta tester 1" } });
  assert.equal(locked.status, 429);
  assert.deepEqual(await locked.json(), { error: "rate_limited" });
  assert.equal((await f.admin(adminPath)).status, 429);
  // Another address is unaffected, and the scheme name is case-insensitive.
  const other = await f.admin(adminPath, {
    body: { label: "beta tester 1" },
    auth: `bearer ${f.token}`,
    ip: "198.51.100.8",
  });
  assert.equal(other.status, 201);
  assert.equal(f.count("licenses"), 1);
  // Successful requests don't count toward the limit.
  for (let i = 0; i < 6; i++)
    assert.equal((await f.admin(adminPath, { ip: "198.51.100.8" })).status, 200);
  // No bucket stores the address itself.
  for (const row of f.db.sql.prepare("SELECT bucket FROM rate_limits").all())
    assert.doesNotMatch(String(row.bucket), /198\.51\.100/);
});

test("issuance returns the key once and stores only its hash and ciphertext", async () => {
  const f = setup();
  const issued = await f.issue("beta tester 7");
  assert.match(issued.licenseKey, /^DAYB_[A-Za-z0-9_-]{43}$/);
  assert.match(issued.licenseId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(issued.label, "beta tester 7");
  assert.deepEqual(issued.meta, { issuer: origin, productId: "prod_TEST", environment: "test" });
  const second = await f.issue("beta tester 8");
  assert.notEqual(second.licenseKey, issued.licenseKey);
  assert.notEqual(second.licenseId, issued.licenseId);

  const row = f.db.sql
    .prepare(
      `SELECT l.*, p.revoked, p.reason, o.state, o.capability_expires_at, o.session_id, c.label, c.revoked_at
      FROM licenses l JOIN payments p ON p.payment_intent_id = l.payment_intent_id
      JOIN orders o ON o.id = l.order_id JOIN comp_licenses c ON c.license_id = l.id WHERE l.id = ?`,
    )
    .get(issued.licenseId)!;
  assert.equal(row.order_id, `comp_${issued.licenseId}`);
  assert.equal(row.payment_intent_id, `comp_${issued.licenseId}`);
  assert.deepEqual([row.issuer, row.product_id, row.environment], [origin, "prod_TEST", "test"]);
  assert.deepEqual([row.revoked, row.reason, row.state], [0, null, "ready"]);
  assert.deepEqual([row.capability_expires_at, row.session_id], [0, null]);
  assert.deepEqual([row.label, row.revoked_at], ["beta tester 7", null]);
  // The plaintext key appears nowhere in the database.
  for (const table of ["orders", "payments", "licenses", "comp_licenses", "activations"])
    for (const record of f.db.sql.prepare(`SELECT * FROM ${table}`).all())
      assert.doesNotMatch(JSON.stringify(record), /DAYB_/);

  const list = await f.admin(adminPath);
  assert.equal(list.status, 200);
  const text = await list.text();
  assert.doesNotMatch(text, /DAYB_/);
  assert.deepEqual(
    (JSON.parse(text) as { licenses: Record<string, unknown>[] }).licenses.map((entry) => [
      entry.licenseId,
      entry.label,
      entry.environment,
      entry.revokedAt,
      entry.activations,
    ]),
    [
      [issued.licenseId, "beta tester 7", "test", null, 0],
      [second.licenseId, "beta tester 8", "test", null, 0],
    ],
  );
});

test("labels are short free text, never email addresses", async () => {
  const f = setup();
  const cases: [unknown, string][] = [
    [{ label: "tester@example.com" }, "invalid_label"],
    [{ label: "  " }, "invalid_label"],
    [{ label: "x".repeat(65) }, "invalid_label"],
    [{ label: "tab\there" }, "invalid_label"],
    [{ label: 7 }, "invalid_label"],
    [{ label: "beta tester", email: "tester@example.com" }, "invalid_body"],
    [{}, "invalid_body"],
    [[], "invalid_body"],
    ["not json", "invalid_body"],
  ];
  for (const [body, code] of cases) {
    const response = await f.admin(adminPath, { body });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: code });
  }
  assert.equal(f.count("licenses"), 0);
  // Labels are trimmed, and the table refuses an address even without the Worker's check.
  assert.equal((await f.issue("  padded label  ")).label, "padded label");
  assert.throws(
    () => f.db.sql.prepare("UPDATE comp_licenses SET label = 'tester@example.com'").run(),
    /CHECK constraint/,
  );
});

test("a comp key validates, activates up to the cap and deactivates like a paid key", async () => {
  const f = setup();
  const { licenseKey } = await f.issue();
  const [install1, install2, install3] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const activate = (installationId: string) =>
    f.license("activate", { licenseKey, installationId, instanceName: "Tester Mac" });
  assert.deepEqual(await f.license("validate", { licenseKey }), {
    valid: true,
    license: { status: "active", expiresAt: null },
    meta: { issuer: origin, productId: "prod_TEST", environment: "test" },
  });
  const first = await activate(install1);
  assert.deepEqual([first.activated, first.created], [true, true]);
  const retry = await activate(install1);
  assert.deepEqual(
    [retry.activated, retry.created, retry.instanceId],
    [true, false, first.instanceId],
  );
  assert.equal((await activate(install2)).activated, true);
  assert.deepEqual(await activate(install3), { activated: false, error: "activation_limit" });
  const validated = await f.license("validate", { licenseKey, instanceId: first.instanceId });
  assert.deepEqual([validated.valid, validated.instanceId], [true, first.instanceId]);
  assert.deepEqual(await f.license("deactivate", { licenseKey, instanceId: first.instanceId }), {
    deactivated: true,
  });
  assert.equal((await activate(install3)).activated, true);
  assert.equal(f.count("activations"), 2);
  const listed = (await (await f.admin(adminPath)).json()) as {
    licenses: { activations: number }[];
  };
  assert.equal(listed.licenses[0].activations, 2);
  // Bound to the issuing product and environment, like a paid key.
  f.env.PRODUCT_ID = "prod_OTHER";
  assert.deepEqual(await f.license("validate", { licenseKey }), {
    valid: false,
    error: "invalid_license",
  });
});

test("a revoked comp key fails exactly like a refunded paid key", async () => {
  const f = setup();
  const issued = await f.issue();
  const keep = await f.issue("beta tester 2");
  const { licenseKey } = issued;
  const activated = await f.license("activate", {
    licenseKey,
    installationId: crypto.randomUUID(),
    instanceName: "Tester Mac",
  });
  assert.equal(activated.activated, true);

  const response = await f.admin(revokePath, { body: { licenseId: issued.licenseId } });
  assert.equal(response.status, 200);
  const revoked = (await response.json()) as { revoked: boolean; revokedAt: number };
  assert.equal(revoked.revoked, true);
  assert.ok(revoked.revokedAt >= issued.createdAt);
  assert.deepEqual(await f.license("validate", { licenseKey }), { valid: false, error: "revoked" });
  assert.deepEqual(await f.license("validate", { licenseKey, instanceId: activated.instanceId }), {
    valid: false,
    error: "revoked",
  });
  assert.deepEqual(
    await f.license("activate", {
      licenseKey,
      installationId: crypto.randomUUID(),
      instanceName: "Tester Mac",
    }),
    { activated: false, error: "revoked" },
  );
  assert.deepEqual(
    await f.license("deactivate", { licenseKey, instanceId: activated.instanceId }),
    { deactivated: false, error: "revoked" },
  );
  // The same tombstone a full refund writes, and the placeholder order follows it.
  assert.deepEqual(
    {
      ...f.db.sql
        .prepare(
          "SELECT p.revoked, p.reason, o.state FROM payments p JOIN orders o ON o.payment_intent_id = p.payment_intent_id WHERE p.payment_intent_id = ?",
        )
        .get(`comp_${issued.licenseId}`),
    },
    { revoked: 1, reason: "comp_revoked", state: "revoked" },
  );
  // Revoking again changes nothing and reports the original time.
  const again = await f.admin(revokePath, { body: { licenseId: issued.licenseId } });
  assert.deepEqual(await again.json(), {
    licenseId: issued.licenseId,
    revoked: true,
    revokedAt: revoked.revokedAt,
  });
  // Other comp keys keep working.
  assert.equal((await f.license("validate", { licenseKey: keep.licenseKey })).valid, true);
  // Unknown and malformed IDs.
  assert.equal((await f.admin(revokePath, { body: { licenseId: randomToken(24) } })).status, 404);
  for (const body of [{ licenseId: "short" }, { licenseId: 7 }, { id: issued.licenseId }]) {
    const bad = await f.admin(revokePath, { body });
    assert.equal(bad.status, 400);
  }
  assert.equal((await f.admin(revokePath)).status, 405);
  assert.equal((await f.admin(adminPath, { method: "DELETE" })).status, 405);
  assert.equal((await f.admin("/v1/admin/other")).status, 404);
});

test("comp placeholder orders can't be reached through the checkout routes", async () => {
  const f = setup();
  const { licenseId } = await f.issue();
  const status = await f.worker.fetch(
    new Request(`${origin}/v1/checkout/status?order=comp_${licenseId}`),
    f.env,
  );
  assert.deepEqual([status.status, await status.json()], [400, { error: "invalid_order" }]);
  const claim = await f.worker.fetch(
    new Request(`${origin}/v1/checkout/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ orderId: `comp_${licenseId}` }),
    }),
    f.env,
  );
  assert.deepEqual([claim.status, await claim.json()], [400, { error: "invalid_body" }]);
});

test("migration 0006 applies to a database holding rows in every table and changes none", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const comp = "0006_comp_licenses.sql";
  assert.ok(files.includes(comp));
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of files.filter((name) => name < comp))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`
    INSERT INTO orders VALUES ('o1', 'cap1', 1, 'cs_1', 'pi_1', 'ready', 1);
    INSERT INTO orders VALUES ('o2', 'cap2', 1, 'cs_2', 'pi_2', 'revoked', 2);
    INSERT INTO payments VALUES ('pi_1', 0, NULL, 1);
    INSERT INTO payments VALUES ('pi_2', 1, 'full_refund', 2);
    INSERT INTO licenses VALUES ('l1', 'o1', 'pi_1', 'https://a.test', 'prod_A', 'live', 'h1', 'c1', 'i1', 1);
    INSERT INTO licenses VALUES ('l2', 'o2', 'pi_2', 'https://a.test', 'prod_A', 'live', 'h2', 'c2', 'i2', 2);
    INSERT INTO activations VALUES ('a1', 'l1', 'inst1', 'Mac', 1);
    INSERT INTO webhook_events VALUES ('evt_1', 'checkout.session.completed', 1);
    INSERT INTO rate_limits VALUES ('bucket', 1, 1);
    INSERT INTO beta_signups (email, created_at) VALUES ('first@example.test', 1790225517612);
    INSERT INTO beta_signups (email, created_at) VALUES ('later@example.test', 1791139887002);
    INSERT INTO email_suppressions VALUES ('later@example.test', 1, 1, 'unsubscribe', 'ref');
  `);
  const tables = [
    "orders",
    "payments",
    "licenses",
    "activations",
    "webhook_events",
    "rate_limits",
    "beta_signups",
    "email_suppressions",
    "dayboard_mailing_recipients",
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
    );
  const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
  const before = snapshot();
  const schemaBefore = schema();
  db.exec(readFileSync(new URL(comp, dir), "utf8"));
  assert.deepEqual(snapshot(), before);
  // Only the new table and its primary-key index were added.
  assert.deepEqual(
    schema().filter((entry) => !String(entry.name).includes("comp_licenses")),
    schemaBefore,
  );
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM waitlist_signups").get()!.n), 1);
  db.exec("INSERT INTO comp_licenses (license_id, label, created_at) VALUES ('l1', 'note', 5)");
  assert.throws(
    () =>
      db.exec("INSERT INTO comp_licenses (license_id, label, created_at) VALUES ('nope', 'x', 5)"),
    /FOREIGN KEY/,
  );
  assert.throws(
    () => db.exec("UPDATE comp_licenses SET revoked_at = 4 WHERE license_id = 'l1'"),
    /CHECK/,
  );
  db.close();
});

// The CLI, run as its own process against the Worker through a loopback HTTP bridge.
const cli = fileURLToPath(new URL("../scripts/comp-license.mjs", import.meta.url));
const run = promisify(execFile);

async function bridge(f: ReturnType<typeof setup>) {
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers({ "CF-Connecting-IP": "198.51.100.9" });
    for (const name of ["authorization", "content-type", "content-length"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await f.worker.fetch(
      new Request(origin + req.url, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      }),
      f.env,
    );
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("Content-Type") ?? "text/plain",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function runCli(args: string[], env: Record<string, string>) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (cause) {
    const failure = cause as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test("the CLI issues keys into a private git-ignored file, lists and revokes them", async () => {
  const f = setup();
  const { server, url } = await bridge(f);
  const dir = await mkdtemp(join(tmpdir(), "dayboard-comp-"));
  try {
    const out = join(dir, "keys.local.jsonl");
    const env = { DAYBOARD_ADMIN_TOKEN: f.token, DAYBOARD_BILLING_ORIGIN: url };
    const issued = await runCli(["issue", "--count", "3", "--out", out, "beta tester"], env);
    assert.equal(issued.code, 0, issued.stderr);
    assert.equal(issued.stderr, "");
    // Keys go only to the file, never to the terminal.
    assert.doesNotMatch(issued.stdout, /DAYB_/);
    assert.match(issued.stdout, /Saved 3 key\(s\)/);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    const records = (await readFile(out, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    assert.deepEqual(
      records.map((record) => record.label),
      ["beta tester 1", "beta tester 2", "beta tester 3"],
    );
    for (const record of records) {
      assert.match(issued.stdout, new RegExp(record.licenseId));
      assert.equal(record.environment, "test");
      assert.equal((await f.license("validate", { licenseKey: record.licenseKey })).valid, true);
    }

    const listed = await runCli(["list"], env);
    assert.equal(listed.code, 0, listed.stderr);
    assert.doesNotMatch(listed.stdout, /DAYB_/);
    assert.match(listed.stdout, /3 comp license\(s\)/);

    const revoked = await runCli(["revoke", records[0].licenseId], env);
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.match(revoked.stdout, new RegExp(`revoked ${records[0].licenseId}`));
    assert.equal(
      (await f.license("validate", { licenseKey: records[0].licenseKey })).error,
      "revoked",
    );
    assert.equal((await runCli(["revoke", randomToken(24)], env)).code, 1);

    // A second run appends instead of replacing earlier keys.
    assert.equal((await runCli(["issue", "--out", out, "beta tester 4"], env)).code, 0);
    assert.equal((await readFile(out, "utf8")).trim().split("\n").length, 4);

    // Refused before any request: an unignored or unwritable output file, an address as label,
    // too many keys, no token, a plain-HTTP remote origin or an unknown command.
    const before = f.count("licenses");
    for (const [args, runEnv] of [
      [["issue", "--out", join(dir, "keys.jsonl"), "tester"], env],
      [["issue", "--out", join(dir, "missing", "keys.local.jsonl"), "tester"], env],
      [["issue", "--out", out, "tester@example.com"], env],
      [["issue", "--out", out, "--count", "51", "tester"], env],
      [["issue", "--out", out, "tester"], { DAYBOARD_BILLING_ORIGIN: url }],
      [
        ["issue", "--out", out, "tester"],
        { ...env, DAYBOARD_BILLING_ORIGIN: "http://example.com" },
      ],
      [["frobnicate"], env],
    ] as [string[], Record<string, string>][]) {
      const result = await runCli(args, runEnv);
      assert.equal(result.code, 2, result.stderr);
    }
    assert.equal(f.count("licenses"), before);

    // A wrong token is reported without echoing it, and nothing is written.
    const wrongToken = randomToken();
    const denied = await runCli(["issue", "--out", out, "tester"], {
      ...env,
      DAYBOARD_ADMIN_TOKEN: wrongToken,
    });
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /HTTP 401 unauthorized/);
    assert.doesNotMatch(denied.stdout + denied.stderr, new RegExp(wrongToken));
    assert.equal((await readFile(out, "utf8")).trim().split("\n").length, 4);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
