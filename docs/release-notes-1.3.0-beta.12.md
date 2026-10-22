# DayBoard 1.3.0-beta.12 — signed, self-updating, Quick Capture and the menu bar

This beta carries beta.11's Google sign-in forward and adds the native macOS work merged since
then. It is a draft until the build is made and verified on an Apple Silicon Mac.

## New

- **DayBoard now updates itself.** This is the first beta signed with DayBoard's Developer ID,
  notarized by Apple and published with update metadata. It checks for newer betas after launch
  and every few hours, downloads them in the background, and shows **Restart to update** in the
  toolbar when one is ready. If you don't restart, the update installs the next time you quit.
  Settings → Updates and DayBoard → Check for Updates… still check on request. Your data and
  sign-ins stay where they are.
- **Quick Capture.** ⌃⌥⇧Space (changeable in Settings) opens a small panel over any app,
  including full-screen apps, on the display under the pointer. Type a thought and press Enter:
  the AI capture files it in Google Tasks, Apple Reminders or Google Calendar, focus goes straight
  back to the app you were in, and a confirmation offers Undo.
- **Menu-bar Agenda.** A menu-bar icon opens today's items, the next meeting, recent captures
  and a capture box without bringing the whole dashboard forward.
- **Up Next.** A card for the next meeting shows when it starts, a Join button and the AI
  meeting prep, with an optional notification shortly before it starts. If a Granola MCP server
  is set up in DayBoard, you can pull that meeting's notes afterwards and turn their action items
  into Tasks or Reminders. Each of these features can be switched off in Settings.
- **A smarter Assistant composer.** The model chip has a per-provider effort setting, `/` opens
  commands and `@` mentions your tasks, events and mail. Settings → AI and the composer share
  one model list.
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

## Fixes

- **Going offline no longer signs you out of Google.** If DayBoard renews its Google access while
  the Mac is offline or Google's sign-in service is failing, it now shows a connection error with
  Retry and keeps you signed in. Only a sign-in Google has actually revoked or expired asks you
  to sign in again.

## Under the hood

- Stable builds stay on the stable update channel even when their version carries build metadata
  with a hyphen (for example `1.3.0+build-local`).
- The Assistant's effect-dependency lint warnings are fixed. Browser tests confirm a question
  handed off from Today and auto-added proposals still run exactly once.
- Beta packaging enforces the Google configuration from `package:preview` through the final
  DMG and ZIP, and the artifact verifier checks it inside the app, ZIP and mounted DMG.
- Billing service tooling dependencies were updated (not shipped in the Mac app).
- Hardening synced from the Glaze build:
  - The Assistant now keeps every email, event, task and account field on one line of its
    data snapshot, and puts MCP server errors inside that snapshot. Text from those sources
    can no longer pose as the end of the snapshot.
  - The direct Anthropic route ignores an inherited `ANTHROPIC_BASE_URL`, so your API key only
    goes to Anthropic.
  - Token totals read as unknown when a step reports no usage, and cancelled requests record
    no usage. Request durations now exclude app setup.
  - A provider error that arrives mid-reply now shows its message.

## Install and limits

Apple Silicon, macOS 14+. Notarized, so it opens normally with no Open Anyway step.

Coming from beta.11 or earlier is a one-time manual step, because those builds can't update
themselves: quit DayBoard, open the beta.12 DMG and replace the application in Applications. Your
data lives outside the bundle and stays. Because the signature changed, macOS may ask once
whether DayBoard can use its saved key in your keychain; allow it so you stay signed in. From
beta.12 on, new betas arrive in the app. Google may restrict accounts outside the
project's test audience. AI and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, tests and packaged UI cases run, and
SHA-256 hashes in SHA256SUMS.txt. Publish by pushing tag `v1.3.0-beta.12` after Miles approves;
then confirm the release carries the DMG, ZIP, both blockmaps and `latest-mac.yml`. Update the website Road Map from "beta 11" to "beta 12" in
the same change that links the release.
