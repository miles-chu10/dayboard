# Automatic signed macOS downloads

The `Signed macOS release` workflow is scoped to `miles-chu10/DayBoard`. Pushing an approved matching version tag (for example, `v1.3.0-beta.18`) builds and publishes a GitHub Release containing the macOS DMG, update ZIP, blockmaps, update metadata, SHA-256 checksums and a source manifest. Each tag push requires Miles's explicit approval.

Only commits already on `main` can release. The tag must exactly match `package.json`. Tags containing a prerelease suffix publish a GitHub prerelease; stable tags use GitHub's normal latest-release selection. The target is Apple Silicon, macOS 14+.

## One-time setup

Create/configure the repository's `macos-release` Actions environment. Use environment secrets or repository secrets; keep credentials in 1Password and GitHub's encrypted secret storage, never in source files. An environment protection/reviewer rule can require approval before each release.

Secrets:

| Name                           | Value                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64 export of the Developer ID Application certificate **and private key**                       |
| `MACOS_CERTIFICATE_PASSWORD`   | Password protecting that PKCS#12 export                                                             |
| `MACOS_NOTARY_KEY_P8`          | App Store Connect team API key's `.p8` contents for notarization                                    |
| `DAYBOARD_GOOGLE_OAUTH_JSON`   | The app-owned Desktop OAuth `{clientId, clientSecret}` configuration; no user access/refresh tokens |

Variables:

| Name                         | Value                                   |
| ---------------------------- | --------------------------------------- |
| `APPLE_TEAM_ID`              | Expected 10-character Developer ID team |
| `APPLE_API_KEY_ID`           | Notarization API key ID                 |
| `APPLE_API_ISSUER`           | Notarization team API issuer UUID       |
| `DAYBOARD_LICENSE_API_URL`   | Deployed HTTPS license-service origin   |
| `DAYBOARD_STRIPE_PRODUCT_ID` | Approved live Stripe product ID         |

The workflow fixes the license environment to `live` but builds published betas with `DAYBOARD_LICENSE=off`, so every feature stays free. Checkout and Google waitlist restrictions are unchanged. Enabling paid licensing requires a separately approved workflow change and the account, checkout and support checks in `RELEASE.md`; signing and release approvals still apply to every beta. This automation does not create Stripe products, deploy the billing backend or website, merge the app PR or upload existing unsigned previews.

## Release process

1. Merge and review the app version on `main`; update `package.json` and its lockfile version together.
2. Push a matching `v…` tag on that commit. The tag is the explicit release trigger.
3. CI runs typecheck, formatting, lint, app/native/billing tests and credential-free Electron E2E.
4. CI builds with the approved app configuration, forces Developer ID signing, and notarizes and staples both the app and the signed DMG. Because stapling changes the DMG, it regenerates the DMG blockmap and update metadata before checksumming the final assets. It verifies the app, the copies inside both download formats, and the DMG's signature, stapled ticket and Gatekeeper assessment. Packaged demo tests run before upload.
5. A separate publishing job without Apple/Google credentials verifies file hashes, uploads all downloads into a draft release, and publishes it only after uploads finish. Missing configuration, signing/notarization failures or failing checks produce **no public release**. There is no unsigned fallback.

Published releases are immutable to this workflow: reruns refuse to replace them. A failed upload can resume only the workflow-created draft with the same source SHA; unrelated/manual drafts are preserved. Keep older assets available for installed users' updates.

The [beta.18 release](https://github.com/miles-chu10/DayBoard/releases/tag/v1.3.0-beta.18) is published with all seven assets. Its [signed release run](https://github.com/miles-chu10/DayBoard/actions/runs/41977368075) succeeded, and [subsequent Mac verification](release-notes-1.3.0-beta.18.md#release-verification) checked the published downloads' hashes, code signatures, notarization and stapled tickets. Beta.18 is the first published release with the DMG itself notarized and stapled; earlier Developer ID-signed betas, through beta.17, notarized only the contained app. Local helper tests and workflow lint verify guards and publication behavior; they do not replace Apple's signing/notarization checks on each new release.
