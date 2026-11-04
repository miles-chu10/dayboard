# DayBoard 1.3.0-beta.14 — Security updates and layout fixes

This beta updates Electron and the app's bundled libraries to versions with published security
fixes, and keeps long text inside its row. It is a draft until the build is made and verified on
an Apple Silicon Mac.

## Security

- **Electron 44.10.0** (from 44.4.4). Fixes GHSA-jr5w-w6x2-84p9 (high, certificate handling for
  eMudhra certificates) and GHSA-x562-297c-g43g (moderate).
- **Bundled libraries** updated to patched versions: undici 6.29.1 (including a TLS validation
  fix), hono 4.13.13, fast-uri 3.1.9, body-parser 2.4.0, qs 6.16.2 and ip-address 10.7.4. Of
  these, DayBoard loads hono and fast-uri for its local MCP server, and undici only when the AI
  SDK downloads a file in API-key mode. The others ship inside the app but are never loaded.

## Fixes

- **Long text stays in its row.** Agenda task titles stop before the list chip and due date,
  event rows leave the title room next to a long location, Calendar month cells drop the time
  instead of squeezing the title, and long pasted links wrap inside pop-up and side-panel
  details. The @-mention menu and Meeting Notes suggestions truncate long names.
- **Calendar "Focus on" works.** The buttons on a selected day did nothing; they now focus the
  item the same way the Agenda does.
- **Links that can't open say why.** In demo mode, or for a link that isn't https, DayBoard shows
  a message instead of doing nothing.

## Under the hood

- A layout test lengthens item text and checks every view, details mode, Settings tab, composer
  menu, Quick Capture, the menu bar panel and Meeting Notes at two window widths in light and
  dark.

## Updating

From beta.12 or beta.13, DayBoard downloads beta.14 in the background and shows **Restart to
update** in the toolbar. Settings → Updates checks on request. If you don't restart, it installs
the next time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. Google may restrict accounts outside the project's test audience. AI
and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, tests run, and SHA-256 hashes in
SHA256SUMS.txt. Drop the bundled-libraries item if PR #56 isn't merged first, and match its
versions to what #56 merged. If Google's consent screen is in production by then, drop the
test-audience sentence. Publish by pushing tag `v1.3.0-beta.14` from Miles's Mac after he
approves; then confirm the release carries the DMG, ZIP, both blockmaps and `latest-mac.yml`,
and that a beta.13 install updates to it.
