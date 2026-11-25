# Pull requests

A personal Herdr mod powered by the locally configured `gh` CLI. No additional credentials or packages are needed.

## Use

Open as a tab:

```sh
herdr-app do tab.new '{"name":"Pull requests","mod":"pr-status"}'
```

Or beside the current terminal:

```sh
herdr-app do pane.split '{"direction":"right","mod":"pr-status"}'
```

- **Assigned**: open PRs assigned to the selected account.
- **Opened** (compact: **Mine**): open PRs authored by the selected account.
- **Review requested** (compact: **Review**): open PRs currently requesting that user's review (not team-only requests). Once GitHub removes the review request after a review, the PR leaves this inbox. Previously reviewed PRs are not retained; closed and merged PRs are excluded from all views.
- **Team**: open PRs for the logins configured in `WHITE_WALKERS` in `model.js`. The export has an empty team list and safely defaults to the selected account. The internal `whiteWalkers` key is retained for compatibility. Pagination loads up to GitHub's 1,000-result search limit.
- The panel follows GitHub/Primer conventions in light and dark appearances, independent of terminal ANSI colors: neutral canvas, inset header, bordered secondary buttons, green merge actions, coral active-tab underline, outlined pill badges, and blue branch chips. PR rows use state-colored pull-request icons (green open, gray draft, purple merged, red closed), prominent hover-blue titles, muted repository/number/author metadata, and flat dividers. The agent picker uses the same palette, bordered rows, blue selection, and a standard Cancel button. Behavior and safety guards are unchanged.
- The account button lists all configured `gh` accounts and hosts. Selecting one runs `gh auth switch`, changing the active CLI account for that host globally. Other dashboard copies follow at their next refresh. No tokens are read or stored by the mod.
- CI is taken from the latest commit and includes check runs and legacy commit statuses. Skipped/neutral checks are non-failing. Cancelled/action-required checks are flagged as failed. No checks is not treated as CI passing.
- Review decisions, drafts, conflicts, blocked merges and behind branches appear separately; CI success does not imply a PR is mergeable.
- A single overall CI icon appears beside each PR: green ✓ passed, red × failed, amber ● pending, gray − no checks, or gray ? partial results. Hover for the summary. Individual steps are not listed; open the PR on GitHub for the full breakdown. **From** (source branch) and **Into** (target branch) are always visible on each row, including compact mode; hover a truncated branch to see its full name. The author (`@login`) is also always visible, with a hover tooltip for the full login; there is no Details toggle. **↗** or the PR title opens the PR in the default browser via `gh pr view --web`.
- **Diff** (compact) / **Review changes** (full) opens `pr-review` in a large centered modal (94% of window width, 92% of height), without creating tabs, splitting panes or resizing your terminal. **Close** or Escape dismisses it; clicking outside does not, to avoid accidental dismissal while writing a comment. Unsubmitted comment drafts remain in-memory and are lost when the modal closes. Browse changed files and unified patches without checkout, and explicitly submit approval with confirmation in the reviewer. The existing title/↗ browser actions are unchanged. See `../pr-review/README.md` for snapshot and API limits.
- **Merge…** appears for every open, non-draft PR with a loaded head, not only assigned/authored/approved PRs. Each card puts **Diff / Review changes** and the green **Merge…** action in a GitHub-style bottom action row. Clicking Merge only opens the shared `pr-merge` confirmation dialog; it never merges immediately. The dialog shows the exact PR, author, branches, reviewed head and account. If you did not author the PR (or its author is unknown), a prominent amber warning must be explicitly acknowledged before **Confirm merge** appears. Choose merge commit or squash in the confirmation dialog; only repository-enabled methods can be selected. Rebase is not supported. Confirmation rechecks identity, permission, method and head/base revision; the mutation guards the expected head SHA. GitHub enforces checks, required reviews, conflicts and branch rules, without admin bypass, auto-merge or branch deletion. Cancel/Escape before confirming makes no change. Confirmed merges disappear from every dashboard copy through shared state; counts reconcile on the normal 60-second refresh. Merge stays in place with unchanged styling during refreshes and after refresh failures, avoiding blinking or layout shifts. It is temporarily non-interactive in those states (with an explanatory hover tooltip), and the method-level guard also blocks confirmation from stale callbacks. Diff remains usable.
- **Send to agent…** on each PR (also in the review toolbar) lists running agents, with Pi first and agents in the current space preferred within each group. Like Gitview notes, **Enter / click** places an explanation/evaluation request in the selected terminal input; **Shift+Enter / Shift+click** sends it immediately. No new agent or tab is launched. The prompt includes the exact PR URL and asks for goals, behavior changes, implementation, risks and test coverage, with evidence and the evaluated head SHA. The agent needs `gh` access on its machine. The prompt forbids edits/checkouts/GitHub writes and treats PR content as untrusted, but is not a sandbox. Sending shares context with the selected agent/provider. Cancel sends nothing. Uses the installed Gitview `json send` transport and its configuration; no notes are removed or changed.
- Refreshes once per minute, with a manual Refresh button. Filter searches the loaded PR titles, repository names and numbers.

## Limits and access

Uses `gh auth status --json hosts` with a safe field projection, `gh api graphql` against GitHub, `gh auth switch` on explicit account selection, `gh pr view --web` on explicit Open clicks, and a GraphQL `mergePullRequest` mutation through `pr-merge` only on explicit **Confirm merge** clicks. Merging changes the PR and its target branch; no PRs are merged automatically. Account/filter preference state is local to the mod copy; tokens remain managed by `gh`.

Assigned, Mine and Review load the 50 most recently updated matching PRs; Team follows all pages up to GitHub's 1,000-result search cap. Each group displays its total count; truncated results have an explicit limit notice. Each PR loads up to 100 CI contexts and marks incomplete successful-looking results as partial. GitHub search indexing can lag. GraphQL visibility depends on the account's repository access and org SSO authorization. Environment token overrides are detected by comparing the API viewer to the selected login. An auth/API failure shows an error and marks previous results stale.

## Validate

```sh
herdr-app check ~/.config/herdr-app/mods/pr-status
node --test ~/.config/herdr-app/mods/pr-status/*.test.mjs
```
