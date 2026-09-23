# DayBoard website

Static, dependency-free pages for the DayBoard beta: a landing page with the beta signup, a beta page with install steps, a guide, support and license pages. There is no build step; deploy the `website/` folder as-is.

## Preview

From the repository root:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Stop the server with Ctrl-C. Pages follow the visitor's light or dark setting, and the screenshots switch with it.

## Beta signup

The forms post to the DayBoard service's `POST /v1/beta-signup` endpoint (see `billing/README.md`). Set its address in `assets/site.js`:

```js
const SITE_CONFIG = Object.freeze({
  betaSignupUrl: "https://<service-origin>/v1/beta-signup",
});
```

Until that is a valid HTTPS URL, the forms show "Beta signups open soon" and send nothing. The service must list this site's exact origin in its `SITE_ORIGIN` setting, or it rejects the request. The form sends the email address and an empty hidden field that catches bots.

## Before publishing

- Confirm the final domain, then change each page's `og:image` to an absolute URL (`https://<domain>/assets/og-image.png`) so link previews work.
- Deploy the signup endpoint and set `betaSignupUrl` and `SITE_ORIGIN`.
- Check that the copy still matches the shipped app, especially the requirements and install steps on `beta.html`.

## Assets

- `assets/screens/` is a copy of `docs/screenshots/`, captured by `npm run screenshots` from the fictional demo. After recapturing, recompress and copy the images here.
- `assets/og-image.png` (1200×630) is the link preview image, rendered from the site's fonts and the Agenda screenshot.
- `assets/icon-*.png` are resized from the repository's `app-icon.png` (JPEG data despite the name).
- `assets/fonts/` holds self-hosted Fraunces and Hanken Grotesk under the SIL Open Font License; their license texts sit beside them. No page loads third-party resources.
