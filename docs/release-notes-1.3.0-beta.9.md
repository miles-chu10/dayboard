# DayBoard 1.3.0-beta.9 — local release candidate

The Agenda gives the selected day or date range a clear heading using DayBoard's existing type
tokens. Previous, Today and next controls stay grouped; search and source filters wrap within
the window. Sidebar spacing follows the existing density settings, and the New action remains
usable when details are open.

Test and demo startup now validates both app and browser storage before services start. An
invalid isolated profile exits Electron immediately, including failures caught by its ESM
bootstrap. Fictional UI checks preserve navigation, keyboard focus and preferences across
relaunches in owned profiles.

This version is reserved locally for review. The proposed manual beta keeps monetization and
automatic updates disabled; AI remains opt-in. Signing, notarization, the intended Google
test audience and distribution approval remain release requirements. No backend, billing or
waitlist behavior changes are included.
