# DayBoard 1.3.0 beta 10

This Apple Silicon, macOS 14+ community beta retains beta.9's reviewed native light/dark UI
and D icon. It adds a focused MCP security mitigation: SDK 1.32.0, tool-input budgets on both
built-in servers, and a shared limit before SDK validation of authenticated HTTP JSON.
Oversized structures receive HTTP 413; ordinary source and tool behavior is preserved.

The SDK OAuth advisory GHSA-6qxp-vccf-f47h is patched by this dependency version. DayBoard's
current HTTP MCP clients use configured headers rather than the SDK OAuth provider, so the
advisory's OAuth credential-leak path was not demonstrated in this app.

Zod 4.6.5 remains subject to SNYK-JS-ZOD-20510278, which has no published fixed release.
The built-in HTTP server retains its 1 MiB body limit and now caps combined array elements
and object members at 10,000, with at most 64 nesting levels, before any SDK schema parsing.
This mitigates inbound array validation amplification. It does not clear dependency scanner
findings or bound schema validation of responses from external MCP servers; configure only
trusted external servers. AI and MCP remain optional.

Download the DMG, close the previous app, and drag DayBoard into Applications. App data lives
outside the application bundle. The package is **ad-hoc signed, without Developer ID signing
or notarization**, and is not verified by Apple. macOS may block its first launch. The package
does not disable Gatekeeper or remove quarantine; any first-opening decision through System
Settings → Privacy & Security → Open Anyway belongs to the tester.

Google sign-in is unconfigured in this credential-free UI beta, so Google Tasks, Gmail and
Calendar cannot be connected. Licensing and automatic updates are disabled. Demo mode uses
fictional data. Apple Reminders requires the user's own macOS permission, and AI requires an
explicitly selected provider and the user's provider access. ChatGPT sign-in is not included.
Real provider operations, first-time Reminders consent, Keychain/account continuity and
ordinary quarantined Finder installation are not certified by fixture checks.

GPL source and third-party notices accompany the package. DMG and ZIP hashes are provided
in SHA256SUMS.txt. Developer ID signing and notarization remain deferred for this limited beta.
