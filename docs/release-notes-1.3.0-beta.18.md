# DayBoard 1.3.0-beta.18 — MCP that waits its turn, readable toasts, a notarized disk image

This beta fixes two problems found after beta.17 and notarizes the disk image itself, not only
the app inside it. Beta.18 was
[published on November 5, 2026 (UTC)](https://github.com/miles-chu10/DayBoard/releases/tag/v1.3.0-beta.18)
from `8c3665c00b4f7d13fe995d7b0628bb3905d879a0`.

## Fixed

- **MCP clients reach DayBoard after a port clash.** If another app, often another copy of
  DayBoard, holds DayBoard's MCP port, DayBoard now tries again every 5 seconds and starts its
  MCP server as soon as the port is free. Until then, Settings → MCP Servers and its Connect a
  client buttons say which port is busy instead of "Starting…". Before, the server didn't start until DayBoard was
  relaunched.
- **A turned-off MCP server no longer looks like a bad key.** When Allow MCP clients is off,
  DayBoard tells clients the server is unavailable, so they stop reporting a rejected access key.
- **Toasts are readable in dark mode.** The messages at the bottom of the window follow light
  and dark mode. In dark mode their text was near-black on a dark background.

## Install

- **The DMG is notarized and stapled.** macOS now checks a downloaded DayBoard disk image the same
  way it checks the app. Releases up to beta.17 notarized only the app inside the DMG.

## Also in this build

- Groundwork for paid AI (#75): license handling for Quick Capture, deactivation and installation
  IDs. Published betas build with licensing off, so every feature stays free and nothing here
  changes what you see.

## Updating

From beta.12, beta.13, beta.15 or beta.17, DayBoard downloads beta.18 in the background and shows
**Restart to update** in the toolbar. Settings → Updates checks on request. If you don't restart,
it installs the next time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. Google may restrict accounts outside the project's test audience. AI
and MCP remain optional.

## Release verification

The [signed release run](https://github.com/miles-chu10/DayBoard/actions/runs/41977368075)
passed its tests, build, Developer ID signing, app and DMG notarization, package verification and
fictional-data smoke checks. The release contains the DMG, ZIP, both blockmaps,
`latest-mac.yml`, `release-manifest.json` and `SHA256SUMS.txt`.

Checked on a Mac from the published downloads: every `SHA256SUMS.txt` line matches the files and
GitHub's asset digests, and `latest-mac.yml` gives this version with the ZIP's and DMG's actual
SHA-512 and size. The DMG passes `xcrun stapler validate`, and `spctl` accepts it as Notarized
Developer ID. The apps in the ZIP and the DMG are 1.3.0-beta.18, pass
`codesign --verify --deep --strict` and `stapler validate`, and are accepted as Notarized
Developer ID (team `LGJS5APK9X`). An update from beta.17 has not yet been observed.

DMG: `DayBoard-1.3.0-beta.18-arm64.dmg` (138,284,646 bytes). Its published SHA-256 is
`0f3e491c981dea63a0723502198bca974063beabcd16e2d2cc1a79dde106321d`.
