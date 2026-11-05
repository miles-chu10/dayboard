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

## Pricing, refunds and download

`pricing.html` describes DayBoard Pro ($5 once, AI only, up to 3 Macs, 7-day AI trial, beta testers free), `refund.html` the 14-day refund policy, and `download.html` links the current beta's DMG on GitHub. It currently links published `v1.3.0-beta.18`, including its release notes and `SHA256SUMS.txt`. The DMG is 138,284,646 bytes (138.3 MB). When a new beta ships, verify the published assets, then update the version, links and size in `download.html`, and the beta named in the homepage badge, guide link and Road Map (`index.html`) and the guide's intro and description (`docs.html`). `tests/website-beta-version.test.mjs` fails until those match the linked beta. Screenshot captions name the beta they were captured on; change them only after recapturing.

From beta 18 on, both the app and its DMG are Developer ID signed, notarized and stapled (the DMG passes `stapler validate` and `spctl` as Notarized Developer ID). Releases up to beta 17 notarized only the app. Google access may still be restricted to invited accounts. Published betas keep every feature free, and checkout remains closed.

Buy buttons (`a[data-buy]`) ship hidden, and `[data-buy-pending]` notes say checkout isn't open yet. Set `buyUrl` in `assets/site.js` to the live billing service's checkout page (`https://api.getdayboard.com/buy`) only after the live Worker is deployed and tested; the script then shows the buttons and hides the notes. Only an HTTPS address is accepted. `tests/website-buy.test.mjs` checks both states.

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
- `robots.txt` is the crawler policy and points to `sitemap.xml`. Each page has a `<link rel="canonical">` with its extensionless address (`/waitlist`, not `/waitlist.html`). When you add a page, add it to `sitemap.xml` and give it a canonical link.

## Assets

- `assets/screens/` contains copies of `docs/screenshots/`, captured by `npm run screenshots` from the isolated fictional demo. The beta 17 refresh captures a 1280×820 content window at 2× scale, producing 2560×1640 images. Copy matching light and dark images after recapturing, and keep the HTML image dimensions and social preview metadata in sync.
- The homepage hero uses `light-home.png` and `dark-home.png`; its social preview uses the light Home image. The Assistant feature uses `light-ask.png` and `dark-ask.png` to show the docked panel beside Home. The calendar, task, reminder and mail gallery images come from the same capture. Visible captions and alt text identify fictional demo data and sample AI responses.
- The beta and waitlist pages use the current `assets/screens/light-agenda.png` for their social previews. The older Agenda previews and launch video are retained as historical assets but are no longer the homepage hero. The older `assets/og-image.png` says "Free public beta" and must not be referenced by waitlist pages.
- `assets/icon-32.png` and `assets/icon-96.png` are the small-size logo, and `assets/icon-180.png` (Apple touch icon) is the full-bleed square logo. Sources and regeneration steps are in `brand/README.md`.
- `assets/fonts/` holds self-hosted Fraunces and Hanken Grotesk under the SIL Open Font License; their license texts sit beside them. No page loads third-party resources.

## Local checks

Run `node --test tests/website-signup.test.mjs tests/website-buy.test.mjs` for the existing signup and checkout gates. Preview the homepage, gallery tabs, theme switch, guide and download page at desktop and mobile widths. The guide's shortcuts follow `renderer/lib/shortcuts.ts`, `renderer/components/shell.tsx`, `renderer/components/tab-strip.tsx`, the mail handlers and `main/window.ts`; Quick Capture's default comes from `main/services/settings-store.ts`.

`scripts/verify-website.mjs` is a post-deploy check that writes a synthetic signup to the supplied API. Do not use it as a read-only local page check or point it at production without authorization.
