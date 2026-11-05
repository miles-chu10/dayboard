# DayBoard 1.3.0-beta.18 — MCP that waits its turn, readable toasts, a notarized disk image

This beta fixes two problems found after beta.17 and notarizes the disk image itself, not only
the app inside it. It is a draft until the build is made and verified on an Apple Silicon Mac.

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

## Updating

From beta.12, beta.13, beta.15 or beta.17, DayBoard downloads beta.18 in the background and shows
**Restart to update** in the toolbar. Settings → Updates checks on request. If you don't restart,
it installs the next time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. Google may restrict accounts outside the project's test audience. AI
and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, the release run, and the DMG's size and
SHA-256 from `SHA256SUMS.txt`. Publish by pushing tag `v1.3.0-beta.18` from Miles's Mac after he
approves. Then confirm the release carries the DMG, ZIP, both blockmaps, `latest-mac.yml`,
`release-manifest.json` and `SHA256SUMS.txt`; that `xcrun stapler validate` and
`spctl --assess --type open --context context:primary-signature` accept the downloaded DMG; and
that a beta.17 install updates to it.
