# GitHub workflows

`CI` runs the offline test suite on pushes to `main`, pull requests, and manual
dispatch. It uses Node 24 and `npm ci --ignore-scripts`; native provider calls are
replaced by disposable test fixtures. Glaze's SDK and native app are supplied by the
local host, so formatting, lint, type-check, build, and live UI verification still
run locally with `npm run format` and `npm run verify`.

`Codex review` reviews non-draft, same-repository pull requests by trusted
collaborators. It reads the diff with the base branch's prompt and instructions,
uses a read-only sandbox, and drops runner privileges. A separate job posts or
updates one PR comment without receiving the OpenAI key. It does not merge,
deploy, edit source, or review forks. The action additionally checks the triggering
actor's repository write permission.

Activation requires the Actions repository secret `OPENAI_API_KEY` and repository
variable `CODEX_REVIEW_ENABLED=true`. Keep that variable unset or `false` until the
key is configured. Reviews consume the selected OpenAI project's API usage.
Disable new reviews by setting the variable to `false`.

Reference: [official Codex GitHub Action guidance](https://developers.openai.com/codex/github-action).
