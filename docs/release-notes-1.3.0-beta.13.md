# DayBoard 1.3.0-beta.13 — Quick Capture and side-panel fixes

This is the first beta that beta.12 installs on its own, so it is also the first real test of
DayBoard's in-app updates. It is a draft until the build is made and verified on an Apple
Silicon Mac.

## Fixes

- **Quick Capture keeps your first keystrokes.** The first time the panel opened after launch,
  its text box stayed disabled for a moment while settings and accounts loaded, so the first
  letters you typed were lost. It now takes typing right away, and Enter waits until DayBoard
  knows where the item can go. If AI capture is off, what you typed becomes the title in the
  manual form.
- **Suggested links fit the side panel.** With details open in the side panel at its default
  width, a Suggested row under "Linked items and suggestions" squeezed its title to a single
  letter and ran the source under the Link button. Narrow panels now put the title and source on
  the first line and the badge and buttons underneath, like the Related context rows.

## Under the hood

- When a release check fails, the log names the artifact (app, ZIP, or the app inside the DMG)
  and the command that failed, with its output, instead of a bare exit code. That output is
  shortened, runner paths are replaced, and control characters and workflow commands can't act
  on the job.
- The release tests that failed beta.12's second run are steadier: the Quick Capture test was
  catching the bug above, and the slash-menu test now retries Escape until each dialog closes.
- The README opens with the 12-second launch loop (not shipped in the app).

## Updating

From beta.12, DayBoard downloads beta.13 in the background and shows **Restart to update** in
the toolbar. Settings → Updates checks on request. If you don't restart, it installs the next
time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. Google may restrict accounts outside the project's test audience. AI
and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, tests run, and SHA-256 hashes in
SHA256SUMS.txt. Drop the side-panel fix above if PR #49 isn't merged first. If Google's consent
screen is in production by then, drop the test-audience sentence. Publish by pushing tag
`v1.3.0-beta.13` from Miles's Mac after he approves; then confirm the release carries the DMG,
ZIP, both blockmaps and `latest-mac.yml`, and that a beta.12 install updates to it (A10).
