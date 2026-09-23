# DayBoard billing service

This is a separate TypeScript Cloudflare Worker with D1 storage. It issues one-time DayBoard licenses after verified Stripe Checkout payments. It shares only the version 1 license request/response contract in `../shared/license-contract.ts` with the desktop app. The service does not send email or run analytics.

## Local verification

From the repository root:

```sh
npm --prefix billing ci --include=dev
npm --prefix billing run typecheck
npm --prefix billing test
npm --prefix billing run build
```

Tests call a fake Stripe transport with the **real Stripe SDK webhook verifier** and execute the actual migration SQL in a disposable, in-memory SQLite database. They never call Stripe, Cloudflare, or any customer account. `dist/` is generated and ignored. The tests do not replace a Stripe sandbox purchase and refund exercise or a deployed D1 smoke test.

`test/runtime.test.ts` also runs the built Worker in local workerd/Miniflare with its real D1 binding. All outbound requests are intercepted. It tests Stripe SDK requests and signature verification, concurrent per-order delivery, the actual desktop verifier/state machine, and refund invalidation. This local runtime check does not prove a deployed route or real payment.

For a visual-only preview, run `node --import tsx scripts/preview-billing.mjs` from the repository root. Its page banner identifies a disposable UI fixture; it never contacts Stripe or opens account/license storage. The real payment and authorization behavior is exercised separately by the tests above.

## Configuration required before launch

Copy `wrangler.example.jsonc` to `wrangler.jsonc` in the intended deploy checkout and replace every placeholder. Do not use the example as a live configuration. These are public, server-side Worker variables:

| Variable           | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `SERVICE_ORIGIN`   | Exact HTTPS origin of this Worker, with no path, query, or trailing slash |
| `PRODUCT_ID`       | Single allowlisted Stripe product ID (`prod_…`)                           |
| `PRICE_ID`         | Single active, one-time Stripe price ID (`price_…`)                       |
| `PRICE_CURRENCY`   | Lowercase three-letter currency of that price                             |
| `ENVIRONMENT`      | `test` or `live`; must match the Stripe secret and all Stripe objects     |
| `ACTIVATION_LIMIT` | Merchant-chosen decimal device cap, 1–99                                  |

These are **server secrets**, never public Worker variables, build constants, repository files, or `.env` files:

| Secret                  | Meaning                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe restricted/server key for the selected test or live account; must begin with matching `sk_test_`/`sk_live_` or preferred restricted `rk_test_`/`rk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint, beginning with `whsec_`                                                                                                        |
| `ENCRYPTION_KEY`        | 32 random bytes encoded as unpadded base64url; retain for the life of issued licenses                                                                            |
| `HASH_SECRET`           | At least 32 characters of independent random secret material; retain for key and order lookups                                                                   |

The service fails closed with `503 service_unconfigured` if the required binding, price, mode, cap, database, or secrets are missing. A public desktop build must use this **same** origin, product ID, and test/live environment. There are no merchant IDs in the repository.

The intended operator must also decide the price, support address/process, refund policy, tax treatment, and legal merchant operating model. This service uses standard Stripe Checkout. It does not assert merchant-of-record status and does not turn on `automatic_tax` by default. Checkout leaves payment methods to Stripe's Dashboard settings; it does not set `payment_method_types`.

## Setup and deployment procedure (not performed here)

1. In the approved Stripe account, create exactly one active one-time Product/Price pair; record its product ID, price ID, currency, and test/live mode. Inspect the price and supported payment methods. Choose the activation cap and support process.
2. In the approved Cloudflare account, create a D1 database and configure a dedicated HTTPS route. Replace the placeholders in the copied Wrangler config. Provide the four secrets through an approved secret manager and Wrangler's secret binding flow. Keep `ENCRYPTION_KEY` and `HASH_SECRET` independently backed up; rotating either without a migration loses claim or validation ability.
3. Build, then apply `migrations/0001_init.sql` using `wrangler d1 migrations apply <configured database name> --remote`. Deploy with `wrangler deploy`. The Worker should be the sole writer to the D1 database; preserve schema and issued keys on rollback.
4. Register a **snapshot** Stripe webhook at `https://<service-origin>/v1/stripe/webhook`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, and `charge.dispute.created`. Set its signing secret on the Worker. Stripe API errors and database failures return non-2xx so Stripe can retry. Monitor failed deliveries.
5. In Stripe **test mode**, make a real sandbox checkout; verify the receipt claim, repeat claim, desktop validation/activation/deactivation, duplicate webhook, refund, dispute, and persisted D1 readback. Exercise the actual deployed pages at desktop and mobile sizes. Only after those checks and approved tax/support policy should the live route and live product be configured.

The Worker never accepts a Checkout Session ID as claim authorization. Each `GET /buy` creates a fresh random, nonsecret 32-character base64url `orderId`, renders it in `data-order-id`, and sets `__Host-dayboard-order-<orderId>=<opaque 256-bit token>` with Secure, HttpOnly, SameSite=Lax, and Path=/ attributes. Multiple tabs therefore retain separate cookies. The token is stored only as an HMAC hash in D1; it expires after seven days. Closing or changing the browser may remove access, so the receipt page says to save the key. The Stripe success URL is `/receipt?order=<orderId>` and the cancel URL is `/buy`; neither contains a license key or capability.

Exact checkout HTTP shapes:

| Request                                   | Body/query                                   | Authorization and result                                                                                                                                |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /buy`                                | none                                         | Sets the per-order cookie and returns the purchase page; no Stripe Session yet                                                                          |
| `POST /v1/checkout`                       | JSON `{ "orderId": "<32 base64url chars>" }` | Exact Origin plus matching per-order cookie; creates/reuses that order and Stripe Session. Retrying after a lost response returns the same Session URL. |
| `GET /v1/checkout/status?order=<orderId>` | query                                        | Matching per-order cookie; returns `{ "state": "pending"                                                                                                | "ready" | "failed" | "revoked" }` |
| `POST /v1/checkout/claim`                 | JSON `{ "orderId": "<32 base64url chars>" }` | Exact Origin plus matching per-order cookie; only a paid, unrevoked order returns `{ "licenseKey": "DAYB_..." }`                                        |

The ID selects an order but grants no authority by itself. Failed or expired receipts offer `/buy` to create a new order while retaining access to the older receipt until its cookie expires. Public license requests and checkout routes are size- and rate-limited using HMAC-hashed IP buckets, without raw IP or key logging. Configure Cloudflare's edge abuse controls for launch traffic.

## Durable states and recovery

A signed webhook is only an input. Before minting, the service retrieves the current Checkout Session, PaymentIntent, and line items and checks test/live mode, paid state, amount, currency, exact product and price, and quantity one. A D1 transaction persists payment ownership, one encrypted key bound to the issuing origin/product/environment, order state, and event deduplication. Retries return the original key. Full refunds and disputes create permanent payment tombstones even if they arrive before the paid webhook. Later paid events cannot restore access. Partial refunds currently retain access; dispute reversal does **not** automatically regrant. Confirm this policy before launch. An unpaid `checkout.session.completed` is durably acknowledged as pending; only subsequent verified asynchronous success can issue a key. Failed asynchronous payment stays unentitled. Manual regrant requires a separately reviewed process and database audit trail.

For a customer who has lost the order cookie and key:

1. Ask for their Stripe receipt and a purchase identifier through the approved support channel. Do not ask for card numbers or a license key in public messages.
2. An authorized operator verifies the payment in the correct Stripe account and mode, confirms the exact product/price and the matching D1 order/payment record, and checks that the payment has no refund or dispute tombstone.
3. With approved access to D1 and `ENCRYPTION_KEY`, recover the **existing** encrypted license key for that order. Deliver it through the verified customer's approved private channel. Do not mint another license, expose it in a URL/log, or send it from an unconfigured email integration. Audit the support action without storing the plaintext key.

The database retains order capability hashes for seven-day browser claims and encrypted licenses/payment tombstones for purchase support and revocation. Set a data retention policy before launch; do not delete tombstones or active license material while official builds depend on them. Back up D1 and both crypto secrets before schema changes. No production data exists in this checkout.
