# Proposal: set Electron fuses for release builds

Status: proposal for Miles. No build or release configuration has changed.

## Current state

REA `inspect_electron_fuses` on the installed `/Applications/DayBoard.app` (1.3.0-beta.11-local,
Electron Framework sha256 `d7867a81…bc4`) reads every fuse at Electron's default:

| Fuse                                  | State    | Effect                                                                    |
| ------------------------------------- | -------- | ------------------------------------------------------------------------- |
| RunAsNode                             | enabled  | `ELECTRON_RUN_AS_NODE=1` turns the signed app into a general Node runtime |
| EnableNodeOptionsEnvironmentVariable  | enabled  | `NODE_OPTIONS` can inject code at startup                                 |
| EnableNodeCliInspectArguments         | enabled  | `--inspect` / SIGUSR1 can attach a debugger to the main process           |
| EnableEmbeddedAsarIntegrityValidation | disabled | `app.asar` is not checked against a signed hash                           |
| OnlyLoadAppFromAsar                   | disabled | Electron also looks for app code outside `app.asar`                       |
| EnableCookieEncryption                | disabled | the cookie store is not encrypted at rest                                 |
| GrantFileProtocolExtraPrivileges      | enabled  | `file://` pages keep extra privileges                                     |

## Proposal

electron-builder 26.15.3 (installed) supports an `electronFuses` block. For **release builds
only** (`npm run dist` and the signed beta workflow), set:

```yaml
electronFuses:
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
  enableCookieEncryption: true
```

Leave `grantFileProtocolExtraPrivileges` enabled: DayBoard's windows load from `file://`.
Changing that needs a custom protocol first.

## Risks to check before enabling

- DayBoard's own code does not use `ELECTRON_RUN_AS_NODE`, `process.fork` or `utilityProcess`
  (checked: `main/`, `scripts/`). `node-pty` uses its unpacked `spawn-helper`, unaffected.
- Packaged e2e (`DAYBOARD_E2E_EXECUTABLE`) launches through Playwright, which needs the inspector.
  Keep fuses off for `package:test` and the preview build, or e2e against packaged apps stops working.
- ASAR integrity requires electron-builder to write the hash into `Info.plist` during signing.
  Verify the signed beta launches and that the updater-installed version still validates.
- Cookie encryption is one-way for the existing cookie store (Google sign-in uses Keychain-backed
  tokens, not cookies, so the impact should be nil; verify sign-in persists across the update).

## Next step

If approved: add the block behind the release build path, build the signed beta, re-run REA
`inspect_electron_fuses` on the result, and run the packaged smoke tests against the preview build.
