# DayBoard website (local draft)

Static, dependency-free pages for an official Mac download site. Nothing here publishes an installer or opens checkout.

## Preview

From the repository root:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Stop the server with Ctrl-C.

## Release configuration

Edit only `assets/site.js` to set verified HTTPS URLs for `downloadUrl` and `checkoutUrl`. The download page shows an unavailable state until a download URL is supplied. Checkout stays hidden until its URL is supplied. Add a verified public price or trial description through `priceLabel` and `trialLabel` only after those terms exist in the actual merchant flow.

Set `screenshotUrl` to a fictional-data image at `assets/<name>` after that image has been reviewed, or to a verified HTTPS image URL. The site keeps a useful fallback if the image is absent or fails to load. The root release workflow will provide the screenshot later.

Before publication, confirm the final domain, supported macOS versions, installer checksum and signing status, real checkout and support route, current privacy notice, GitHub source availability, and that all copy matches the shipped app. The current text intentionally describes a release in preparation.

The original app artwork is copied from the repository's `app-icon.png` into `assets/dayboard-icon.jpg`. Its source file has JPEG bytes despite the `.png` name, so the website uses a matching extension and MIME type.
