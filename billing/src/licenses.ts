import type { Config, Env } from "./config.ts";
import { hash } from "./crypto.ts";
import { error, json, limit, object, readJson } from "./http.ts";
import { INSTALLATION_ID_PATTERN, LICENSE_KEY_PATTERN } from "../../shared/license-contract.ts";

interface LicenseRow {
  id: string;
  revoked: number;
}
const keyInfo = { status: "active" as const, expiresAt: null };
function meta(cfg: Config) {
  return { issuer: cfg.origin, productId: cfg.productId, environment: cfg.environment };
}
function failure(kind: "validate" | "activate" | "deactivate", reason: string) {
  return json({
    [kind === "validate" ? "valid" : kind === "activate" ? "activated" : "deactivated"]: false,
    error: reason,
  });
}
function validString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export async function licenses(request: Request, env: Env, cfg: Config): Promise<Response> {
  const route = new URL(request.url).pathname;
  const kind = route.substring("/v1/licenses/".length) as "validate" | "activate" | "deactivate";
  if (!["validate", "activate", "deactivate"].includes(kind)) return error(404, "not_found");
  if (request.method !== "POST") return error(405, "method_not_allowed");
  if (!(await limit(request, env, `license:${kind}`, 30))) return error(429, "rate_limited");
  let input: unknown;
  try {
    input = await readJson(request);
  } catch {
    return error(400, "invalid_body");
  }
  if (
    !object(input) ||
    !validString(input.licenseKey, 48) ||
    !LICENSE_KEY_PATTERN.test(input.licenseKey)
  )
    return failure(kind, "invalid_license");
  if (
    kind === "activate" &&
    (!validString(input.installationId, 36) ||
      !INSTALLATION_ID_PATTERN.test(input.installationId) ||
      !validString(input.instanceName, 100) ||
      Array.from(input.instanceName).some((character) => character.charCodeAt(0) < 32))
  )
    return failure(kind, "invalid_installation");
  if (
    kind === "deactivate" &&
    (!validString(input.instanceId, 64) || !INSTALLATION_ID_PATTERN.test(input.instanceId))
  )
    return failure(kind, "invalid_instance");
  if (
    kind === "validate" &&
    input.instanceId !== undefined &&
    (!validString(input.instanceId, 64) || !INSTALLATION_ID_PATTERN.test(input.instanceId))
  )
    return failure(kind, "invalid_instance");
  const keyHash = await hash(input.licenseKey, env.HASH_SECRET);
  const license = await env.DB.prepare(
    `SELECT l.id,p.revoked FROM licenses l JOIN payments p ON p.payment_intent_id=l.payment_intent_id WHERE l.key_hash=? AND l.issuer=? AND l.product_id=? AND l.environment=?`,
  )
    .bind(keyHash, cfg.origin, cfg.productId, cfg.environment)
    .first<LicenseRow>();
  if (!license) return failure(kind, "invalid_license");
  if (license.revoked) return failure(kind, "revoked");
  if (kind === "validate") {
    if (input.instanceId) {
      const existing = await env.DB.prepare(
        "SELECT 1 FROM activations WHERE license_id=? AND instance_id=?",
      )
        .bind(license.id, input.instanceId)
        .first();
      if (!existing) return failure(kind, "invalid_instance");
    }
    return json({
      valid: true,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      license: keyInfo,
      meta: meta(cfg),
    });
  }
  if (kind === "deactivate") {
    await env.DB.prepare("DELETE FROM activations WHERE license_id=? AND instance_id=?")
      .bind(license.id, input.instanceId)
      .run();
    return json({ deactivated: true });
  }
  const existing = await env.DB.prepare(
    "SELECT instance_id FROM activations WHERE license_id=? AND installation_id=?",
  )
    .bind(license.id, input.installationId)
    .first<{ instance_id: string }>();
  if (existing)
    return json({
      activated: true,
      created: false,
      instanceId: existing.instance_id,
      license: keyInfo,
      meta: meta(cfg),
    });
  const instanceId = crypto.randomUUID();
  const result =
    await env.DB.prepare(`INSERT OR IGNORE INTO activations (instance_id,license_id,installation_id,instance_name,created_at)
    SELECT ?,l.id,?,?,? FROM licenses l JOIN payments p ON p.payment_intent_id=l.payment_intent_id
    WHERE l.id=? AND p.revoked=0 AND (SELECT COUNT(*) FROM activations WHERE license_id=l.id)<?`)
      .bind(
        instanceId,
        input.installationId,
        input.instanceName,
        Date.now(),
        license.id,
        cfg.activationLimit,
      )
      .run();
  if (result.meta.changes === 1)
    return json({ activated: true, created: true, instanceId, license: keyInfo, meta: meta(cfg) });
  const after = await env.DB.prepare(
    "SELECT instance_id FROM activations WHERE license_id=? AND installation_id=?",
  )
    .bind(license.id, input.installationId)
    .first<{ instance_id: string }>();
  if (after)
    return json({
      activated: true,
      created: false,
      instanceId: after.instance_id,
      license: keyInfo,
      meta: meta(cfg),
    });
  const payment = await env.DB.prepare(
    "SELECT revoked FROM payments p JOIN licenses l ON l.payment_intent_id=p.payment_intent_id WHERE l.id=?",
  )
    .bind(license.id)
    .first<{ revoked: number }>();
  return failure(kind, payment?.revoked ? "revoked" : "activation_limit");
}
