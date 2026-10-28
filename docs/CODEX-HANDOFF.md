# DayBoard handoff to Codex (2026-10-28)

Written by Claude on 2026-10-28 at about 06:00 UTC (23:00 PDT on the 27th, Miles's local time) so
that Miles can pick up all DayBoard work in Codex. It is a snapshot: re-check anything marked
running, waiting or unverified before acting on it.

Read this with `AGENTS.md` (repo rules), `docs/RELEASE.md` (build and release gates) and
`docs/EXECPLAN.md` (goal). The "Current state" section of `HANDOFF.md` is stale (it still calls
beta 12 the latest release); this file supersedes it until `HANDOFF.md` is refreshed. Miles's
older Codex checkpoint on the Mac (`~/Documents/Codex/2026-10-20/task/dayboard-private-checkpoint.md`,
2026-10-20) is also superseded.

No secrets are in this file. Never print, log or commit tokens, keys, passwords or the Google
OAuth client.

## 1. Where things stand

### Standalone Mac app

- **Published:** `v1.3.0-beta.13`, a GitHub prerelease published 2026-10-28 04:49 UTC by release
  run 40633492619 from main `ca29afb`. `v1.3.0-beta.12` (2026-10-22, main `9e32075`) was the first
  release that was Developer ID signed, notarized, stapled and self-updating. For both, all 7
  assets, `SHA256SUMS.txt` against GitHub's digests, `latest-mac.yml` and the ZIP app's staple
  ticket were checked after publication.
- **A10 (in-app update) passed** at 05:06 UTC: Miles's installed beta 12 found beta 13, installed
  it and restarted into it. Not yet done: a read-only `codesign` and Keychain re-check of the
  updated app on the Mac.
- **main is `b78b554`.** Since beta 13 it gained #54 (UI overflow fixes and
  `e2e/ui-audit.spec.ts`), #55 (Claude Code setup), #56 (dependency security fixes, `415d144`),
  #57 (Electron 44.4.4 to 44.10.0 for GHSA-jr5w-w6x2-84p9 and GHSA-x562-297c-g43g, version
  `1.3.0-beta.14`, draft notes `docs/release-notes-1.3.0-beta.14.md`, merged as `14bdb4d`) and
  #59 (website caption, `b78b554`).
- **Beta 14 dry run FAILED.** Signed macOS beta run 40640091540 on `14bdb4d` failed at 05:53 UTC
  in "Test before loading signing credentials". Nothing was signed or published and no credentials
  were loaded. Playwright: 61 passed, 1 skipped, 2 failed, both in `e2e/ui-audit.spec.ts`:
  - line 65, "long item text stays inside its row on every route, narrow and wide"
  - line 102, "details keep long text inside the pop-up, inline row and side panel" (event in
    inline mode at 800px)
  - both report `covered: button "Follow up with design agency" under h2 "October 2026"`.

  Not diagnosed yet. A clue, unverified: the same tests passed in the native check on Miles's Mac
  at `6ba5cb8` around 05:33 UTC, which was still October 27 locally, while the runner ran on
  October 28 UTC. Earlier ui-audit tests were time-of-day sensitive (fixed in `25d0e63`), so suspect
  date-dependent demo data before suspecting the runner. Fix the cause; never skip or quarantine the
  test. This was owned by the Claude thread "Ship beta 14 with Electron security update".

- **Installed on Miles's Mac:** `/Applications/DayBoard.app`, reported as beta 13 after A10. A
  05:35 UTC log read showed "beta 12" in the relaunch entry, so confirm the bundle version.
- **Mac App Store: parked** (Miles, 02:02 UTC 10-28). PR #51 (an API-key-only AI option for a
  future App Store edition) is merged and dormant. Feasibility doc:
  https://claude.ai/artifact/6WxEURh5FcpMcPcQDmvzie. Resume only on Miles's word; the bundle ID
  question comes first.

### Website (getdayboard.com)

- **Live:** Cloudflare Worker `dayboard-website`, version `8fcd94ce-1493-4ee6-bfef-e6f4f02fd038`.
  It has the launch video, muted autoplay and beta 12 install copy.
- **#59 merged but not deployed.** It removes the caption under the homepage video. The deploy
  from the Mac was blocked by Claude Code's own safety check ("Production Deploy"). Miles was
  asked to run it himself (commands in section 7). `8fcd94ce` is the rollback target.
- **Stage 2 is unblocked, waiting on Miles's go.** Stage 2 adds `/download` (a 302 to the release
  DMG in `website-worker/worker.js`), removes the signup form, refreshes the README, drops the
  Google and Apple logos and adds unverified-Google copy. The patches in the project Library
  (`dayboard/website-stage2/`, base `c29b56f`) are old; rebase onto current main, expecting
  conflicts with the live launch pass.
- **Waitlist:** D1 `dayboard.beta_signups` had 25 rows on 2026-10-20. The privacy policy says the
  data is kept until the waitlist closes, so closing it means deleting those rows (Miles's OK).

### Google sign-in

- The OAuth consent screen was **published to production** at 05:15 UTC 10-28. It is unverified:
  users see "Google hasn't verified this app" (Advanced, then Go to DayBoard) and the app is capped
  at 100 users in total because of the Gmail and Calendar scopes. "Back to testing" would bring
  back the 7-day sign-outs.
- Miles signed in again at 05:32 UTC (22:32 PDT). A new token was saved and the log had no
  sign-out errors afterwards.
- **Waiting:** the first automatic refresh, about an hour after sign-in (after 06:35 UTC / 23:35
  PDT). Confirm it in `~/Library/Logs/DayBoard/dayboard.log` (JSON lines) and confirm the app
  version at the same time. Miles should also glance at Agenda, Gmail and Calendar to confirm his
  data shows.

### Glaze DayBoard

- **Glaze DayBoard 1.2.5 is live** in the Glaze Public Store (published 05:39 UTC 10-28) with every
  Snyk flag cleared.
- Its dependency fixes are **uncommitted** in `sources/` (`package.json`, `package-lock.json`,
  `.gitignore`) on top of `5bc351e`, the `glaze` branch baseline. Backups: git stash `594ac51b` and
  `~/Downloads/glaze-sources-1.2.5-backup-20261028` (tgz, sha256 starting `a6a65209`). Keep both.
- **Strategy:** one light final 1.2.6 with a "quiet note", then Glaze freezes. Miles picked the
  quiet note at 05:52 UTC. The copy below was drafted at 05:53 UTC and **awaits his OK**. Around
  06:05 UTC the Claude Glaze thread built it as draft PR #61 (branch `claude/glaze-1.2.6-final`,
  `a3e3f37`, base `glaze`): the About section, the 1.2.5 dependency versions, SDK 0.14.4.0 and
  release notes. Nothing has touched the Mac yet.
  - Settings → General, new "About" section at the bottom, below Data: **DayBoard for Mac** /
    "DayBoard is also available as a standalone Mac app at getdayboard.com." (plain text link, no
    banner or button anywhere).
  - 1.2.6 "What's new?": "Settings → General has a new About section noting that DayBoard is also
    available as a standalone Mac app at getdayboard.com." and "Security updates for dependencies."
  - Store description: no change proposed. It already says "📍 Download the standalone macOS app
    here: https://getdayboard.com/" and passed review twice on 10-28. Miles suggested adding the
    line to the listing's caption too; answer that before publishing.
  - Reason for the quiet wording: Glaze's Acceptable Use Policy (glaze.app/aup, updated
    2026-06-30) bans content "advertising or promoting any services" and any "marketing call to
    action". Review is automated, but Glaze can remove apps.
- **PR #45 is parked** as a draft (head `2d106e0`, base `glaze`). It carries the Glaze port of
  Quick Capture, the menu bar panel, meeting-aware Up Next and the composer model/effort work. It
  was never applied on the Mac, so the published Glaze app has none of it.

### Business

- **Direct sales first.** Releases are currently free builds (`DAYBOARD_RELEASE=1` with
  `DAYBOARD_LICENSE=off`). The `billing/` Worker uses plain Stripe Checkout (one-time, no automatic
  tax), which makes Miles the seller of record. Recommendation on file: Stripe Tax or a
  merchant of record before charging. Price and activation limit are undecided.
- A separate ChatGPT launch plan already exists; don't write another. MicAI stays backlogged.
  Product Hunt, Reddit and X promotion are planned with no date. iOS is "someday".

## 2. Strategy and scope (Miles, 2026-10-28)

- After the Glaze 1.2.6 quiet note, work on the **standalone app only**. Glaze becomes a pointer to
  getdayboard.com, because even app analytics need Glaze Pro.
- The project's done criteria still name Quick Capture, Menubar and Meeting Notes on both hosts.
  The Glaze freeze changes that. Record Glaze parity as dropped by Miles's decision, not as an
  unsupported host capability or an unfinished port.
- Keep the no-API-key subscription Assistant (Claude Code, Codex and agy CLIs), the user's
  provider and model choices, and truthful labels: show the model that actually ran and the
  effective supported effort; keep "selected for the next request" apart from "last reply". If
  metadata is missing, say so rather than guess. Claude Code's `default` model shows no effort
  and never gets `--effort`.
- Don't over-engineer. Fix observed defects before merging. Count only evidenced outcomes as done.

## 3. Feature status by platform

"Unverified" means nobody has seen it work, not that it is broken.

| Feature                                        | Standalone source                            | Automated tests                                   | Native acceptance                                                                                      | Shipped        | Glaze                    |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- | ------------------------ |
| Quick Capture                                  | #44 (`5489bbb`) + first-keystroke fix in #48 | Unit + e2e                                        | Demo QA 14/14 on the `01bb084` package (10-22); opened in the beta 14 throwaway-profile launch (10-28) | Beta 12 and 13 | Not in 1.2.5; #45 parked |
| Menu bar panel                                 | #44                                          | Unit + e2e                                        | Same as above; tray anchoring failed on 10-20 and was fixed before the 14/14 run                       | Beta 12 and 13 | Not in 1.2.5; #45 parked |
| Meeting Notes (Granola import)                 | #44                                          | e2e with stubbed IPC                              | Real Granola import unverified                                                                         | Beta 12 and 13 | Not in 1.2.5; #45 parked |
| Model + effective-effort labels                | #42 (`768329f`)                              | Unit + e2e, race repro                            | Demo screenshots only; a signed-in reply label on a release build is still a release-only gate         | Beta 12 and 13 | In #45, parked           |
| Agenda (Reminders, Tasks, Calendar, Gmail, AI) | Shipped                                      | Unit + e2e                                        | Real Google sign-in and refresh being re-proven after the production publish (section 1)               | Beta 12 and 13 | 1.2.5 live               |
| Glaze look for standalone (#60)                | Draft PR `b1d96a7`                           | Linux Playwright 62 pass, 1 known Linux-only fail | Not seen on a Mac (sidebar vibrancy)                                                                   | No             | n/a                      |

## 4. Open PRs and branches

| PR  | Branch                                      | Head      | State                                                                                                                                     |
| --- | ------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #60 | `claude/project-thread-ix3u1e`              | `b1d96a7` | Draft. Standalone restyled to the Glaze Agenda layout. Needs a Mac visual check, then Miles's merge OK. Not in beta 14 unless he says so. |
| #58 | `dependabot/npm_and_yarn/...-af2a28f8ab`    | `3efd4b0` | Dependabot vite 7.3.6 to 7.3.7. Build-time only, not shipped. Merge needs Miles's OK.                                                     |
| #61 | `claude/glaze-1.2.6-final` (base `glaze`)   | `a3e3f37` | Draft. Glaze 1.2.6 quiet note. Waiting on Miles's OK on the copy, then Mac steps and publish, each with his OK.                           |
| #45 | `claude/system-panels-glaze` (base `glaze`) | `2d106e0` | Draft, parked (see Glaze above).                                                                                                          |
| new | `claude/project-thread-2e72zg`              | local     | This file as `docs/CODEX-HANDOFF.md`. Pushed only after Miles OKs it.                                                                     |

Preserve, never force-push or delete:

- `glaze` (`5bc351e`), the Glaze baseline.
- Mac branch `claude/project-thread-p5gpjl` (`d9d5bc9`) and its worktree
  `.claude/worktrees/stapler-diagnostics`.
- Mac branch `codex/website-release-copy-20261021`.
- Worktrees left on the Mac: `~/code/dayboard-pr57` and `~/code/dayboard-pr54`. Remove one only by
  its exact path and with Miles's OK.

Merged and approved so far: #40, #42, #43, #44, #47 to #57 and #59.

## 5. Pending decisions and gates

Each needs Miles's explicit OK at the time, in his own words, unless marked read-only.

1. **Beta 14.** Fix the two ui-audit failures on a branch, then CI, then Miles's merge OK. Next a
   new signed dry run on main (OK), then tag `v1.3.0-beta.14` from Miles's Mac on the main SHA
   whose `package.json` says `1.3.0-beta.14` (OK). Then verify the release and the in-app update
   from beta 13. Electron 44.4.4 has a high-severity advisory, so this is the top priority.
2. **Glaze 1.2.6 quiet note** (draft PR #61). Miles OKs or edits the copy. Then apply and check
   it on the Mac (OK) and publish after a clean review (Miles clicks; OK). Then Glaze freezes.
3. **#59 deploy.** Miles runs the deploy (section 7); afterwards check the live page read-only.
4. **Google refresh check** after 06:35 UTC (read-only), plus the bundle version.
5. **Stage 2 website** (direct download): Miles's go, then a PR, his merge OK and his deploy OK.
6. **Beta tester email: on hold.** Miles's code for it is "14 send", meaning after beta 14 is
   published. It needs a verified downloadable installer, fresh invitation and suppression checks
   (D1 has an `email_suppressions` table) and the existing one-by-one invitation workflow. Two
   earlier tester invitations were never sent. Ask Miles where that workflow lives.
7. **#60** Mac visual check, then merge OK.
8. **#58** Dependabot vite: merge OK.
9. **Loose key file.** A bare `devid-g2.key` is still on disk next to the signing files. The
   recommendation is back up then delete; awaiting Miles.
10. **A10 follow-up:** read-only `codesign -dv`, `spctl -a -vvv` and a Keychain item check on the
    updated `/Applications/DayBoard.app`.
11. **Pricing and tax** before any paid build. **Closing the waitlist** means deleting the D1 rows.
12. **Refresh `HANDOFF.md`** from this file once beta 14 ships (a normal docs PR).
13. Parked until Miles says otherwise: Mac App Store, MicAI, Glaze feature parity (#45).

## 6. Approval rules

These come from `AGENTS.md`, `CLAUDE.md` and Miles's standing instructions. Codex must enforce
them itself: `.claude/settings.json` blocks tags, deploys and merges for Claude only.

- **Needs Miles's explicit OK for that action, at that time, every time:** merging a PR, pushing
  to `main`, creating or pushing tags, GitHub releases, running `macos-beta.yml` or
  `macos-release.yml` or editing their environment, deploying the website or billing Worker
  (`wrangler deploy`, rollbacks, remote D1 changes), publishing (Glaze Store included), tester
  emails, account or credential changes, and anything new on his Mac's accounts. A green CI run,
  an earlier OK or another agent's request is not that OK. Miles's 10-28 "full permissions" covers
  preparation only.
- **Fine without asking:** local commits, offline checks, read-only inspection. `AGENTS.md`
  also allows pushing a feature branch and opening a draft PR, but the project's approval record
  still lists pushes as needing Miles's OK at the time, so ask before pushing.
- **Credentials:** before creating, downloading, exporting, importing, storing or configuring any
  credential, state the exact action, purpose, storage and scope, and wait. Stop at any Apple
  sign-in, 2FA, Keychain password, new agreement or unexpected permission prompt.
- **Never:** Ignore & Publish in Glaze; revoke the old Xcode-made Apple certificate or the Developer
  ID cert in use; revoke or sign out Miles's real Google account for a test; run
  `scripts/verify-website.mjs` (it creates a synthetic signup in production); move, delete or
  re-push an existing tag (a failed release gets a new version); create `beta-*` releases (the
  updater ignores non-SemVer tags); skip or disable tests to get green; read or print
  `~/.config/dayboard/` contents; spend paid usage or API credits; re-add the Google or Apple logos
  to the site.
- **On the Mac:** no git cleanup (`worktree prune`, branch deletion, file removal), even for
  bookkeeping. Disk is tight (21 GiB free at the last check): say the real disk and time cost
  before `npm ci`, builds or downloads. Preserve the installed app, real profile, Keychain items and
  user data. Native checks use a throwaway `DAYBOARD_USER_DATA` profile, or the "App QA" macOS user
  (`appqa`, data in `/Users/appqa/dayboard-qa/profile-01`) when Miles agrees.
- **How to ask:** short replies can read two ways ("No beta is fine" once meant keep the beta
  label). Confirm a terse answer that changes a release, version or public copy in one line before
  acting. Put choices in the message as one-word options with your recommendation marked.

## 7. Release procedure (beta N)

1. **PR.** Version bump in `package.json` and `docs/release-notes-1.3.0-beta.N.md`. Lockfile
   changes use `npx npm@11` (npm 10 strips the lockfile's libc fields). CI (`ci.yml`) runs only
   offline checks; `codex-review.yml` reviews. Playwright e2e runs only in the macOS workflows, so
   e2e failures first show up in the dry run unless you run `npm run test:e2e` on the Mac.
2. **Native check on the Mac** in a fresh worktree: `npm ci --include=dev`, `npm run build`,
   `npm test`, `npm run test:e2e`, using a throwaway profile only.
3. **Merge** (Miles's OK).
4. **Dry run** (Miles's OK): dispatch "Signed macOS beta" (`macos-beta.yml`) on main. About 11
   minutes. It tests, builds with `build:beta`, signs with Developer ID, notarizes, staples,
   verifies the team, hardened runtime, staple and Gatekeeper for the app, DMG and ZIP, and
   smoke-tests. It publishes nothing.
5. **Tag** (Miles's OK, pushed only from Miles's Mac, never from a cloud session):
   `git -C ~/code/dayboard tag -a v1.3.0-beta.N <main-sha> -m "DayBoard 1.3.0-beta.N"` then
   `git -C ~/code/dayboard push origin v1.3.0-beta.N`. The commit must be on main and its
   `package.json` version must match.
6. **Release run.** The tag starts "Signed macOS release" (`macos-release.yml`): tests, sign,
   notarize, staple, verify, smoke-test, then publish a GitHub prerelease with 7 assets (DMG, ZIP,
   both blockmaps, `latest-mac.yml`, `SHA256SUMS.txt`, manifest). If it fails, re-run the failed
   job once with Miles's OK (the tag stays put); otherwise ship a new version.
7. **Verify** (read-only, as in `.claude/commands/release-check.md`): every `SHA256SUMS.txt` line,
   `latest-mac.yml` version, sha512 and size, and on the Mac `codesign --verify --deep --strict`,
   `codesign -dv --verbose=4`, `xcrun stapler validate` and `spctl -a -vvv` for the ZIP's app and
   the mounted DMG's app. Then Miles runs Settings › Updates › Check › Restart to update, and you
   confirm the version, Keychain continuity and Google still signed in.
8. **Afterwards:** fill the release notes from the run, update README and site copy only with
   evidence, and report the exact SHA, run IDs and asset hashes. Keep "tests pass", "CI green",
   "merged", "built", "notarized", "installed" and "published" separate.

Website deploy (needs Miles's OK, run from the Mac; the main checkout has no
`billing/node_modules`, so use the wrangler installed in `~/Code/dayboard-waitlist/billing`):

```sh
git -C ~/code/dayboard worktree add --detach /tmp/dayboard-deploy-<sha> <full-merged-sha>
cd /tmp/dayboard-deploy-<sha>/website-worker && npx --prefix ~/Code/dayboard-waitlist/billing wrangler deploy
```

For #59 the SHA is `b78b55464aee44d447927e0b398096da9accafec`. Record the new version ID, check
the live page (for example `curl -s https://getdayboard.com/ | grep -c figcaption` should print 0),
then remove only that one worktree by its path. Rollback (also a deploy, also needs OK):
`npx --prefix ~/Code/dayboard-waitlist/billing wrangler rollback 8fcd94ce-1493-4ee6-bfef-e6f4f02fd038`.

## 8. Key paths, IDs and rollback targets

| What                                              | Value                                                                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                                              | https://github.com/miles-chu10/dayboard, Mac checkout `~/code/dayboard`                                                                                                                                    |
| Glaze source                                      | `~/code/Glaze/DayBoard Personal Dashboard/sources` (runtime in `../runtime`), git remote `glaze`                                                                                                           |
| Bundle IDs                                        | `com.mileschu.dayboard` (real), `com.mileschu.dayboard.qa` (QA)                                                                                                                                            |
| App log                                           | `~/Library/Logs/DayBoard/dayboard.log`                                                                                                                                                                     |
| Apple team                                        | `LGJS5APK9X` (Individual, active to 2027-10-20)                                                                                                                                                            |
| Developer ID Application cert                     | G2 `JY83PF83QH`, valid to 2027-11-21. The old Xcode cert is unused: never revoke it.                                                                                                                       |
| Signing files (never read)                        | `~/.config/dayboard/release-signing/`; Google client `~/.config/dayboard/google-oauth.json`                                                                                                                |
| GitHub environment                                | `macos-release` (main and `v*`), used by both signing workflows                                                                                                                                            |
| Workflows                                         | `ci.yml`, `codex-review.yml`, `macos-beta.yml` (dry run), `macos-release.yml` (tag)                                                                                                                        |
| Notarization key                                  | App Store Connect team key "DayBoard notarization"                                                                                                                                                         |
| Website                                           | Worker `dayboard-website`; live and rollback `8fcd94ce-1493-4ee6-bfef-e6f4f02fd038`; older `ac249dc5`                                                                                                      |
| App rollback                                      | Releases can't be pulled back: ship a new version. Beta 11 backup `~/DayBoard-backup-beta11-20261022T111431Z`; beta 12 DMG in `~/Downloads/Installers`                                                     |
| Glaze rollback                                    | stash `594ac51b`, `~/Downloads/glaze-sources-1.2.5-backup-20261028`                                                                                                                                        |
| Design (claude.ai)                                | Design System https://claude.ai/artifact/CnNCtx2fthfYNHvenLyGMc, website canvas https://claude.ai/artifact/AozTYNY7PiPkda2WJJZZ5V                                                                          |
| Evidence (claude.ai project Library, `dayboard/`) | `apple-readiness-audit-2026-10-20.md` (canonical A1 to A11 log), `website-stage2/`, `dependency-audit-2026-10-28/`, `glaze-ui-match-2026-10-28/`, `launch-video-2026-10-22/`, `glaze-store-update-plan.md` |

## 9. Gotchas

- **App Translocation.** If DayBoard lands in `/Applications` by script, macOS runs it from a
  hidden read-only copy and in-app updates can't install. Scripted `mv`, Finder AppleScript and
  `ditto` did not clear it. Only Miles's own Finder drag into Applications does (or dragging from
  the mounted DMG and choosing Replace).
- **iCloud Desktop.** Miles's Desktop syncs to iCloud Drive. A Finder drag to the Desktop copies
  instead of moving, and a move back failed because iCloud held the file. Stage anything in
  `~/Downloads`, never the Desktop.
- **No GUI control.** Agent requests to control DayBoard, Chrome or Finder on the Mac have been
  denied instantly (Computer Use is unavailable). Miles clicks in-app buttons himself: Sign in with
  Google, Glaze Resubmit/Publish, Keychain prompts (choose **Always Allow**, or it keeps asking).
  Give him exact click paths.
- **Quit Glaze before touching `sources/`.** A running Glaze.app re-applies its SDK
  0.14.3.0 to 0.14.4.0 migration to `sources/package.json` within seconds of any change. Verifying
  from `sources/` overwrites `../runtime` (needs OK); set `GLAZE_BUILD_OUT_DIR` for an isolated
  verify. Glaze's review scans the Mac's copy, so for a review warning first compare the flagged
  version with the `glaze` branch lockfile.
- **Safety checks on the Mac.** Claude Code's auto-mode on the Mac blocked `wrangler deploy` and
  tag pushes from agent sessions. Codex has its own approval prompts; keep them on for this repo.
- **Shell and Node.** Node 24 is required. The shell may export `NODE_ENV=production`, so install
  with `--include=dev`.
- **Known test noise.** The e2e "closing the main window ... reopens" test always fails on Linux.
  The e2e fixture does not forward `TZ`. `tests/packaging-workspace.test.mjs:128` failed once with
  `kill EPERM`. Past time-dependent e2e flakes were fixed rather than skipped; do the same.
- **Google warning is expected** for the unverified app: Advanced, then Go to DayBoard (unsafe).
- **Glaze composer packets** (`glaze-1.2.6-composer-15/16`) are retired; don't rebuild them.

## 10. What doesn't carry over from Claude

- Claude's project threads, coordinator, scheduled checks (a Google refresh reminder and a beta 14
  dry run check, both due around 06:00 to 06:35 UTC), PR watches and Mac Remote Control sessions
  still exist and may keep acting. Before Codex takes a piece of work, tell the Claude coordinator
  to stand down on it (or pause everything) so two agents don't drive the same PR, tag or deploy.
- Claude Design artifacts live on claude.ai and have one editor (the Claude thread "DayBoard Design
  continuation"); Codex can't edit them.
- Project Library files (evidence, patches) are on claude.ai, not on the Mac. Miles can download
  any of them.

## 11. First five things for Codex

1. **Orient, read-only.** Run `git -C ~/code/dayboard fetch origin` and `git status` without
   disturbing uncommitted work, and read `AGENTS.md`, `docs/RELEASE.md` and this file. Ask Miles
   which items Codex now owns and confirm Claude has stood down on them.
2. **Google refresh check** (after 06:35 UTC). Read-only: look in
   `~/Library/Logs/DayBoard/dayboard.log` for Google refresh or sign-out errors since 05:32 UTC,
   and read the version with
   `defaults read /Applications/DayBoard.app/Contents/Info.plist CFBundleShortVersionString`.
   Report the exact non-secret error lines, if any. Don't read tokens or sign anything out.
3. **Unblock beta 14.** Reproduce the two `e2e/ui-audit.spec.ts` failures from run 40640091540,
   find the cause (start with date-dependent demo data around "October 2026"), fix it on a branch
   with a test that fails before the fix, open a draft PR, get CI green, then ask Miles for
   "merge", "dry run" and finally the tag, one at a time.
4. **#59 deploy.** If Miles hasn't run it yet, give him the two commands in section 7 (or run them
   with his explicit OK), then confirm the caption is gone from the live page and record the new
   Cloudflare version ID.
5. **Glaze 1.2.6.** Once Miles OKs the quiet-note copy in draft PR #61 and answers the caption
   question, lay out the Mac steps (quit Glaze first), apply and check it with his OK, show him the
   Store notes, and stop before Publish for his go.
