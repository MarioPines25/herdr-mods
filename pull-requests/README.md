# Pull requests bundle

Install all four mods together: pr-status, pr-agent, pr-review, pr-merge. Their sibling README files describe review limits, safety checks, and explicit write actions.

Requires Herdr, GitHub CLI `gh` with your own login, and access to the PR repositories. No account credentials are included. The optional Team inbox uses the WHITE_WALKERS list in pr-status/model.js; empty defaults to the currently selected account. Add only GitHub logins you intend to query; emails are unnecessary. The internal whiteWalkers key remains for compatibility.

Run native checks on each folder, then open pr-status as a tab or pane. The example workspace layout embeds the compact sidebar.

## External dependency

**Send to agent** requires Gitview's executable/transport and its local mods/gitview/config.json, with bin and optionally hc/herdr_app paths. Gitview is not bundled here. Install/configure it separately before using this action. The inbox, reviewer and merge dialog do not require Gitview to browse/review/merge PRs.

## Access and actions

gh reads account status, PRs, diffs, comments and checks through GitHub APIs. Selecting a different account explicitly runs gh auth switch and affects the active CLI account globally. Explicit actions can post general/inline comments, approve PRs, or merge with confirmation; those writes affect GitHub. Merge guards verify identities and revisions and do not bypass branch protection. Agent handoff sends PR context to the selected terminal/provider, optionally with immediate submit, only after user selection. Browser actions use gh pr view --web.

No live PR snapshots, user emails or team lists are committed. Some icon provenance remains unresolved; do not redistribute publicly until cleared.
