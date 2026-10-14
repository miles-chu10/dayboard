# DayBoard 1.3.0-beta.12 — native shell and ⌘N

This beta carries beta.11's Google sign-in forward and adds the native macOS refinements merged
since then. It is a draft until the build is made and verified on an Apple Silicon Mac.

## New

- **⌘N opens New Item** from Agenda, Inbox, Calendar and the other main views, including when
  focus is on a row's action controls. It is ignored while a dialog or confirmation is open, so
  it never stacks a second New Item window. The + buttons show the shortcut in their tooltip.
- **The sidebar + is clickable everywhere.** It was previously covered by the window drag strip
  in views where it was the only way to add an item. The empty title-bar strip still drags the
  window.
- **A more native window.** Main pages share 24px headers and gutters and a stable history
  toolbar. Sidebar symbols use consistent 18px marks in 28px tiles, keeping the logo, provider
  identities, accent and density settings.
- **Responsive details pane.** Editors and drafts stay mounted when the details pane moves
  between side, inline and stacked layouts. The pane can be resized and shown or hidden from the
  keyboard, and focus returns to the item you opened it from. Compact Calendar titles stay
  readable, and Calendar controls stay visible above the selected week.

## Under the hood

- Beta packaging enforces the Google configuration from `package:preview` through the final
  DMG and ZIP, and the artifact verifier checks it inside the app, ZIP and mounted DMG.
- Billing service tooling dependencies were updated (not shipped in the Mac app).

## Install and limits

Apple Silicon, macOS 14+. Same distribution as beta.11: ad-hoc signed, not notarized, in-app
updates disabled. Quit DayBoard, replace the application in Applications and keep your data,
which lives outside the bundle. macOS may block the first launch; the tester decides whether to
open it through System Settings → Privacy & Security → Open Anyway. Google may restrict accounts
outside the project's test audience. AI and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, tests and packaged UI cases run, and
SHA-256 hashes in SHA256SUMS.txt. Update the website Road Map from "beta 11" to "beta 12" in
the same change that links the release.
