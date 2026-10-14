# DayBoard 1.3.0-beta.11 — Google sign-in restored

This corrective beta restores Google sign-in in the standalone macOS app. Beta.10 omitted the
existing Desktop OAuth build configuration and disabled sign-in before opening Google.
Google-enabled beta builds (`npm run build:beta`) now fail if that configuration is missing or
invalid. Client values and user tokens remain outside the source repository.

Cached sidebar summaries now show refresh failures and partial results next to the cached
count instead of hiding them. The screenshot capture tool bounds Settings startup when IPC
never settles. The updated D icon is included throughout.

Apple Silicon, macOS 14+. This limited beta is ad-hoc signed and passes strict deep signature
verification. It has no Developer ID signature and is not notarized; macOS may block ordinary
quarantined first opening. Do not disable Gatekeeper or remove quarantine. In-app updates are
disabled for this community beta: quit DayBoard and replace its application bundle manually.
App data lives outside the bundle and is kept.

Validation: 25 focused Google/build tests, 3 screenshot timeout tests, typecheck, format, lint
and the configured production build; 12 packaged UI cases passed with one deliberately skipped
real native Keychain probe. DMG and ZIP contents match the tested app. A real Google browser
callback and connected account were observed with source fetching disabled. Every invitee's
OAuth audience eligibility, forced refresh, personal-account continuity and ordinary
quarantined Finder acceptance remain unverified. Google may restrict accounts while the
project's audience is in Testing; consent must be completed by the account owner.

MCP SDK remains pinned to 1.32.0 with beta.10's local HTTP envelope limits and built-in tool
element limits. Zod 4.6.5 has no published advisory fix; responses from user-configured
external MCP servers are not covered by the inbound bounds. Use trusted external servers.

Release source: tag `beta-1.3.0-beta.11` (`68a388b`, PR #32). DMG and ZIP hashes are in
SHA256SUMS.txt.
