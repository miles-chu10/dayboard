# DayBoard billing service

This is a separate TypeScript Cloudflare Worker with D1 storage. It issues one-time DayBoard licenses after verified Stripe Checkout payments, and complimentary licenses the owner issues through an admin route ([below](#complimentary-licenses)). It shares only the version 1 license request/response contract in `../shared/license-contract.ts` with the desktop app. The service runs no analytics, and its only email is the optional owner notification about new waitlist signups.

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

## Waitlist signups

`POST /v1/waitlist` stores addresses from the website's waitlist forms in the `beta_signups` table, which keeps its original internal name (`migrations/0002_beta_signups.sql` and `migrations/0004_waitlist_cohort.sql`). `POST /v1/beta-signup` is a legacy alias for pages cached before the rename: the same handler, rows, duplicate check and rate-limit bucket, so it can't create a second entry or double anyone's attempts. Signups work before any Stripe setup. They need only the D1 binding, `SERVICE_ORIGIN`, `HASH_SECRET`, and `SITE_ORIGIN`: the website's exact HTTPS origin. Browsers can call the endpoints only from that origin (CORS). If the binding, `HASH_SECRET` or `SITE_ORIGIN` is missing, they answer `503 signup_unconfigured`; a request addressed to any origin other than `SERVICE_ORIGIN` gets `403 origin_mismatch`.

- The request body is `{"email": "...", "company": ""}` as JSON, 1 KB at most. Addresses are trimmed and lowercased. Plus addressing is kept, so `name+tag@` and `name@` are separate entries. Older clients may leave out `company`, but when it's present it must be a string.
- New and already-listed addresses get the same `200 {"ok": true}`, so the form can't reveal who signed up. A filled `company` field (hidden from people) is treated as a bot: it gets the same answer and nothing is stored.
- Invalid addresses get `400 invalid_email`, and malformed bodies `400 invalid_body`. More than five attempts per minute from one IP address, counted across both routes, get `429 rate_limited`.
- `{"ok": true}` is sent only after D1 confirms the write. A database failure, including a result that doesn't confirm the write, gets `503 service_unavailable` with the CORS header, so the page can offer a retry. Failures are logged with a generic message only, never the address or the raw error.
- Each row holds `email`, `created_at`, `cohort` and `classification`. The service writes only the address and time, so every new row is `waitlist` / `unreviewed`, whatever the request contains. Migration 0004 labeled the reviewed first cohort, the rows created at or before `1791139887001` (2026-10-04 18:51:27 UTC), as `early_access` / `reviewed`. It labels the reserved test address `dayboard-verify+notify@example.com` as `likely_test` wherever a database holds it, and never inserts it. None of these values records an invitation, an access grant or proof that someone owns the address.
- Migration 0005 adds `email_suppressions`, for addresses that asked not to be emailed, and two views that leave them out: `dayboard_mailing_recipients` (one row per address that isn't `likely_test` or suppressed) and `waitlist_signups` (the list newest first, with the signup time in UTC and its age). A suppression stores the address trimmed and lowercased, the request and recording times, the reason `unsubscribe` and a reference to where the request came from. The Worker never reads or writes it.
- With the optional `SIGNUP_EMAIL` binding and `SIGNUP_NOTIFY_TO` (an address verified in the zone's Email Routing), it emails that address once per new row from `signups@<site host>`, with the subject "New DayBoard waitlist signup". The email goes out after the reply, so new and listed addresses answer equally fast. Duplicates and hidden-field submissions send nothing, and a failed email neither fails nor repeats the signup.

These protections have limits. CORS keeps other websites' pages out, but scripts can send any `Origin` header. The rate limit counts per IP address, so someone with many addresses (an IPv6 range, for example) gets more attempts, and the hidden field stops only simple bots. There's no CAPTCHA, and nothing confirms that an address belongs to the person who entered it. Add Cloudflare edge rules if abuse appears.

For a signup-only deployment, start from `wrangler.signup.example.jsonc` (copy it to the git-ignored `wrangler.jsonc`) and follow `docs/launch/website-deploy.md`. The live service follows that document's "Existing deployment: waitlist rollout" section.

From `billing/`, review the list without test rows or count it by cohort:

```sh
npx wrangler d1 execute <database> --remote --command "SELECT email, cohort, classification, datetime(created_at / 1000, 'unixepoch') AS joined FROM beta_signups WHERE classification <> 'likely_test' ORDER BY created_at"
npx wrangler d1 execute <database> --remote --command "SELECT cohort, classification, COUNT(*) AS n FROM beta_signups GROUP BY cohort, classification"
```

For a verified removal request, use an authorized D1 query client against the intended account and database. This repository does not provide a removal CLI. Normalize the requester input with `normalizeEmail` from `src/beta.ts` and reject invalid input. Never interpolate an address into SQL or shell command text. Construct each JSON request body with a serializer, such as `JSON.stringify({ sql, params: [email] })`, keeping the query constant and the address in `params`.

For example, `o'hara@example.com` stays a single bound value. First count the matching rows:

```json
{
  "sql": "SELECT COUNT(*) AS n FROM beta_signups WHERE email = ?1",
  "params": ["o'hara@example.com"]
}
```

Require a successful API response and successful query result. If the count is zero, stop: the address is already absent. Otherwise require exactly one matching row before submitting the removal body:

```json
{
  "sql": "DELETE FROM beta_signups WHERE email = ?1",
  "params": ["o'hara@example.com"]
}
```

Require a successful result with exactly one changed row (`meta.changes === 1`). Repeat the same bound count query and require zero remaining matches. Stop and investigate any unexpected count or unsuccessful result. Keep addresses and credentials out of logs. See the [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) for the `sql` and `params` contract.

## Configuration required before launch

Copy `wrangler.example.jsonc` to `wrangler.jsonc` (git-ignored) in the intended deploy checkout and replace every placeholder. Do not use the example as a live configuration. The example enables Workers tracing at 5% head sampling (`observability.traces.head_sampling_rate: 0.05`); per Cloudflare's span attribute list, traces record full request and subrequest URLs (checkout order IDs, Stripe object IDs) and D1 SQL text (placeholders only, since every query uses bound parameters), but not `Authorization` headers or request/response bodies, so Stripe keys and license keys stay out of traces. These are public, server-side Worker variables:

| Variable           | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `SERVICE_ORIGIN`   | Exact HTTPS origin of this Worker, with no path, query, or trailing slash |
| `PRODUCT_ID`       | Single allowlisted Stripe product ID (`prod_…`)                           |
| `PRICE_ID`         | Single active, one-time Stripe price ID (`price_…`)                       |
| `PRICE_CURRENCY`   | Lowercase three-letter currency of that price                             |
| `ENVIRONMENT`      | `test` or `live`; must match the Stripe secret and all Stripe objects     |
| `ACTIVATION_LIMIT` | Merchant-chosen decimal device cap, 1–99                                  |
| `SITE_ORIGIN`      | Exact HTTPS origin of the website allowed to post waitlist signups        |

The buy and receipt pages link to `/pricing` and `/refund` on `SITE_ORIGIN` (on `https://getdayboard.com` when it isn't set) and show `ACTIVATION_LIMIT` as the Mac cap. The price and refund copy ($5 once, 14 days) and the support address `support@getdayboard.com` are fixed text in `src/pages.ts`; change them there if the policy changes.

These are **server secrets**, never public Worker variables, build constants, repository files, or `.env` files:

| Secret                  | Meaning                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe restricted/server key for the selected test or live account; must begin with matching `sk_test_`/`sk_live_` or preferred restricted `rk_test_`/`rk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint, beginning with `whsec_`                                                                                                        |
| `ENCRYPTION_KEY`        | 32 random bytes encoded as unpadded base64url; retain for the life of issued licenses                                                                            |
| `HASH_SECRET`           | At least 32 characters of independent random secret material; retain for key and order lookups                                                                   |
| `ADMIN_TOKEN`           | Optional. At least 32 random characters, unique to this Worker; enables the complimentary-license admin routes. Unset, they answer `503`                         |

The service fails closed with `503 service_unconfigured` if the required binding, price, mode, cap, database, or secrets are missing. A public desktop build must use this **same** origin, product ID, and test/live environment. There are no merchant IDs in the repository.

Checkout uses **Stripe Managed Payments** (`managed_payments: { enabled: true }`): Stripe, via Link, is merchant of record and calculates, collects and remits sales tax, VAT and GST. Managed Payments must be activated in the Stripe Dashboard before Checkout Sessions can be created, and the Product needs an eligible tax code (`txcd_10202000`, downloadable software for personal use). Set the Price's tax behavior to inclusive so the buyer pays the listed price. Managed Payments turns on Adaptive Pricing, so a buyer can pay in a local currency; fulfillment checks that the line item's Price matches the configured price and currency, and that the PaymentIntent was paid in full in the session's currency. Managed Payments does not support `automatic_tax` or `payment_method_types`, and Checkout sets neither. Before launch, confirm in test mode that `charge.refunded` and `charge.dispute.created` still reach this endpoint for Managed Payments charges; Stripe's Managed Payments docs list only the `checkout.session.*` events.

Launch policy (Miles, 2026-11-04): DayBoard Pro is $5 once and unlocks AI only; `ACTIVATION_LIMIT` is `3`; refunds within 14 days, no questions asked, from the Stripe Dashboard. A full refund or any dispute revokes the license. A won dispute does not restore access automatically.

## Setup and deployment procedure (not performed here)

1. In the approved Stripe account, create exactly one active one-time Product/Price pair; record its product ID, price ID, currency, and test/live mode. Inspect the price and supported payment methods. Choose the activation cap and support process.
2. In the approved Cloudflare account, create a D1 database and configure a dedicated HTTPS route. Replace the placeholders in the copied Wrangler config. Provide the four secrets through an approved secret manager and Wrangler's secret binding flow. Keep `ENCRYPTION_KEY` and `HASH_SECRET` independently backed up; rotating either without a migration loses claim or validation ability.
3. Build, then apply the migrations in `migrations/` using `wrangler d1 migrations apply <configured database name> --remote`. Deploy with `wrangler deploy`. The Worker should be the sole writer to the D1 database; preserve schema and issued keys on rollback.
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

## Complimentary licenses

Complimentary ("comp") keys unlock DayBoard Pro without a payment, for example for beta testers. They're minted, hashed and encrypted like paid keys and bound to the same `SERVICE_ORIGIN`, `PRODUCT_ID` and `ENVIRONMENT`. The app's validate, activate and deactivate calls treat them exactly like paid keys, `ACTIVATION_LIMIT` included. Issuing and revoking make no Stripe call.

**Issue beta testers' keys from the production (live) Worker.** A key exists only in the D1 database of the Worker that issued it and works only with that Worker's origin, product and environment. Shipped builds use the live environment and the production origin, so a key from the test Worker answers `invalid_license` there: test-Worker keys are for testing only. The production Worker's admin routes work only once production has the full live licensing configuration (live Stripe secrets, product and price), which is also what opens `/buy` and checkout on the production origin. Until then they answer `503 service_unconfigured`.

Setup, from Miles's Mac (not performed here):

1. Back up D1, then apply `migrations/0006_comp_licenses.sql` with `npx wrangler d1 migrations apply <database> --remote`. It only adds the `comp_licenses` table and changes no existing row. Apply it before deploying this code: until then, issuing fails with `503` and nothing is written.
2. Generate a token of at least 32 characters (for example `openssl rand -base64 48`), save it in 1Password, and set it with `npx wrangler secret put ADMIN_TOKEN`. Use a different token for the test and production Workers.

Without `ADMIN_TOKEN`, or with a shorter one, every `/v1/admin/` request answers `503 admin_unconfigured`, so a deployment stays closed until the secret is set. The routes also need the full licensing configuration: a waitlist-only deployment answers `503 service_unconfigured`.

Every admin request needs `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time. A wrong or missing token gets `401 unauthorized`. Two per-minute limits apply to each client address, both counted before the token is compared, each in one atomic D1 statement, so they hold for parallel requests too:

- At most 120 admin requests a minute, enough for a 50-key run plus `list`. Further requests get `429 rate_limited`.
- At most five failed attempts a minute. Each request reserves one of five failure slots and gives it back only if its token matches. Once all five are taken, every admin request from that address, even a correct one, gets `429 rate_limited` until the next minute. A burst of parallel wrong tokens therefore gets at most five `401`s. More than five correct requests in flight at once can also get `429`; the script sends one request at a time.

Nothing logs the token, a key or a request body.

| Request                               | Body                           | Result                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/admin/comp-licenses`        | `{ "label": "beta tester 7" }` | `201 { licenseId, licenseKey, label, createdAt, meta }`. The key appears only in this response                                                                                                      |
| `GET /v1/admin/comp-licenses`         | none                           | `{ licenses: [{ licenseId, label, environment, createdAt, revokedAt, activations }], truncated }`, newest first, without keys. At most 1,000 rows; `truncated: true` means older ones were left out |
| `POST /v1/admin/comp-licenses/revoke` | `{ "licenseId": "..." }`       | `200 { licenseId, revoked: true, revokedAt }`. Repeating it changes nothing. Unknown IDs and paid licenses get `404 not_found`                                                                      |

A label is 1–64 characters without `@`: a note such as `beta tester 7`, never an email address. Keep who received which key in 1Password, not in D1.

`scripts/comp-license.mjs` calls these routes. It reads the token from `DAYBOARD_ADMIN_TOKEN` and the service origin from `--origin` or `DAYBOARD_BILLING_ORIGIN`. Run it through 1Password so the token stays out of shell history and files; without `op run`, the script refuses an `op://` reference instead of sending it. `issue` requires `--environment test` or `--environment live`, naming the environment of the Worker at the origin. For beta testers that is the production Worker:

```sh
export DAYBOARD_ADMIN_TOKEN="op://<vault>/<item>/credential" # a 1Password reference, not the token
export DAYBOARD_BILLING_ORIGIN="https://api.getdayboard.com" # production; the test Worker is for trying it out
op run -- node billing/scripts/comp-license.mjs issue --environment live --count 5 "beta tester" # beta tester 1 to 5
op run -- node billing/scripts/comp-license.mjs issue --environment live "beta tester 6" "beta tester 7"
op run -- node billing/scripts/comp-license.mjs list
op run -- node billing/scripts/comp-license.mjs revoke <licenseId>
```

`issue` appends each key as a JSON line (license ID, label, key, time, issuer, product, environment) to `billing/comp-licenses.local.jsonl`, created with mode 600, and prints only license IDs and labels. `--out` picks another file, which must end in `.local.jsonl`; git ignores `*.local.jsonl`. A run issues at most 50 keys. If the Worker answers with a key from another environment than `--environment`, the script doesn't save it, revokes it and stops. Send each key to its tester privately, keep it in 1Password if you'll need it again, and delete the file. If a run stops on a network error, a `5xx`, or a success response the script can't read, a key may have been issued without being saved: run `list` and revoke any ID that isn't in the file. `list` shows the newest keys first and warns when it stops at 1,000.

Revoking sets the comp license's payment tombstone, the same flag a full refund sets, so the app's next validation reports the key as revoked and it can't activate another Mac. Revocation is permanent: issue a new key to restore access. Paid licenses can't be revoked through this route; refunds and disputes in Stripe do that.

What is stored: each comp license is an ordinary `licenses` row (the key's HMAC and AES-GCM ciphertext, never the plaintext), and a `comp_licenses` row with the label and the issue and revocation times. No email address or other tester identity is stored. Because `licenses.order_id` and `licenses.payment_intent_id` are `NOT NULL` foreign keys, and rebuilding `licenses` would risk issued keys, each comp license also gets a placeholder `orders` row and `payments` row with the ID `comp_<licenseId>`. The placeholder order expired at time zero and can't be claimed, its ID doesn't fit the checkout routes, and no Stripe ID starts with `comp_`. Leave comp licenses out of sales counts, for example `SELECT COUNT(*) FROM licenses WHERE id NOT IN (SELECT license_id FROM comp_licenses)`.

## Durable states and recovery

A signed webhook is only an input. Before minting, the service retrieves the current Checkout Session, PaymentIntent, and line items and checks test/live mode, paid state, amount, currency, exact product and price, and quantity one. A D1 transaction persists payment ownership, one encrypted key bound to the issuing origin/product/environment, order state, and event deduplication. Retries return the original key. Full refunds and disputes create permanent payment tombstones even if they arrive before the paid webhook. Later paid events cannot restore access. Partial refunds currently retain access; dispute reversal does **not** automatically regrant. Confirm this policy before launch. An unpaid `checkout.session.completed` is durably acknowledged as pending; only subsequent verified asynchronous success can issue a key. Failed asynchronous payment stays unentitled. Manual regrant requires a separately reviewed process and database audit trail.

For a customer who has lost the order cookie and key:

1. Ask for their Stripe receipt and a purchase identifier through the approved support channel. Do not ask for card numbers or a license key in public messages.
2. An authorized operator verifies the payment in the correct Stripe account and mode, confirms the exact product/price and the matching D1 order/payment record, and checks that the payment has no refund or dispute tombstone.
3. With approved access to D1 and `ENCRYPTION_KEY`, recover the **existing** encrypted license key for that order. Deliver it through the verified customer's approved private channel. Do not mint another license, expose it in a URL/log, or send it from an unconfigured email integration. Audit the support action without storing the plaintext key.

The database retains order capability hashes for seven-day browser claims and encrypted licenses/payment tombstones for purchase support and revocation. Set a data retention policy before launch; do not delete tombstones or active license material while official builds depend on them. Back up D1 and both crypto secrets before schema changes. No production data exists in this checkout.
