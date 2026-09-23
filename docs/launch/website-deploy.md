# DayBoard website and signup deployment

Take the beta website and its signup API live on Cloudflare once the domain is bought, checking each step before the next.

| Placeholder                   | Meaning                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `<domain>`                    | The bought domain                                       |
| `<site-origin>`               | `https://<domain>`, the website                         |
| `<api-origin>`                | `https://api.<domain>`, the signup Worker               |
| `<database>`                  | Name of the D1 database, for example `dayboard-signups` |
| `<pages-project>`             | Name of the Pages project, for example `dayboard`       |
| `op://<vault>/<item>/<field>` | 1Password reference to the `HASH_SECRET` value          |

Origins are exact: `https://` and the host, with no path and no trailing slash. With a trailing slash, `SITE_ORIGIN` makes signups answer `503 signup_unconfigured` and `SERVICE_ORIGIN` makes every signup request answer `403 origin_mismatch`.

Worker, D1 and secret commands run in `billing/`, where `npx wrangler` runs the Wrangler version pinned in `billing/package.json` and reads `billing/wrangler.jsonc`. Site commands and the check script run in the repository root. The root has no Wrangler of its own, so site commands use `npx --prefix billing wrangler`. Each command block starts with a comment naming its directory.

## Before you start

Decide:

- **Domain:** bought, with its zone active on the Cloudflare account that will hold the Pages project and the Worker. The apex custom domain for Pages and the Worker's custom domain both need the zone on that account.
- **Contact address:** a private address for removal requests. The site publishes it on the privacy, support and beta pages, and the forms stay closed until it's set.
- **Invites:** how you'll send them. The service only stores addresses; it sends no email.

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

The script checks the signup API with a synthetic address (`dayboard-verify+<ms>@example.com`) and prints a PASS, FAIL or WARN line per check and a summary; any FAIL exits 1. It ends with two D1 commands to run from `billing/`: a readback that should show exactly one row, the synthetic address, and no honeypot row, then the `DELETE` for that row. Each run sends four of the five signup attempts a network gets per minute, so wait a minute before running it again.

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
    betaSignupUrl: "https://api.<domain>/v1/beta-signup",
    contactEmail: "<private address for removal requests>",
  });
  ```

- Make every `og:image` absolute, `https://<domain>/assets/og-image.png`, so link previews work. `grep -n og:image website/*.html` lists them.
- If you want canonical links, add `<link rel="canonical">` to each page with the address Pages serves: `<site-origin>/`, `<site-origin>/beta`, `<site-origin>/privacy` and so on. Pages redirects `/page.html` to `/page`.
- Add `Sitemap: <site-origin>/sitemap.xml` to `robots.txt` only if you also add a `sitemap.xml`.
- `_headers` needs no change for the API: its Content-Security-Policy's `connect-src` allows any HTTPS origin.
- If you changed a page's inline `<script>`, recompute the hashes and update the `script-src` of the Content-Security-Policy in `_headers`:

  ```sh
  # repository root
  node -e 'const c=require("crypto"),fs=require("fs");for(const f of process.argv.slice(1)){const m=fs.readFileSync(f,"utf8").match(/<script>([\s\S]*?)<\/script>/);console.log(f,"sha256-"+c.createHash("sha256").update(m[1]).digest("base64"))}' website/*.html
  ```

Commit these edits so the repository matches the live site.

## 4. Deploy the site with direct upload

```sh
# repository root, once
npx --prefix billing wrangler pages project create <pages-project> --production-branch main

# repository root, each time you publish
npx --prefix billing wrangler pages deploy website --project-name <pages-project> --branch main
```

Direct upload publishes every file in `website/` on this Mac except `.DS_Store` files, and only when you run the command. That includes `README.md` and `LICENSE.txt`: `license.html` links the license, and the README says nothing the public repository doesn't. The alternative is Git integration: create the project by connecting the GitHub repository in the dashboard (build output directory `website`, no build command) instead of running `pages project create`; then every merge to `main` publishes the site. The deploy prints a `*.pages.dev` address; the pages load there, but the signup form works only on `<site-origin>`.

Then, in the Cloudflare dashboard:

1. **Workers & Pages → `<pages-project>` → Custom domains:** add `<domain>`, then `www.<domain>`. Do this before creating any DNS records for them. With the zone on the same account, Cloudflare adds the records itself; a CNAME made by hand first can leave the domain answering 522. Wait until both show Active.
2. **The `<domain>` zone's Rules:** create a redirect rule that sends `www.<domain>` to the apex with 301, keeping the path and query: wildcard pattern, request URL `https://www.<domain>/*`, target URL `https://<domain>/${1}`, status code 301, Preserve query string on. The signup form works only on `<site-origin>`, so www visitors must land there.

## 5. Verify the live site

```sh
# repository root
node scripts/verify-website.mjs --site <site-origin> --api <api-origin> --www --rate-limit --database <database>
```

This adds checks of the pages, security headers, 404 page, HTTPS and www redirects and `SITE_CONFIG`, and a rate-limit check that sends invalid attempts until the service answers 429. That blocks your network for about a minute. If "http redirects to https" fails, turn on Always Use HTTPS for the zone (SSL/TLS → Edge Certificates).

Then wait a minute, open `<site-origin>/` in Safari, and join with an address you control; the form should say "You're on the list." Read back the newest rows:

```sh
# billing/
npx wrangler d1 execute <database> --remote --command "SELECT email, datetime(created_at / 1000, 'unixepoch') AS joined FROM beta_signups ORDER BY created_at DESC LIMIT 5"
```

Expect the script's synthetic address and your Safari address. Delete the synthetic row with the `DELETE` the script printed, and your test row with:

```sh
# billing/
npx wrangler d1 execute <database> --remote --command "DELETE FROM beta_signups WHERE email = '<your test address>'"
```

## Operate

- **Export the list or remove an address:** use the commands under "Beta signups" in `billing/README.md`, run from `billing/`.
- **Close signups fast:**

  ```sh
  # billing/
  npx wrangler secret delete HASH_SECRET
  ```

  From then on the endpoint answers `503 signup_unconfigured` and stores nothing, and the form says it couldn't reach the signup service. For the "Beta signups open soon" message instead, also set `betaSignupUrl` to `""` and redeploy the site (section 4); that alone closes only the form, because scripts can still post to the endpoint. To reopen, pipe the same 1Password value into `secret put` again. Delete the secret only while the Worker is signup-only: with licensing on, `HASH_SECRET` also keys license lookups.

- **Roll back the Worker:** from `billing/`, `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. Without an ID it picks the version of the previous deployment. `secret put` and `secret delete` each create a deployment too, so right after one of them a plain `rollback` undoes that secret change; Wrangler warns when the secrets differ. A rollback doesn't touch D1. After any rollback, rerun the section 2 check. If it answers `503 signup_unconfigured`, the version you rolled back to predates `HASH_SECRET`: roll back again to a version deployed after the secret was set. Piping the secret in again won't work while an older version is live, because `secret put` refuses to run then.
- **Roll back the site:** in Workers & Pages → `<pages-project>` → Deployments, roll back to an earlier production deployment. `npx --prefix billing wrangler pages deployment list --project-name <pages-project>` lists them from the repository root.
- **Costs:** Pages static requests are free. Workers Free covers 100,000 requests a day per account, and D1 has a free tier. The domain is the only fixed cost.

## After go-live: Google verification

1. In Google Search Console, add `<domain>` as a Domain property and verify it with the TXT record Search Console gives you (add it to the zone's DNS). Use an account that's Owner or Editor on the Google Cloud project.
2. On the OAuth consent screen's Branding page, add `<domain>` to the authorized domains, and use `<site-origin>/` as the homepage and `<site-origin>/privacy.html` as the privacy policy URL. Pages redirects the latter to `<site-origin>/privacy`.

The full verification plan, including the demo video, is in `docs/launch/google-verification.md`.
