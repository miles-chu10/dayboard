# DayBoard website and waitlist deployment

Take the website and its waitlist API live on Cloudflare once the domain is bought, checking each step before the next. getdayboard.com is already live: to ship the waitlist on that deployment, follow [Existing deployment: waitlist rollout](#existing-deployment-waitlist-rollout) and skip the first-time setup in sections 1 to 4.

| Placeholder                   | Meaning                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `<domain>`                    | The bought domain                                       |
| `<site-origin>`               | `https://<domain>`, the website                         |
| `<api-origin>`                | `https://api.<domain>`, the signup Worker               |
| `<database>`                  | Name of the D1 database, for example `dayboard-signups` |
| `op://<vault>/<item>/<field>` | 1Password reference to the `HASH_SECRET` value          |

Origins are exact: `https://` and the host, with no path and no trailing slash. With a trailing slash, `SITE_ORIGIN` makes signups answer `503 signup_unconfigured` and `SERVICE_ORIGIN` makes every signup request answer `403 origin_mismatch`.

Worker, D1 and secret commands run in `billing/`, where `npx wrangler` runs the Wrangler version pinned in `billing/package.json` and reads `billing/wrangler.jsonc`. Site commands and the check script run in the repository root. The root has no Wrangler of its own, so site commands use `npx --prefix billing wrangler`. Each command block starts with a comment naming its directory.

## Existing deployment: waitlist rollout

getdayboard.com and its signup API already run on Cloudflare. This rollout was approved on 2026-10-04 for exactly the target below, in this order: the additive migration `billing/migrations/0004_waitlist_cohort.sql`, then the API Worker, then the site. It creates no account, database, Worker, route or secret, and it doesn't read, generate or change any secret value. A different target, destructive SQL, or any change to invitations or access needs a new approval.

- **Cloudflare account:** `288c34678a2ffdbc2b6873ab377c1e6f`
- **Website:** Worker `dayboard-website` on `https://getdayboard.com`
- **API:** Worker `dayboard-billing` on `https://api.getdayboard.com`. Version `dfd629b0-5eb0-4fb1-b022-864327851dbc` was live before this rollout.
- **Database:** D1 `dayboard`, ID `3fad7bcf-547f-4ea0-b13f-d19369bccd24`, bound as `DB`. Before the rollout it held exactly six reviewed signups, created from `1790225517612` to `1791139887001` (2026-10-04 18:51:27 UTC).
- **Bindings, already set and unchanged:** the secret `HASH_SECRET` (only its name matters here), `SERVICE_ORIGIN`, `SITE_ORIGIN`, and the owner notification's `SIGNUP_EMAIL` and `SIGNUP_NOTIFY_TO`.

`billing/` commands use the deploy checkout's git-ignored `wrangler.jsonc` for `dayboard-billing`, or an explicitly selected equivalent operational config via `--config`. Before running anything, check that its account, Worker, bindings and `database_id` match the existing target above. Use the already-installed Wrangler; do not install tools or provision resources for this rollout. Complete the billing and form tests, typecheck, lint, formatting, build, both deploy dry runs and isolated browser checks before any production write.

### 1. Database

The migration only adds the `cohort` and `classification` columns, with defaults, and labels existing rows. The live Worker keeps working, because its two-column insert takes the defaults. First export the database to a private location outside the repository and website assets, restore it only into a disposable local database, and verify its integrity. Save a private pre-change snapshot of every signup's `rowid`, `email` and `created_at`; compare those exact values after migration, allowing only legitimate new arrivals. Record the live Worker version IDs for code rollback. Never print or publish signup addresses or the backup.

Wrangler tracks applied migration filenames: after 0004 is recorded, another `migrations apply` must be a no-op. Test that tracked behavior locally. Do not rerun the raw `ALTER TABLE` file directly.

```sh
# billing/
npx wrangler d1 time-travel info dayboard           # note the bookmark: the restore point before the change
npx wrangler d1 migrations list dayboard --remote   # only 0004_waitlist_cohort.sql should be unapplied
npx wrangler d1 migrations apply dayboard --remote
```

Then read back, changing nothing:

```sh
# billing/
npx wrangler d1 execute dayboard --remote --command "SELECT cohort, classification, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM beta_signups GROUP BY cohort, classification"
npx wrangler d1 execute dayboard --remote --command "SELECT COUNT(*) AS n FROM beta_signups WHERE email = 'dayboard-verify+notify@example.com'"
```

Expect `early_access` / `reviewed` with `n` 6, `first` 1790225517612 and `last` 1791139887001; anyone who joined after the review as `waitlist` / `unreviewed`; no `likely_test` row; and 0 for the historical test address, which was never a database signup. If anything differs, stop before deploying.

### 2. API Worker

```sh
# billing/
npm run build
npx wrangler deploy --dry-run   # uploads nothing
npx wrangler deploy
```

Verify both routes while the current site is still live, without creating a signup or sending an owner email:

- Send `OPTIONS` with the exact `Origin: https://getdayboard.com` to `/v1/waitlist` and `/v1/beta-signup`; each must answer 204 with the matching CORS origin.
- Submit a malformed email and expect `400 invalid_email`; submit a filled honeypot and expect the generic `200 {"ok":true}` with no stored row.
- Read one existing signup privately from the verified snapshot. Submit that same address once to each route; both must return the identical generic success, with no new row, notification or metadata change. Do not place the address in command-line arguments, logs, screenshots or public output. If no existing row can be verified, stop rather than substituting a new address.
- Keep the total below the shared five-POST-per-minute limit. Read D1 again and compare the original row IDs, emails, timestamps, cohorts and classifications; inspect aggregate counts only in public evidence.

`scripts/verify-website.mjs` creates a synthetic signup, triggers the owner notification and prints a deletion command. Do **not** run it on this production rollout. New-row persistence, rate limiting and notification failures are covered by the disposable local D1 tests. Use a normal browser User-Agent for live checks; if the edge blocks a request, report it without changing security settings.

### 3. Site

```sh
# website-worker/
npx --prefix ../billing wrangler deploy
```

Read the home, waitlist, beta install guide, support and privacy pages and their assets; check the www redirect, 404 handling, security headers, social metadata and the form's configured API URL. Use an isolated browser with all signup calls intercepted to verify rendered success, error, retry and interrupted submissions against the deployed assets. Make no new production signup and run no deletion. Repeat the read-only database comparison from step 1, and record the new API/site version IDs and verified asset hashes. The general synthetic-signup procedure in section 5 does not apply to this rollout.

### Compatibility and rollback

- Pages and scripts cached before the rollout still post to `/v1/beta-signup`. That route shares the waitlist's rows, duplicate check and rate limit, so it can't add a second entry or more attempts.
- Roll back in reverse order, site first: the new site posts to `/v1/waitlist`, which version `dfd629b0-5eb0-4fb1-b022-864327851dbc` doesn't serve. The commands are under [Operate](#operate).
- Keep the migration after a Worker rollback: the earlier Worker's inserts still get `waitlist` / `unreviewed`. Restoring the Time Travel bookmark would also delete every signup made after it, so keep that as a last resort for a damaged table.

### After the cutover

Once these checks pass, D1 is the authoritative waitlist, and the DayBoard Space page becomes a view for reviewing it, refreshed from the read-only queries in `billing/README.md`. Invitations and access stay separate: the approved five-address beta.8 invitation batch, any later invitation and the beta.8 app release gate are neither read from nor written to `cohort` or `classification`, and `early_access` doesn't mean invited. The Space page's historical notification for `dayboard-verify+notify@example.com` stays archival; it was never a database signup.

## Before you start

Decide:

- **Domain:** bought, with its zone active on the Cloudflare account that will hold both Workers. The site's and the signup Worker's custom domain both need the zone on that account.
- **Contact address:** a private address for removal requests. The site publishes it on the privacy, support and beta pages, and the forms stay closed until it's set.
- **Invites:** how you'll send them. The service only stores addresses and, optionally, emails you about each new one; it sends no invitations.

Set up:

- Install the Worker's tools. The shell may export `NODE_ENV=production`, so ask for dev dependencies:

  ```sh
  # repository root
  npm --prefix billing ci --include=dev
  ```

- Sign in to Cloudflare in the browser, then check that `whoami` lists the account that holds the zone:

  ```sh
  # billing/
  npx wrangler login
  npx wrangler whoami
  ```

- Sign in to the 1Password CLI; `op whoami` should show your account.
- In 1Password, create an item holding a new random `HASH_SECRET`: a generated password of at least 32 characters (64 letters and digits is plenty). Create it yourself and never paste it into a file or chat; the commands below read it with `op read`. Keep it for the life of the service: if licensing later runs on this Worker, the same secret keys license and order lookups.

## 1. Deploy the signup Worker

Create the database and note the `database_id` it prints. If a `wrangler.jsonc` already exists, Wrangler offers to add the database to it; answer no.

```sh
# billing/
npx wrangler d1 create <database>
```

Copy the signup-only config. `wrangler.jsonc` is git-ignored.

```sh
# billing/
cp wrangler.signup.example.jsonc wrangler.jsonc
```

Replace every placeholder in `wrangler.jsonc`:

| Placeholder                         | Value                                    |
| ----------------------------------- | ---------------------------------------- |
| `REPLACE_WITH_API_HOSTNAME`         | `api.<domain>`, the host name only       |
| `REPLACE_WITH_D1_NAME`              | `<database>`                             |
| `REPLACE_WITH_D1_DATABASE_ID`       | The `database_id` printed by `d1 create` |
| `REPLACE_WITH_API_HTTPS_ORIGIN`     | `<api-origin>`, used as `SERVICE_ORIGIN` |
| `REPLACE_WITH_WEBSITE_HTTPS_ORIGIN` | `<site-origin>`, used as `SITE_ORIGIN`   |

Check, build, migrate and deploy:

```sh
# billing/
grep -n REPLACE_WITH wrangler.jsonc   # prints nothing once every placeholder is replaced
npm run build
npx wrangler deploy --dry-run         # uploads nothing; lists env.DB, SERVICE_ORIGIN and SITE_ORIGIN
npx wrangler d1 migrations apply <database> --remote
npx wrangler deploy
```

- `migrations apply` applies every file in `billing/migrations/` in order. Signups use `beta_signups` and the `rate_limits` table from `0001_init.sql`; the licensing tables stay empty.
- `deploy` creates the `api.<domain>` DNS record and certificate (a Workers custom domain), so don't add that record yourself. The certificate can take a few minutes. With `workers_dev` and `preview_urls` off, the Worker answers only on `api.<domain>`.
- Until the secret below is set, signups answer `503 signup_unconfigured`. Every other route answers `503 service_unconfigured` for as long as Stripe isn't configured; that's expected.

Set `HASH_SECRET` straight from 1Password:

```sh
# billing/
op read -n "op://<vault>/<item>/<field>" | npx wrangler secret put HASH_SECRET
npx wrangler secret list
```

When its input is a pipe, `wrangler secret put` reads the value from it instead of prompting and drops trailing whitespace, so the secret never shows on screen or in shell history. It takes effect at once. If `op read` printed an error, Wrangler still ran and may have stored an empty value: fix the reference and run the line again. `secret list` shows names only, so it can't tell a wrong value from the right one; section 2's check is the confirmation. If Wrangler stops with "More than one account available", it can't ask which account while reading a pipe: put `CLOUDFLARE_ACCOUNT_ID=<account-id>` in front of `npx` (`npx wrangler whoami` lists the IDs).

## 2. Check the API before the site goes live

```sh
# repository root
node scripts/verify-website.mjs --site <site-origin> --api <api-origin> --skip-pages --database <database>
```

The script checks the waitlist API with a synthetic address (`dayboard-verify+<ms>@example.com`): it signs up through `/v1/waitlist` and repeats the address through the legacy `/v1/beta-signup` alias. It prints a PASS, FAIL or WARN line per check and a summary; any FAIL exits 1. It ends with two D1 commands to run from `billing/`: a readback that should show exactly one `waitlist` / `unreviewed` row, the synthetic address, and no honeypot row, then the `DELETE` for that row. Each run sends four of the five signup attempts a network gets per minute, counted across both routes, so wait a minute before running it again.

If a check fails:

| Answer                    | Usual cause                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `403 origin_mismatch`     | `SERVICE_ORIGIN` isn't exactly `<api-origin>`                                                          |
| `503 signup_unconfigured` | `SITE_ORIGIN` isn't exactly `<site-origin>`, or `HASH_SECRET` is missing or shorter than 32 characters |
| `403 origin_not_allowed`  | The request's `Origin` isn't `SITE_ORIGIN`. Opening the endpoint in a browser tab always gets this     |
| `503 service_unavailable` | A database error, usually migrations that weren't applied                                              |
| TLS or connection errors  | The custom domain's certificate isn't ready yet; wait a few minutes                                    |

## 3. Configure the site

Make these edits in `website/`, then preview the site (see `website/README.md`). The preview's form can't sign up, since the service accepts only `<site-origin>`.

- In `assets/site.js`, set both values. The forms open only when both are set.

  ```js
  const SITE_CONFIG = Object.freeze({
    waitlistUrl: "https://api.<domain>/v1/waitlist",
    contactEmail: "<private address for removal requests>",
  });
  ```

- Make every `og:image` absolute, `https://<domain>/assets/screens/light-agenda.png`, so link previews work without the old public-beta claim. `rg -n og:image website/*.html` lists them.
- If you want canonical links, add `<link rel="canonical">` to each page with the address the site serves: `<site-origin>/`, `<site-origin>/waitlist`, `<site-origin>/beta`, `<site-origin>/privacy` and so on. Pages redirects `/page.html` to `/page`.
- Add `Sitemap: <site-origin>/sitemap.xml` to `robots.txt` only if you also add a `sitemap.xml`.
- `_headers` needs no change for the API: its Content-Security-Policy's `connect-src` allows any HTTPS origin.
- If you changed a page's inline `<script>`, recompute the hashes and update the `script-src` of the Content-Security-Policy in `_headers`:

  ```sh
  # repository root
  node -e 'const c=require("crypto"),fs=require("fs");for(const f of process.argv.slice(1)){const m=fs.readFileSync(f,"utf8").match(/<script>([\s\S]*?)<\/script>/);console.log(f,"sha256-"+c.createHash("sha256").update(m[1]).digest("base64"))}' website/*.html
  ```

Commit these edits so the repository matches the live site.

## 4. Deploy the site

The site is a Worker with static assets (Cloudflare now steers new static sites to Workers instead of Pages). `website-worker/wrangler.jsonc` serves `website/`, applies `_headers`, answers unknown paths with `404.html` and status 404, and routes `<domain>` and `www.<domain>` as custom domains. `website-worker/worker.js` redirects `http://` and `www.` requests to `<site-origin>` with 301, keeping the path and query. Set the two custom-domain patterns in `website-worker/wrangler.jsonc` to `<domain>` and `www.<domain>`, then:

```sh
# website-worker/, each time you publish
npx --prefix ../billing wrangler deploy
```

With the zone on the same account, Cloudflare creates the DNS records and certificates for both hostnames. The deploy publishes every file in `website/` except `.DS_Store`, and only when you run the command.

## 5. Verify the live site

```sh
# repository root
node scripts/verify-website.mjs --site <site-origin> --api <api-origin> --www --rate-limit --database <database>
```

This adds checks of the pages, security headers, 404 page, HTTPS and www redirects and `SITE_CONFIG`, and a rate-limit check that sends invalid attempts until the service answers 429. That blocks your network for about a minute.

Then wait a minute, open `<site-origin>/` in Safari, and join with an address you control; the form should say "You're on the waitlist." Read back the newest rows:

```sh
# billing/
npx wrangler d1 execute <database> --remote --command "SELECT email, cohort, classification, datetime(created_at / 1000, 'unixepoch') AS joined FROM beta_signups ORDER BY created_at DESC LIMIT 5"
```

Expect the script's synthetic address and your Safari address, both `waitlist` / `unreviewed`. Delete the synthetic row with the `DELETE` the script printed, and your test row with:

```sh
# billing/
npx wrangler d1 execute <database> --remote --command "DELETE FROM beta_signups WHERE email = '<your test address>'"
```

## Operate

- **Review the list or remove an address:** use the commands under "Waitlist signups" in `billing/README.md`, run from `billing/`.
- **Close signups fast:**

  ```sh
  # billing/
  npx wrangler secret delete HASH_SECRET
  ```

  From then on the endpoint answers `503 signup_unconfigured` and stores nothing, and the form says it couldn't reach the signup service. For the "The waitlist opens soon" message instead, also set `waitlistUrl` to `""` and redeploy the site (section 4); that alone closes only the form, because scripts can still post to the endpoint. To reopen, pipe the same 1Password value into `secret put` again. Delete the secret only while the Worker is signup-only: with licensing on, `HASH_SECRET` also keys license lookups.

- **Roll back the Worker:** once the site posts to `/v1/waitlist`, roll the site back first, because Worker versions from before the waitlist serve only `/v1/beta-signup`. From `billing/`, `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. Without an ID it picks the version of the previous deployment. `secret put` and `secret delete` each create a deployment too, so right after one of them a plain `rollback` undoes that secret change; Wrangler warns when the secrets differ. A rollback doesn't touch D1. After any rollback, rerun the section 2 check. If it answers `503 signup_unconfigured`, the version you rolled back to predates `HASH_SECRET`: roll back again to a version deployed after the secret was set. Piping the secret in again won't work while an older version is live, because `secret put` refuses to run then.
- **Roll back the site:** from `website-worker/`, `npx --prefix ../billing wrangler deployments list`, then `npx --prefix ../billing wrangler rollback <version-id>`.
- **Costs:** Static asset requests are free; the site Worker runs first on each request to handle redirects, which counts toward Workers Free. Workers Free covers 100,000 requests a day per account, and D1 has a free tier. The domain is the only fixed cost.

## After go-live: Google verification

1. In Google Search Console, add `<domain>` as a Domain property and verify it with the TXT record Search Console gives you (add it to the zone's DNS). Use an account that's Owner or Editor on the Google Cloud project.
2. On the OAuth consent screen's Branding page, add `<domain>` to the authorized domains, and use `<site-origin>/` as the homepage and `<site-origin>/privacy.html` as the privacy policy URL. Pages redirects the latter to `<site-origin>/privacy`.

The full verification plan, including the demo video, is in `docs/launch/google-verification.md`.
