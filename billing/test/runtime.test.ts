import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from "miniflare";
import Stripe from "stripe";
import { DayBoardLicenseVerifier } from "../../main/services/license/dayboard-verifier.ts";
import { LicenseService, type LicenseRecord } from "../../main/services/license/license-service.ts";
import { randomToken } from "../src/crypto.ts";

const origin = "https://billing.example.test";

test("real Worker, D1 and Stripe SDK complete delivery, desktop activation and refund safely", async () => {
  const bundle = await build({
    entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const secret = `whsec_${randomToken()}`;
  const sessions = new Map<string, Record<string, unknown>>();
  let calls = 0;
  let refunded = false;
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
        SERVICE_ORIGIN: origin,
        PRODUCT_ID: "prod_RUNTIME",
        PRICE_ID: "price_RUNTIME",
        PRICE_CURRENCY: "usd",
        ENVIRONMENT: "test",
        ACTIVATION_LIMIT: "2",
        STRIPE_SECRET_KEY: "rk_test_disposable_runtime",
        STRIPE_WEBHOOK_SECRET: secret,
        ENCRYPTION_KEY: randomToken(),
        HASH_SECRET: randomToken(),
      },
      // Every outbound request is intercepted. No provider, account or Internet call can occur.
      outboundService: async (request) => {
        const url = new URL(request.url);
        assert.equal(url.origin, "https://api.stripe.com");
        calls++;
        let data: unknown;
        if (url.pathname === "/v1/prices/price_RUNTIME") {
          data = {
            id: "price_RUNTIME",
            object: "price",
            active: true,
            type: "one_time",
            currency: "usd",
            product: "prod_RUNTIME",
            livemode: false,
          };
        } else if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
          const params = new URLSearchParams(await request.text());
          assert.equal(params.get("mode"), "payment");
          assert.equal(params.get("line_items[0][price]"), "price_RUNTIME");
          assert.equal(params.get("line_items[0][quantity]"), "1");
          assert.equal(params.has("payment_method_types[0]"), false);
          assert.ok(request.headers.get("Idempotency-Key"));
          const order = params.get("client_reference_id");
          const existing = [...sessions.values()].find(
            (entry) => entry.client_reference_id === order,
          );
          if (existing) data = existing;
          else {
            const index = sessions.size + 1;
            const session = {
              id: `cs_test_runtime${index}`,
              object: "checkout.session",
              mode: "payment",
              status: "open",
              payment_status: "unpaid",
              livemode: false,
              client_reference_id: order,
              payment_intent: `pi_runtime${index}`,
              currency: "usd",
              amount_total: 1000,
              url: `https://checkout.stripe.com/c/pay/cs_test_runtime${index}`,
            };
            sessions.set(session.id, session);
            data = session;
          }
        } else if (/^\/v1\/checkout\/sessions\/[^/]+\/line_items$/.test(url.pathname)) {
          data = {
            object: "list",
            has_more: false,
            data: [
              {
                quantity: 1,
                price: {
                  id: "price_RUNTIME",
                  product: "prod_RUNTIME",
                  currency: "usd",
                  livemode: false,
                },
              },
            ],
          };
        } else if (url.pathname.startsWith("/v1/checkout/sessions/")) {
          data = sessions.get(url.pathname.split("/").at(-1)!);
          assert.ok(data, "requested session must belong to this disposable fixture");
        } else if (url.pathname.startsWith("/v1/payment_intents/")) {
          data = {
            id: url.pathname.split("/").at(-1),
            object: "payment_intent",
            livemode: false,
            status: "succeeded",
            currency: "usd",
            amount_received: 1000,
          };
        } else if (url.pathname === "/v1/charges/ch_runtime1") {
          data = {
            id: "ch_runtime1",
            object: "charge",
            livemode: false,
            payment_intent: "pi_runtime1",
            amount: 1000,
            amount_refunded: refunded ? 1000 : 0,
          };
        } else throw new Error(`Unexpected fixture operation: ${request.method} ${url.pathname}`);
        return new RuntimeResponse(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      const migration = await readFile(new URL(file, dir), "utf8");
      // D1 exec treats newlines as statement boundaries; prepare complete migration statements.
      await db.batch(
        migration
          .split(";")
          .map((sql) => sql.trim())
          .filter(Boolean)
          .map((sql) => db.prepare(sql)),
      );
    }
    const request = (path: string, method = "GET", cookie = "", body?: unknown) =>
      mf.dispatchFetch(origin + path, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const drafts = await Promise.all([request("/buy"), request("/buy")]);
    const orders = await Promise.all(
      drafts.map(async (response) => {
        assert.equal(response.status, 200);
        const html = await response.text();
        const orderId = html.match(/data-order-id="([A-Za-z0-9_-]{32})"/)?.[1];
        assert.ok(orderId);
        const cookie = response.headers.get("set-cookie")!;
        assert.match(cookie, /__Host-dayboard-order-/);
        assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
        return { orderId, cookie: cookie.split(";")[0] };
      }),
    );
    const cookies = orders.map((o) => o.cookie).join("; ");
    for (const order of orders) {
      const response = await request("/v1/checkout", "POST", cookies, { orderId: order.orderId });
      assert.equal(response.status, 200);
      assert.match(
        ((await response.json()) as { url: string }).url,
        /^https:\/\/checkout\.stripe\.com\//,
      );
    }
    const sdk = new Stripe("rk_test_disposable_runtime");
    const signed = async (type: string, eventId: string, objectId: string) => {
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        type,
        livemode: false,
        data: { object: { id: objectId } },
      });
      const signature = sdk.webhooks.generateTestHeaderString({ payload, secret });
      return mf.dispatchFetch(origin + "/v1/stripe/webhook", {
        method: "POST",
        headers: { "Stripe-Signature": signature },
        body: payload,
      });
    };
    const first = sessions.get("cs_test_runtime1")!;
    first.status = "complete";
    first.payment_status = "paid";
    const fulfilled = await Promise.all([
      signed("checkout.session.completed", "evt_runtime1", String(first.id)),
      signed("checkout.session.completed", "evt_runtime1", String(first.id)),
    ]);
    assert.deepEqual(
      fulfilled.map((r) => r.status),
      [200, 200],
    );
    assert.deepEqual(
      await (
        await request(`/v1/checkout/status?order=${orders[0].orderId}`, "GET", cookies)
      ).json(),
      { state: "ready" },
    );
    assert.deepEqual(
      await (
        await request(`/v1/checkout/status?order=${orders[1].orderId}`, "GET", cookies)
      ).json(),
      { state: "pending" },
    );
    assert.equal(
      (await request("/v1/checkout/claim", "POST", "", { orderId: orders[0].orderId })).status,
      401,
    );
    const claim = await request("/v1/checkout/claim", "POST", cookies, {
      orderId: orders[0].orderId,
    });
    assert.equal(claim.status, 200);
    const { licenseKey } = (await claim.json()) as { licenseKey: string };
    assert.match(licenseKey, /^DAYB_[A-Za-z0-9_-]{43}$/);
    const fetchFixture: typeof fetch = async (input, init) => {
      const response = await mf.dispatchFetch(
        String(input),
        init as Parameters<typeof mf.dispatchFetch>[1],
      );
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: Object.fromEntries(response.headers),
      });
    };
    let saved: LicenseRecord | null = null;
    const store = {
      read: async () => saved,
      write: async (record: LicenseRecord) => {
        saved = structuredClone(record);
      },
    };
    const desktop = new LicenseService(new DayBoardLicenseVerifier(origin, fetchFixture), store, {
      product: { issuer: origin, apiUrl: origin, productId: "prod_RUNTIME", environment: "test" },
      trialDays: 14,
      revalidateIntervalMs: 0,
      offlineGraceDays: 30,
    });
    assert.equal((await desktop.activate(licenseKey, "Disposable runtime Mac")).state, "licensed");
    assert.equal((await desktop.activate(licenseKey, "Disposable runtime Mac")).state, "licensed");
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM activations").first<{ n: number }>())?.n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM licenses").first<{ n: number }>())?.n,
      1,
    );
    refunded = true;
    assert.equal(
      (await signed("charge.refunded", "evt_runtime_refund", "ch_runtime1")).status,
      200,
    );
    assert.equal((await desktop.refresh()).state, "invalid");
    assert.equal(
      (await request("/v1/checkout/claim", "POST", cookies, { orderId: orders[0].orderId })).status,
      409,
    );
    assert.ok(calls > 0);
  } finally {
    await mf.dispose();
  }
});
