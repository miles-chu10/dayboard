---
description: Run the offline checks CI runs (format, typecheck, lint, unit tests, billing when touched)
---

Run DayBoard's offline verification and report the results. Don't fix anything unless asked.

1. Run `node -v`. If it is below 24, say so: CI uses Node 24 and results on older Node may differ.
2. If `node_modules` is missing, run `npm ci --include=dev --ignore-scripts --prefer-offline`.
3. Run each of these, continuing after a failure so every result is reported:
   - `npm run format:check`
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
4. If `git diff --name-only origin/main...HEAD` or the working tree touches `billing/`, also run `npm --prefix billing ci --include=dev` (when `billing/node_modules` is missing) and `npm run test:billing`.
5. Report the HEAD SHA from `git rev-parse HEAD`, whether the tree is dirty, and one line per command with pass/fail and test counts. For failures, quote the relevant output.

Build, e2e and packaging need macOS and are not part of this check. Say that they were not run.
