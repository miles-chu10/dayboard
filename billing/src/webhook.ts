import Stripe from "stripe";
import type { Config, Env } from "./config.ts";
import { encrypt, hash, randomToken } from "./crypto.ts";
import { error, json, readBoundedText } from "./http.ts";

function id(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}
async function recordEvent(env: Env, event: Stripe.Event): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_events (event_id,event_type,processed_at) VALUES (?,?,?)",
  )
    .bind(event.id, event.type, Date.now())
    .run();
}
async function paid(
  event: Stripe.Event,
  env: Env,
  cfg: Config,
  stripe: Stripe,
  sessionId: string,
): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (
    session.livemode !== (cfg.environment === "live") ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    !session.client_reference_id ||
    !session.payment_intent ||
    session.currency !== cfg.currency
  )
    throw new Error("invalid_paid_session");
  const paymentId = id(session.payment_intent);
  if (!paymentId) throw new Error("payment_missing");
  const payment = await stripe.paymentIntents.retrieve(paymentId);
  if (
    payment.livemode !== (cfg.environment === "live") ||
    payment.status !== "succeeded" ||
    payment.currency !== cfg.currency ||
    payment.amount_received !== session.amount_total ||
    !session.amount_total ||
    session.amount_total <= 0
  )
    throw new Error("invalid_payment");
  const items = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 2,
    expand: ["data.price.product"],
  });
  const item = items.data[0];
  if (
    items.has_more ||
    items.data.length !== 1 ||
    item.quantity !== 1 ||
    item.price?.id !== cfg.priceId ||
    id(item.price.product) !== cfg.productId ||
    item.price.currency !== cfg.currency ||
    item.price.livemode !== (cfg.environment === "live")
  )
    throw new Error("invalid_line_items");
  const order = await env.DB.prepare("SELECT id FROM orders WHERE id=? AND session_id=?")
    .bind(session.client_reference_id, session.id)
    .first<{ id: string }>();
  if (!order) throw new Error("order_not_found");
  const key = `DAYB_${randomToken()}`;
  const sealed = await encrypt(key, env.ENCRYPTION_KEY);
  const keyHash = await hash(key, env.HASH_SECRET);
  const licenseId = randomToken(24);
  // D1 batch is one SQLite transaction. Revocation and issuance serialize at this boundary.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO payments (payment_intent_id,revoked,updated_at) VALUES (?,0,?)",
    ).bind(paymentId, Date.now()),
    env.DB.prepare(
      "UPDATE orders SET payment_intent_id=? WHERE id=? AND session_id=? AND (payment_intent_id IS NULL OR payment_intent_id=?)",
    ).bind(paymentId, order.id, session.id, paymentId),
    env.DB.prepare(`INSERT OR IGNORE INTO licenses (id,order_id,payment_intent_id,issuer,product_id,environment,key_hash,key_ciphertext,key_iv,created_at)
      SELECT ?,o.id,p.payment_intent_id,?,?,?,?,?,?,? FROM orders o JOIN payments p ON p.payment_intent_id=?
      WHERE o.id=? AND o.session_id=? AND o.payment_intent_id=? AND p.revoked=0`).bind(
      licenseId,
      cfg.origin,
      cfg.productId,
      cfg.environment,
      keyHash,
      sealed.ciphertext,
      sealed.iv,
      Date.now(),
      paymentId,
      order.id,
      session.id,
      paymentId,
    ),
    env.DB.prepare(`UPDATE orders SET state=CASE WHEN (SELECT revoked FROM payments WHERE payment_intent_id=?)=1 THEN 'revoked'
      WHEN EXISTS (SELECT 1 FROM licenses WHERE order_id=?) THEN 'ready' ELSE state END WHERE id=?`).bind(
      paymentId,
      order.id,
      order.id,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_events (event_id,event_type,processed_at) VALUES (?,?,?)",
    ).bind(event.id, event.type, Date.now()),
  ]);
  const row = await env.DB.prepare("SELECT state FROM orders WHERE id=?")
    .bind(order.id)
    .first<{ state: string }>();
  if (row?.state !== "ready" && row?.state !== "revoked") throw new Error("issuance_not_durable");
}
async function completedUnpaid(
  event: Stripe.Event,
  env: Env,
  cfg: Config,
  stripe: Stripe,
  sessionId: string,
): Promise<boolean> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === "paid") return false;
  if (
    session.payment_status !== "unpaid" ||
    session.livemode !== (cfg.environment === "live") ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    !session.client_reference_id
  )
    throw new Error("invalid_pending_session");
  const order = await env.DB.prepare("SELECT id FROM orders WHERE id=? AND session_id=?")
    .bind(session.client_reference_id, session.id)
    .first<{ id: string }>();
  if (!order) throw new Error("order_not_found");
  await recordEvent(env, event);
  return true;
}

async function refundOrDispute(
  event: Stripe.Event,
  env: Env,
  cfg: Config,
  stripe: Stripe,
): Promise<void> {
  const eventObject = event.data.object as { id?: string };
  if (!eventObject.id) throw new Error("missing_event_object");
  let chargeId: string;
  if (event.type === "charge.dispute.created") {
    const dispute = await stripe.disputes.retrieve(eventObject.id);
    if (dispute.livemode !== (cfg.environment === "live")) throw new Error("wrong_mode");
    const resolved = id(dispute.charge);
    if (!resolved) throw new Error("dispute_charge_missing");
    chargeId = resolved;
  } else chargeId = eventObject.id;
  const charge = await stripe.charges.retrieve(chargeId);
  if (charge.livemode !== (cfg.environment === "live")) throw new Error("wrong_mode");
  const paymentId = id(charge.payment_intent);
  if (!paymentId) throw new Error("payment_missing");
  const fullRefund = charge.amount > 0 && charge.amount_refunded >= charge.amount;
  const revoke = event.type === "charge.dispute.created" || fullRefund;
  if (!revoke) {
    await recordEvent(env, event);
    return;
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payments (payment_intent_id,revoked,reason,updated_at) VALUES (?,1,?,?)
      ON CONFLICT(payment_intent_id) DO UPDATE SET revoked=1,reason=excluded.reason,updated_at=excluded.updated_at`).bind(
      paymentId,
      event.type === "charge.dispute.created" ? "dispute" : "full_refund",
      Date.now(),
    ),
    env.DB.prepare("UPDATE orders SET state='revoked' WHERE payment_intent_id=?").bind(paymentId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_events (event_id,event_type,processed_at) VALUES (?,?,?)",
    ).bind(event.id, event.type, Date.now()),
  ]);
}
async function failed(
  event: Stripe.Event,
  env: Env,
  cfg: Config,
  stripe: Stripe,
  sessionId: string,
): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.livemode !== (cfg.environment === "live") || session.payment_status === "paid") {
    await recordEvent(env, event);
    return;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET state='failed' WHERE session_id=? AND state='pending'").bind(
      session.id,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_events (event_id,event_type,processed_at) VALUES (?,?,?)",
    ).bind(event.id, event.type, Date.now()),
  ]);
}

export async function webhook(
  request: Request,
  env: Env,
  cfg: Config,
  stripe: Stripe,
): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed");
  if (Number(request.headers.get("Content-Length") ?? 0) > 131072)
    return error(413, "payload_too_large");
  let payload: string;
  try {
    payload = await readBoundedText(request, 131072);
  } catch {
    return error(413, "payload_too_large");
  }
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return error(400, "invalid_signature");
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return error(400, "invalid_signature");
  }
  if (event.livemode !== (cfg.environment === "live")) return error(400, "wrong_mode");
  try {
    const raw = event.data.object as { id?: string };
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      if (!raw.id) return error(400, "invalid_event");
      if (
        event.type !== "checkout.session.completed" ||
        !(await completedUnpaid(event, env, cfg, stripe, raw.id))
      )
        await paid(event, env, cfg, stripe, raw.id);
    } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      await refundOrDispute(event, env, cfg, stripe);
    } else if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      if (!raw.id) return error(400, "invalid_event");
      await failed(event, env, cfg, stripe, raw.id);
    } else await recordEvent(env, event);
    return json({ received: true });
  } catch {
    // A non-2xx response asks Stripe to retry transient API or database failures.
    return error(503, "processing_unavailable");
  }
}
