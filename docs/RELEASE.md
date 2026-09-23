# DayBoard standalone release

## Build modes

- `npm run build`: compile the native helper and app. Missing Google configuration produces a clearly unconfigured app.
- `npm run test:e2e`: builds with `DAYBOARD_TEST=1`; OAuth/merchant constants are blank and tests use temporary profiles. Real source integrations are disabled in the empty-profile test.
- `npm run package:test`: create an unsigned test `.app` with no OAuth/merchant configuration.
- `npm run package:preview`: create an unsigned preview DMG and ZIP, using available local build configuration. No publishing occurs.
- `npm run dist`: require commercial-release configuration, build the DMG and ZIP, and keep publishing disabled. Signing and notarization are a separate verified step before public distribution.
- `DAYBOARD_LICENSE=off npm run build`: community build. Strict release packaging rejects this mode.

The current package target is Apple Silicon, macOS 14+. Intel compatibility is not claimed.

Every build generates third-party notices from installed production dependencies, bundled renderer libraries and Electron. Version-pinned overrides retain their source provenance. The inventory explicitly labels two MIT declarations whose packages omit separate license files; it uses canonical SPDX terms without inventing copyright holders. Missing or changed inputs fail the build. Both the app's GPL text and the third-party notices ship in Resources; the Help menu opens the notices.

## Manual updates

Official builds embed `DAYBOARD_RELEASE=1`; source, preview and demo builds cannot contact the updater. The DayBoard menu and Settings → Updates let users check, download and install explicitly. Automatic checks, downloads and installation on ordinary quit are disabled. Preparation freezes editing and new IPC/MCP operations, drains existing work and saves, then preserves the updater's own quit sequence. A failed preparation or installation restores normal app use. Publisher verification remains enabled.

macOS updates require the ZIP payload alongside the DMG. Publish both and the matching `*-mac.yml` update metadata in the same approved GitHub release. Prerelease builds can request prereleases; stable builds do not. Keep existing release assets available for existing users. A signed upgrade from an older installed version remains a mandatory real release test.

## Required commercial configuration

The existing Google **Desktop app** client is read from `DAYBOARD_GOOGLE_OAUTH_FILE` or the developer's `~/.config/dayboard/google-oauth.json`. The file contains `clientId` and `clientSecret`, stays outside the repository, and must never contain end-user access or refresh tokens. The installed-app client configuration is embedded in the executable as required by Google's desktop flow. Actual user tokens are encrypted locally after sign-in.

Public Lemon Squeezy metadata is supplied at build time:

| Variable                             | Value                                      |
| ------------------------------------ | ------------------------------------------ |
| `DAYBOARD_LEMONSQUEEZY_STORE_ID`     | Intended merchant store ID                 |
| `DAYBOARD_LEMONSQUEEZY_PRODUCT_ID`   | DayBoard product ID                        |
| `DAYBOARD_LEMONSQUEEZY_VARIANT_ID`   | Allowed variant ID, or comma-separated IDs |
| `DAYBOARD_LEMONSQUEEZY_CHECKOUT_URL` | Verified HTTPS checkout URL                |

The app never needs a merchant API secret. Activation first validates ownership of the key, then checks the activation response. A failed local save or mismatched response triggers cleanup of the new activation instance. Network failures preserve the last successful validation time and offline grace. A key from another product cannot unlock DayBoard.

## Verification gates

1. Formatting, typecheck, lint, unit/native tests and a production build.
2. Electron tests across routes, detail modes, editors, settings, Assistant history, focus persistence, licensing states and window lifecycle, using disposable profiles only.
3. Repeat app tests against the packaged executable by setting `DAYBOARD_E2E_EXECUTABLE` to `DayBoard.app/Contents/MacOS/DayBoard`. Verify the native helper and production dependencies are present.
4. Inspect the real native window, keyboard behavior, screenshots, launch time and idle resources. Record the hardware/OS and exact revision with the results.
5. Verify actual Google sign-in/refresh/sign-out and Reminders permissions with deliberately chosen test data. Fixture success is not evidence of real account operation.
6. Verify the intended merchant in test mode: checkout, receipt/key, activation, deactivation, refund/revocation and offline behavior. Never charge a real customer as a test.
7. Sign nested code and the application with the approved Developer ID, notarize, staple and assess the final artifact with Gatekeeper. Do not remove quarantine or advise users to disable security protections.
8. Install the signed prior version in a disposable test environment, check/download/install the new release, and verify the version, saved preferences and account continuity after restart. Unit updater fakes do not prove Apple's actual update installation.

`npm run measure -- --inspect` runs a disposable fictional demo and records launch/idle process measurements. Set `DAYBOARD_E2E_EXECUTABLE` to measure the packaged executable. Summed process working sets may count shared memory more than once; this measurement does not describe real-account workloads.

## Website and source distribution

The static site is in `website/`. Its configuration deliberately hides purchase/download actions until real destinations are verified. The app screenshot contains fictional demo data. Set the final source, download and checkout destinations only for the approved release; include the current privacy, support and refund information.

The standalone repository originated as a separate copy. Preserve the public repository's history when preparing the migration branch; do not force-push the standalone history over it. The Glaze implementation remains a separate reference until a deliberate transition is accepted.

Keep GPL source/build instructions available with the official binary. Distribute versioned DMGs, update ZIPs and matching update metadata through GitHub Releases, linked from the product website. Publish only after source-content review and the external release gates are complete.
