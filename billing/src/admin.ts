import type { Config, Env } from "./config.ts";
import { hash, mintLicense, randomToken, safeEqual } from "./crypto.ts";
import { count, error, json, limit, object, readJson, uncount } from "./http.ts";

// Owner-only routes for complimentary ("comp") licenses. Callers authenticate with
// `Authorization: Bearer <ADMIN_TOKEN>`. Nothing here logs the token, a key or a request body.
const MIN_TOKEN_LENGTH = 32;
// Enough for a 50-key CLI run plus a list, from one address in one minute.
const REQUEST_ROUTE = "admin:request";
const REQUESTS_PER_MINUTE = 120;
const FAILURE_ROUTE = "admin:auth-failure";
const FAILURES_PER_MINUTE = 5;
const LABEL_MAX = 64;
const LIST_MAX = 1000;
const licenseIdPattern = /^[A-Za-z0-9_-]{32}$/;
// Stripe IDs never start with comp_, and checkout order IDs are exactly 32 characters.
const COMP_PREFIX = "comp_";

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
}

async function authorized(request: Request, token: string): Promise<boolean> {
  const provided = /^Bearer +(\S+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  // Compare even when the header is missing or malformed, so every failure takes the same path.
  const equal = await safeEqual(provided ?? "", token);
  return equal && provided !== undefined;
}

/** A short owner-chosen label such as "beta tester 7". Email addresses are refused. */
function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!label || label.length > LABEL_MAX || label.includes("@")) return null;
  if (Array.from(label).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  return label;
}

async function readFields(request: Request, field: string): Promise<unknown> {
  const body = await readJson(request, 1024).catch(() => null);
  if (!object(body) || Object.keys(body).length !== 1 || !(field in body)) return undefined;
  return body[field];
}

async function issue(request: Request, env: Env, cfg: Config): Promise<Response> {
  const raw = await readFields(request, "label");
  if (raw === undefined) return error(400, "invalid_body");
  const label = normalizeLabel(raw);
  if (!label) return error(400, "invalid_label");
  // Exactly the paid path's key generation, hashing and encryption.
  const { licenseId, key, keyHash, sealed } = await mintLicense(
    env.ENCRYPTION_KEY,
    env.HASH_SECRET,
  );
  const ref = `${COMP_PREFIX}${licenseId}`;
  // The placeholder order can never be claimed: its capability hash belongs to a token nobody
  // receives, and it expired at time zero.
  const unclaimable = await hash(randomToken(), env.HASH_SECRET);
  const now = Date.now();
  // One D1 transaction: either the whole comp license exists or none of it does.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payments (payment_intent_id,revoked,updated_at) VALUES (?,0,?)",
    ).bind(ref, now),
    env.DB.prepare(
      "INSERT INTO orders (id,capability_hash,capability_expires_at,payment_intent_id,state,created_at) VALUES (?,?,0,?,'ready',?)",
    ).bind(ref, unclaimable, ref, now),
    env.DB.prepare(
      "INSERT INTO licenses (id,order_id,payment_intent_id,issuer,product_id,environment,key_hash,key_ciphertext,key_iv,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      licenseId,
      ref,
      ref,
      cfg.origin,
      cfg.productId,
      cfg.environment,
      keyHash,
      sealed.ciphertext,
      sealed.iv,
      now,
    ),
    env.DB.prepare("INSERT INTO comp_licenses (license_id,label,created_at) VALUES (?,?,?)").bind(
      licenseId,
      label,
      now,
    ),
  ]);
  return json(
    {
      licenseId,
      licenseKey: key,
      label,
      createdAt: now,
      meta: { issuer: cfg.origin, productId: cfg.productId, environment: cfg.environment },
    },
    201,
  );
}

async function revoke(request: Request, env: Env): Promise<Response> {
  const licenseId = await readFields(request, "licenseId");
  if (licenseId === undefined) return error(400, "invalid_body");
  if (typeof licenseId !== "string" || !licenseIdPattern.test(licenseId))
    return error(400, "invalid_license_id");
  const select = env.DB.prepare("SELECT revoked_at FROM comp_licenses WHERE license_id=?").bind(
    licenseId,
  );
  const found = await select.first<{ revoked_at: number | null }>();
  // Only comp licenses: paid licenses are revoked by Stripe refunds and disputes.
  if (!found) return error(404, "not_found");
  if (found.revoked_at === null) {
    const now = Date.now();
    // The same tombstone a full refund writes, so validation and activation answer "revoked".
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET revoked=1,reason='comp_revoked',updated_at=?
        WHERE payment_intent_id=(SELECT l.payment_intent_id FROM licenses l
          JOIN comp_licenses c ON c.license_id=l.id WHERE l.id=?)`).bind(now, licenseId),
      env.DB.prepare(`UPDATE orders SET state='revoked'
        WHERE id=(SELECT l.order_id FROM licenses l
          JOIN comp_licenses c ON c.license_id=l.id WHERE l.id=?)`).bind(licenseId),
      env.DB.prepare(
        "UPDATE comp_licenses SET revoked_at=? WHERE license_id=? AND revoked_at IS NULL",
      ).bind(now, licenseId),
    ]);
  }
  const after = await select.first<{ revoked_at: number }>();
  return json({ licenseId, revoked: true, revokedAt: after?.revoked_at ?? null });
}

async function list(env: Env): Promise<Response> {
  // Newest first, so a long list drops the oldest keys rather than the ones just issued. The
  // rowid follows insertion order, which orders keys issued within the same millisecond.
  const rows = await env.DB.prepare(
    `SELECT c.license_id,c.label,c.created_at,c.revoked_at,l.environment,
      (SELECT COUNT(*) FROM activations a WHERE a.license_id=c.license_id) AS activations
    FROM comp_licenses c JOIN licenses l ON l.id=c.license_id
    ORDER BY c.created_at DESC,c.rowid DESC LIMIT ?`,
  )
    .bind(LIST_MAX + 1)
    .all<{
      license_id: string;
      label: string;
      created_at: number;
      revoked_at: number | null;
      environment: string;
      activations: number;
    }>();
  return json({
    licenses: rows.results.slice(0, LIST_MAX).map((row) => ({
      licenseId: row.license_id,
      label: row.label,
      environment: row.environment,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      activations: row.activations,
    })),
    truncated: rows.results.length > LIST_MAX,
  });
}

export async function admin(request: Request, env: Env, cfg: Config): Promise<Response> {
  const token = env.ADMIN_TOKEN;
  // Closed by default: without a strong token configured, no admin request is considered.
  if (!token || token.length < MIN_TOKEN_LENGTH) return error(503, "admin_unconfigured");
  // Both counters are per hashed client address and minute, and both are counted before the token
  // is compared, each in one atomic statement, so parallel requests can't share a count.
  if (!(await limit(request, env, REQUEST_ROUTE, REQUESTS_PER_MINUTE)))
    return error(429, "rate_limited");
  // Every request reserves a failure slot and gives it back only when its token matches. Once all
  // slots are taken, every admin request from the address, even a correct one, waits for the
  // next minute.
  const attempt = await count(request, env, FAILURE_ROUTE);
  if (attempt.hits > FAILURES_PER_MINUTE) return error(429, "rate_limited");
  if (!(await authorized(request, token))) return unauthorized();
  await uncount(env, attempt);
  const path = new URL(request.url).pathname;
  if (path === "/v1/admin/comp-licenses") {
    if (request.method === "POST") return issue(request, env, cfg);
    if (request.method === "GET") return list(env);
    return error(405, "method_not_allowed");
  }
  if (path === "/v1/admin/comp-licenses/revoke") {
    if (request.method !== "POST") return error(405, "method_not_allowed");
    return revoke(request, env);
  }
  return error(404, "not_found");
}
