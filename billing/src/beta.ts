import type { Env } from "./config.ts";
import { limit, object, readJson, securityHeaders } from "./http.ts";

// Beta signups work before Stripe is configured: they need only D1, HASH_SECRET (rate limiting)
// and SITE_ORIGIN, the website allowed to post here.
function siteOrigin(env: Env): string | null {
  try {
    const url = new URL(env.SITE_ORIGIN ?? "");
    return url.protocol === "https:" && url.origin === env.SITE_ORIGIN ? url.origin : null;
  } catch {
    return null;
  }
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (email.length > 254 || at < 1 || at > 64 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null;
  if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return email;
}

export async function betaSignup(request: Request, env: Env): Promise<Response> {
  const site = siteOrigin(env);
  const headers = {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin",
    ...(site ? { "Access-Control-Allow-Origin": site } : {}),
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });

  if (!site || !env.DB || !env.HASH_SECRET || env.HASH_SECRET.length < 32)
    return reply(503, { error: "signup_unconfigured" });
  if (request.headers.get("Origin") !== site) return reply(403, { error: "origin_not_allowed" });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!(await limit(request, env, "beta:signup", 5))) return reply(429, { error: "rate_limited" });

  let body: unknown;
  try {
    body = await readJson(request, 1024);
  } catch {
    return reply(400, { error: "invalid_body" });
  }
  if (!object(body)) return reply(400, { error: "invalid_body" });
  // A filled hidden field means a bot; answer as usual so it learns nothing.
  if (typeof body.company === "string" && body.company.trim()) return reply(200, { ok: true });
  const email = normalizeEmail(body.email);
  if (!email) return reply(400, { error: "invalid_email" });
  // New and existing addresses get the same answer, so the form can't reveal who signed up.
  await env.DB.prepare(
    "INSERT INTO beta_signups (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
  )
    .bind(email, Date.now())
    .run();
  return reply(200, { ok: true });
}
