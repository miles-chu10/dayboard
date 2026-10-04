import type { Env } from "./config.ts";
import { limit, object, readJson, securityHeaders } from "./http.ts";

// Waitlist signups work before Stripe is configured: they need only D1, HASH_SECRET (rate limiting)
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

// Workers pass an execution context; direct calls (unit tests) omit it.
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export async function waitlistSignup(
  request: Request,
  env: Env,
  ctx?: WaitUntil,
): Promise<Response> {
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
  // Database errors can quote the address, so the log gets only a generic message.
  const unavailable = () => {
    console.error("Waitlist signup failed");
    return reply(503, { error: "service_unavailable" });
  };

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
  try {
    // Both routes share the original bucket, so the alias can't double the per-network limit.
    if (!(await limit(request, env, "beta:signup", 5)))
      return reply(429, { error: "rate_limited" });
    const body = await readJson(request, 1024).catch(() => null);
    // Old clients may omit the hidden company field, but a present one must be a string.
    if (!object(body) || (body.company !== undefined && typeof body.company !== "string"))
      return reply(400, { error: "invalid_body" });
    // A filled hidden field means a bot; answer as usual so it learns nothing.
    if (typeof body.company === "string" && body.company.trim()) return reply(200, { ok: true });
    const email = normalizeEmail(body.email);
    if (!email) return reply(400, { error: "invalid_email" });
    // New and existing addresses get the same answer, so the form can't reveal who signed up.
    // Only the address and time are written, so a request can't choose its cohort or review
    // label: a new row takes the migration 0004 defaults, an unreviewed waitlist entry.
    const inserted = await env.DB.prepare(
      "INSERT INTO beta_signups (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
    )
      .bind(email, Date.now())
      .run();
    // D1 normally throws on failure; an unconfirmed write is still never reported as saved.
    if (!inserted.success) return unavailable();
    if (inserted.meta.changes === 1) {
      // After the reply when possible, so a new address isn't slower to answer than a listed one.
      const sent = notify(env, site, email);
      if (ctx) ctx.waitUntil(sent);
      else await sent;
    }
    return reply(200, { ok: true });
  } catch {
    // The address may not be stored, so never answer ok. The page keeps its retry path.
    return unavailable();
  }
}

// Emails the owner once per new address. A failure is only logged, generically: the signup is
// already stored, and the error could quote addresses.
async function notify(env: Env, site: string, email: string): Promise<void> {
  if (!env.SIGNUP_EMAIL || !env.SIGNUP_NOTIFY_TO) return;
  try {
    await env.SIGNUP_EMAIL.send({
      from: { name: "DayBoard signups", email: `signups@${new URL(site).hostname}` },
      to: env.SIGNUP_NOTIFY_TO,
      subject: "New DayBoard waitlist signup",
      text: `${email} joined the DayBoard waitlist.`,
    });
  } catch {
    console.error("Waitlist owner notification failed");
  }
}
