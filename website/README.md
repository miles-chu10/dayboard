# DayBoard website

Static, dependency-free pages for DayBoard: a landing page and `waitlist.html` with the waitlist signup, `beta.html` with install steps for invited beta testers, a guide, support and license pages. There is no build step; the `website/` folder is deployed as-is by the Worker in `website-worker/` to https://getdayboard.com.

## Preview

From the repository root:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Stop the server with Ctrl-C. Pages follow the visitor's light or dark setting, and the screenshots switch with it. This server ignores `_headers` and `404.html`; the deployed site applies them.

## Waitlist signup

The forms post to the DayBoard service's `POST /v1/waitlist` endpoint (see `billing/README.md`). Joining is an expression of interest: invitations go out in small groups with no set dates, so the copy must not promise access, a date or a download. `waitlist.html` is the waitlist's own page. `beta.html` keeps the install help for people who were already invited, and its old `#join` anchor now points to the waitlist. Pages cached before the change post to `/v1/beta-signup`, which the service keeps as an alias with the same storage, duplicate check and rate limit.

At launch, set both values in `assets/site.js`:

```js
const SITE_CONFIG = Object.freeze({
  waitlistUrl: "https://api.<domain>/v1/waitlist",
  contactEmail: "<private address for removal requests>",
});
```

The form controls ship disabled, and the script enables them only when `waitlistUrl` is a valid HTTPS URL **and** `contactEmail` is set, so no one can sign up before there's a way to ask for removal. Until then the forms show "The waitlist opens soon" and send nothing. `contactEmail` also fills every `a[data-contact]` link (the privacy, support, beta and waitlist pages).

A form says "You're on the waitlist." only when the service answers with a 2xx status and the JSON `{"ok": true}`. Anything else, such as an HTML page with status 200, an error, a network failure or no answer within 15 seconds (the request is then aborted), shows a message and re-enables the form with the address kept, so the visitor can try again. `tests/website-signup.test.mjs` runs the real script against a stand-in page to check these cases.

Browsers accept the endpoint only when the service's `SITE_ORIGIN` setting matches this site's exact origin. The form sends the email address and an empty hidden field; see `billing/README.md` for what the service's protections do and don't cover.

## Publishing

Follow `docs/launch/website-deploy.md`. It deploys the signup endpoint, sets `SITE_CONFIG`, makes each `og:image` absolute, publishes this folder with the site Worker in `website-worker/` and verifies the result. On the live getdayboard.com deployment, follow its "Existing deployment: waitlist rollout" section instead: the database change and the API go out before this folder. Before publishing:

- Review `privacy.html` (a draft, not legal advice); Google's verification needs it linked from the consent screen.
- Check that the copy still matches the shipped app, especially the requirements and install steps on `beta.html`.

## Cloudflare files

- `_headers` sets security headers, including a Content-Security-Policy whose `script-src` allows each page's inline head script by its sha256 hash. After editing a page's inline `<script>`, recompute the hashes from the repository root and update `_headers`:

  ```sh
  node -e 'const c=require("crypto"),fs=require("fs");for(const f of process.argv.slice(1)){const m=fs.readFileSync(f,"utf8").match(/<script>([\s\S]*?)<\/script>/);console.log(f,"sha256-"+c.createHash("sha256").update(m[1]).digest("base64"))}' website/*.html
  ```

- `404.html` is what the site serves, with status 404, for unknown paths (`not_found_handling` in `website-worker/wrangler.jsonc`). It uses root-absolute URLs (`/assets/site.css`) because it's served at any depth.
- `robots.txt` is the crawler policy. Add a `Sitemap:` line only together with a `sitemap.xml`.

## Assets

- `assets/screens/` is a copy of `docs/screenshots/`, captured by `npm run screenshots` from the fictional demo. After recapturing, recompress and copy the images here.
- The homepage hero and homepage link preview use `assets/screens/light-agenda-preview.png` and `dark-agenda-preview.png` (2560×1640). These are unaltered native Agenda E2E captures from 2026-10-09, with fictional demo data, captured from a 1280×820 app window at 2× scale. The visible caption identifies the UI as in development; it does not promise an available download.
- Other pages keep their existing `assets/screens/light-agenda.png` (1600×1025) link preview, which contains fictional demo data and no access promise. The older `assets/og-image.png` says "Free public beta" and must not be referenced by waitlist pages.
- `assets/icon-32.png` and `assets/icon-96.png` are the small-size logo, and `assets/icon-180.png` (Apple touch icon) is the full-bleed square logo. Sources and regeneration steps are in `brand/README.md`.
- `assets/fonts/` holds self-hosted Fraunces and Hanken Grotesk under the SIL Open Font License; their license texts sit beside them. No page loads third-party resources.
