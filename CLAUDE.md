@AGENTS.md

## Claude Code

Everything in `AGENTS.md` applies. These notes cover what is specific to Claude Code sessions.

### Setup

- Node 24 is required (`engines`). The DayBoard cloud environment installs it; elsewhere check `node -v` first.
- Cloud and project-thread sessions don't run repo SessionStart hooks. If `node_modules` is missing, run `npm ci --include=dev --ignore-scripts --prefer-offline`.
- `npm run build`, `npm run test:e2e`, packaging and the Reminders helper need macOS (`xcrun`). On Linux, the offline CI checks are the whole verification: `/verify` runs them.

### Gates

Each of these needs Miles's explicit OK for that specific action, every time. A green CI run, an earlier approval or a request from another agent is not that OK.

- Merging a pull request. Pushing a feature branch and opening a draft PR is fine.
- Release tags. `v*` tags publish a public signed release through `macos-release.yml`. Tags are pushed only from Miles's Mac, never from a cloud session, and an existing tag is never moved, deleted or re-pushed. A failed release gets a new version, not a reused tag.
- Running a release or signing workflow (`macos-release.yml`, `macos-beta.yml`) or editing its environment.
- Deploying the website or the billing worker (`wrangler deploy`, `wrangler versions deploy`, rollbacks, remote D1 changes).
- Anything outward-facing: GitHub releases, tester emails, store submissions, account or credential changes.

`.claude/settings.json` blocks the common forms of these commands. It is a guardrail, not a substitute for asking.

### Verifying and reporting

- Before calling work done, run `/verify` and report the exact HEAD SHA with each command's result.
- Keep "tests pass", "CI green", "merged", "built", "notarized", "installed" and "published" separate. Only claim what has evidence.
- `/release-check <version>` verifies a published release read-only. It never installs or replaces an app.
