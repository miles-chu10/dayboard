import type Stripe from "stripe";
import type { Config, Env } from "./config.ts";
import { decrypt, hash, randomToken } from "./crypto.ts";
import { error, json, limit, readJson, sameOrigin, securityHeaders } from "./http.ts";
import { buyPage, receiptPage, buyScript, receiptScript } from "./pages.ts";

interface Order {
  id: string;
  session_id: string | null;
  state: "pending" | "ready" | "failed" | "revoked";
  capability_expires_at: number;
}
const orderIdPattern = /^[A-Za-z0-9_-]{32}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const capabilityAge = 7 * 86400;
function cookieName(orderId: string): string {
  return `__Host-dayboard-order-${orderId}`;
}
function cookie(request: Request, orderId: string): string | null {
  const name = `${cookieName(orderId)}=`;
  const pair = request.headers
    .get("Cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith(name));
  const value = pair?.slice(name.length) ?? null;
  return value && tokenPattern.test(value) ? value : null;
}
function setCookie(orderId: string, token: string): string {
  return `${cookieName(orderId)}=${token}; Path=/; Max-Age=${capabilityAge}; Secure; HttpOnly; SameSite=Lax`;
}
async function currentOrder(request: Request, env: Env, orderId: string): Promise<Order | null> {
  const token = cookie(request, orderId);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT id,session_id,state,capability_expires_at FROM orders WHERE id=? AND capability_hash=? AND capability_expires_at>?",
  )
    .bind(orderId, await hash(token, env.HASH_SECRET), Date.now())
    .first<Order>();
}
function html(markup: string, headers: HeadersInit = {}): Response {
  return new Response(markup, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}
function script(code: string): Response {
  return new Response(code, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
function orderIdFromBody(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 1 &&
    typeof fields.orderId === "string" &&
    orderIdPattern.test(fields.orderId)
    ? fields.orderId
    : null;
}
function receiptUrl(cfg: Config, orderId: string): string {
  return `${cfg.origin}/receipt?order=${orderId}`;
}

export async function checkout(
  request: Request,
  env: Env,
  cfg: Config,
  stripe: Stripe,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/buy") {
    if (!(await limit(request, env, "checkout:buy", 30))) return error(429, "rate_limited");
    const orderId = randomToken(24);
    const token = randomToken();
    return html(buyPage(orderId), { "Set-Cookie": setCookie(orderId, token) });
  }
  if (request.method === "GET" && url.pathname === "/receipt") return html(receiptPage);
  if (request.method === "GET" && url.pathname === "/buy.js") return script(buyScript);
  if (request.method === "GET" && url.pathname === "/receipt.js") return script(receiptScript);
  if (url.pathname === "/v1/checkout" && request.method === "POST") {
    if (!sameOrigin(request, cfg)) return error(403, "origin_mismatch");
    if (!(await limit(request, env, "checkout:create", 10))) return error(429, "rate_limited");
    let body: unknown;
    try {
      body = await readJson(request, 256);
    } catch {
      return error(400, "invalid_body");
    }
    const orderId = orderIdFromBody(body);
    if (!orderId) return error(400, "invalid_body");
    const token = cookie(request, orderId);
    if (!token) return error(401, "claim_required");
    const capHash = await hash(token, env.HASH_SECRET);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO orders (id,capability_hash,capability_expires_at,created_at) VALUES (?,?,?,?)",
    )
      .bind(orderId, capHash, now + capabilityAge * 1000, now)
      .run();
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    if (order.state !== "pending") return json({ url: receiptUrl(cfg, orderId) });
    try {
      const price = await stripe.prices.retrieve(cfg.priceId);
      if (
        !price.active ||
        price.type !== "one_time" ||
        price.currency !== cfg.currency ||
        price.product !== cfg.productId ||
        price.livemode !== (cfg.environment === "live")
      )
        return error(503, "price_configuration_invalid");
      let session: Stripe.Checkout.Session;
      if (order.session_id) session = await stripe.checkout.sessions.retrieve(order.session_id);
      else {
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            client_reference_id: orderId,
            line_items: [{ price: cfg.priceId, quantity: 1 }],
            success_url: receiptUrl(cfg, orderId),
            cancel_url: `${cfg.origin}/buy`,
            integration_identifier: "dayboard_ynevvaow",
            metadata: { order_id: orderId },
          },
          { idempotencyKey: `dayboard-checkout-${orderId}` },
        );
        await env.DB.prepare("UPDATE orders SET session_id=? WHERE id=? AND session_id IS NULL")
          .bind(session.id, orderId)
          .run();
      }
      if (!session.url || session.status === "expired") {
        await env.DB.prepare("UPDATE orders SET state='failed' WHERE id=? AND state='pending'")
          .bind(orderId)
          .run();
        return json({ url: receiptUrl(cfg, orderId) });
      }
      return json({ url: session.url });
    } catch {
      return error(503, "checkout_temporarily_unavailable");
    }
  }
  if (url.pathname === "/v1/checkout/status" && request.method === "GET") {
    if (!(await limit(request, env, "checkout:status", 60))) return error(429, "rate_limited");
    const orderId = url.searchParams.get("order");
    if (!orderId || !orderIdPattern.test(orderId)) return error(400, "invalid_order");
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    return json({ state: order.state });
  }
  if (url.pathname === "/v1/checkout/claim" && request.method === "POST") {
    if (!sameOrigin(request, cfg)) return error(403, "origin_mismatch");
    if (!(await limit(request, env, "checkout:claim", 20))) return error(429, "rate_limited");
    let body: unknown;
    try {
      body = await readJson(request, 256);
    } catch {
      return error(400, "invalid_body");
    }
    const orderId = orderIdFromBody(body);
    if (!orderId) return error(400, "invalid_body");
    const order = await currentOrder(request, env, orderId);
    if (!order) return error(401, "claim_required");
    if (order.state !== "ready") return error(409, order.state);
    const row = await env.DB.prepare(`SELECT l.key_ciphertext,l.key_iv,p.revoked FROM licenses l
      JOIN payments p ON p.payment_intent_id=l.payment_intent_id
      WHERE l.order_id=? AND l.issuer=? AND l.product_id=? AND l.environment=?`)
      .bind(order.id, cfg.origin, cfg.productId, cfg.environment)
      .first<{ key_ciphertext: string; key_iv: string; revoked: number }>();
    if (!row || row.revoked) return error(409, "revoked");
    return json({ licenseKey: await decrypt(row.key_ciphertext, row.key_iv, env.ENCRYPTION_KEY) });
  }
  return error(404, "not_found");
}
