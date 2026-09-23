# Automatic signed macOS downloads

The `Signed macOS release` workflow is scoped to `miles-chu10/dayboard`. After this workflow and the standalone app reach `main`, pushing a matching version tag (for example, `v1.3.0`) builds and publishes a GitHub Release containing the macOS DMG, update ZIP, blockmaps, update metadata, SHA-256 checksums and a source manifest.

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

The workflow fixes the license environment to `live`. Complete the account, checkout, support and signing checks in `RELEASE.md` before pushing a release tag. Pricing remains a separate product decision; this automation does not create Stripe products, deploy the billing backend, merge the app PR or upload existing unsigned previews.

## Release process

1. Merge and review the app version on `main`; update `package.json` and its lockfile version together.
2. Push a matching `v…` tag on that commit. The tag is the explicit release trigger.
3. CI runs typecheck, formatting, lint, app/native/billing tests and credential-free Electron E2E.
4. CI builds with the approved app configuration, forces Developer ID signing, notarizes and staples the app, then verifies the app and the copies inside both download formats. The DMG is signed; its contained app is notarized/stapled. Packaged demo tests run before upload.
5. A separate publishing job without Apple/Google credentials verifies file hashes, uploads all downloads into a draft release, and publishes it only after uploads finish. Missing configuration, signing/notarization failures or failing checks produce **no public release**. There is no unsigned fallback.

Published releases are immutable to this workflow: reruns refuse to replace them. A failed upload can resume only the workflow-created draft with the same source SHA; unrelated/manual drafts are preserved. Keep older assets available for installed users' updates.

The signing and notarization run cannot be proven until real credentials are configured and the first approved tag runs. Local helper tests and workflow lint verify guards and publication behavior, not Apple's actual signing/notarization service.
