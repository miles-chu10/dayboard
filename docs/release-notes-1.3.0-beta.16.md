# DayBoard 1.3.0-beta.16 — Home, smarter mail, and an Assistant beside every page

This beta adds a Home page, mail you can send, snooze and clean up, an Assistant you can dock
beside any view, and Notes. It is a draft until the build is made and verified on an Apple
Silicon Mac.

## New

- **Home.** DayBoard opens on a greeting and a one-line summary, the mail and follow-ups waiting
  on you (oldest worries first, with how long each has waited), tasks suggested from your mail,
  your tasks and your meetings, for today or this week. The Agenda moves to its own sidebar row.
- **⌘K.** Jump to any view, email, event, to-do or note, or run an action. Press Tab to hand what
  you typed to the Assistant.
- **Ask the Assistant beside any page** (⌥⌘J). It knows which email, event or to-do you have
  open. ⌥⌘K shows your calendar in the same pane.
- **Mail triage everywhere.** New mail is sorted into needs reply, FYI and ignorable as it
  arrives, with a chip on every row and a one-line summary on the open email. E marks it done.
- **Write and send mail,** with Undo for 5 seconds (change it in Settings → General → Mail).
  Reply drafts follow what you've asked DayBoard to remember.
- **Snooze and "remind me if no reply".** A snoozed email leaves the inbox and comes back unread
  when you chose. A follow-up puts a thread back on Home if nobody answered.
- **Subscriptions.** See every newsletter by sender with how many you opened, and unsubscribe in
  one click where the sender supports it.
- **Notifications and a Dock badge.** Get notified when a snooze comes back, a follow-up goes
  unanswered, or (if you choose) any new mail arrives; notifications start off. The Dock icon
  counts what waits on you, or unread mail, or nothing. Both are in Settings → General → Mail.
- **The menu bar panel** shows the first three emails from Home's "Waiting on you".
- **Notes.** Write Markdown notes with live preview, find them with ⌘K, and save an Assistant
  chat as a note. MCP clients can read and, with Allow changes on, write them.
- **Memory.** Tell DayBoard your preferences in Settings → AI, and it learns more from how you
  edit its reply drafts. The Assistant and reply drafts follow them; turn memory off or forget
  any one at any time.
- **Agent activity and usage.** Settings → MCP Servers lists every DayBoard tool the Assistant or
  an outside agent used in the last 30 days (names and outcomes only). Settings → AI shows the
  AI requests and tokens DayBoard recorded per day and model.
- **Tabs.** ⌘T opens a tab; each keeps its own view. ⌃Tab and ⌘1–9 switch, ⌘W closes one, and
  your tabs come back next time.
- **Your sidebar, your order.** Reorder the views, hide any but Home, and turn off the count
  pills in Settings → General → Sidebar.
- **Keyboard.** J/K, Return, E, R, S and C work in the Inbox, and ? shows every shortcut.

## Privacy

- Memories are saved on your Mac. The Assistant can't save one itself, so text inside an email
  can't plant a preference. Outside agents can, only while Allow changes is on.
- The activity log keeps tool names and outcomes, never what a tool read or wrote.
- Usage counts come from DayBoard's own records. Your provider's plan limits aren't visible to
  DayBoard, so none are shown.

## Updating

From beta.12, beta.13 or beta.15, DayBoard downloads beta.16 in the background and shows
**Restart to update** in the toolbar. Settings → Updates checks on request. If you don't restart,
it installs the next time you quit. Your data and sign-ins stay where they are.

If updates never arrive, make sure DayBoard was dragged into Applications in Finder. A copy put
there another way can run from a read-only location where macOS won't let it replace itself.
Dragging it out of Applications and back in Finder once fixes this.

Apple Silicon, macOS 14+. Google may restrict accounts outside the project's test audience. AI
and MCP remain optional.

## Before publishing

Fill in from the actual build: release source commit, tests run, and SHA-256 hashes in
SHA256SUMS.txt. If Google's consent screen is in production by then, drop the test-audience
sentence. Publish by pushing tag `v1.3.0-beta.16` from Miles's Mac after he approves. Then
confirm the release carries the DMG, ZIP, both blockmaps and `latest-mac.yml`, and that a
beta.13 or beta.15 install updates to it.
