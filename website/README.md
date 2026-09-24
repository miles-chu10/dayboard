# DayBoard website

Static, dependency-free pages for the DayBoard beta: a landing page with the beta signup, a beta page with install steps, a guide, support and license pages. There is no build step; the `website/` folder is deployed as-is by the Worker in `website-worker/` to https://getdayboard.com.

## Preview

From the repository root:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Stop the server with Ctrl-C. Pages follow the visitor's light or dark setting, and the screenshots switch with it. This server ignores `_headers` and `404.html`; the deployed site applies them.

## Beta signup

The forms post to the DayBoard service's `POST /v1/beta-signup` endpoint (see `billing/README.md`). At launch, set both values in `assets/site.js`:

```js
const SITE_CONFIG = Object.freeze({
  betaSignupUrl: "https://api.<domain>/v1/beta-signup",
  contactEmail: "<private address for removal requests>",
});
```

The form controls ship disabled, and the script enables them only when `betaSignupUrl` is a valid HTTPS URL **and** `contactEmail` is set, so no one can sign up before there's a way to ask for removal. Until then the forms show "Beta signups open soon" and send nothing. `contactEmail` also fills every `a[data-contact]` link (the privacy, support and beta pages).

Browsers accept the endpoint only when the service's `SITE_ORIGIN` setting matches this site's exact origin. The form sends the email address and an empty hidden field; see `billing/README.md` for what the service's protections do and don't cover.

## Publishing

Follow `docs/launch/website-deploy.md`. It deploys the signup endpoint, sets `SITE_CONFIG`, makes each `og:image` absolute, publishes this folder with the site Worker in `website-worker/` and verifies the result. Before that:

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
- `assets/og-image.png` (1200×630) is the link preview image, rendered from the site's fonts and the Agenda screenshot.
- `assets/icon-*.png` are resized from the repository's `app-icon.png` (JPEG data despite the name).
- `assets/fonts/` holds self-hosted Fraunces and Hanken Grotesk under the SIL Open Font License; their license texts sit beside them. No page loads third-party resources.
