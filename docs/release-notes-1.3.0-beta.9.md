# DayBoard 1.3.0-beta.9 — community UI beta

The Agenda gives the selected day or date range a clear heading using DayBoard's existing type
tokens. Previous, Today and next controls stay grouped; search and source filters wrap within
the window. Sidebar spacing follows the existing density settings, and the New action remains
usable when details are open.

Test and demo startup now validates both app and browser storage before services start. An
invalid isolated profile exits Electron immediately, including failures caught by its ESM
bootstrap. Fictional UI checks preserve navigation, keyboard focus and preferences across
relaunches in owned profiles.

The approved manual beta keeps monetization and automatic updates disabled; AI remains opt-in.
Its app bundle uses the updated DayBoard D icon and passes strict deep ad-hoc signature
verification. Miles explicitly deferred Developer ID signing and notarization for this limited
beta. macOS may require the tester's own opening decision in Privacy & Security; the package
does not change Gatekeeper or remove quarantine.

This artifact has Google sign-in unconfigured. Connecting Google Tasks, Gmail and Calendar is
unavailable; fictional demo mode remains available. Apple Reminders requires the tester's own
macOS permission, and AI requires an explicitly selected provider and provider access.
Real Keychain/account continuity, first-time Reminders consent and ordinary quarantined Finder
installation have not been re-tested. Cached sidebar summaries can still mask refresh or
incomplete-coverage warnings; inspect Agenda's source status when data may be stale.

The final package passed nine fictional or disabled-source smoke checks, with the separate
native encryption probe skipped. DMG verification, ZIP CRC, archived app contents and the
ad-hoc signature pass. Apple Silicon and macOS 14 or later are supported. ChatGPT sign-in is a
separate unfinished experiment outside this release.
