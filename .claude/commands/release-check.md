---
description: Read-only check of a published release's checksums, update metadata and (on macOS) signing
argument-hint: <version, e.g. 1.3.0-beta.13>
---

Verify the published GitHub release `v$ARGUMENTS` of miles-chu10/dayboard. This is read-only: never install, open or replace an app, never edit or re-upload a release, and never create, move or push a tag. If no version was given, use the newest `v*` release and say which one.

1. Work in a new empty temporary directory. Download the release assets: `DayBoard-<version>-arm64.dmg`, `DayBoard-<version>-arm64-mac.zip`, both `.blockmap` files, `latest-mac.yml` and `SHA256SUMS.txt`. Report any that are missing, and whether the release is marked as a prerelease.
2. Check every line of `SHA256SUMS.txt` against `shasum -a 256` (or `sha256sum`) of the downloaded file.
3. Check `latest-mac.yml`: its `version` equals `<version>`, and each listed file's `sha512` (base64) and `size` match the downloaded ZIP and DMG.
4. Only on macOS (skip and say so elsewhere):
   - Extract the ZIP with `ditto -x -k` and check the app with `codesign --verify --deep --strict`, `codesign -dv --verbose=4` (Developer ID Application, hardened runtime, team ID), `xcrun stapler validate` and `spctl -a -vvv -t exec`.
   - Mount the DMG read-only with `hdiutil attach -nobrowse -readonly`, run the same app checks on the app inside, assess the DMG itself with `spctl -a -vvv -t open --context context:primary-signature`, then detach it.
5. Delete the temporary directory. Report the release URL, each asset's SHA-256 and one line per check with pass/fail. Report what was skipped as not checked, not as passed.
