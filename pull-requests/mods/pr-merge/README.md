# Confirm PR merge

Shared, dialog-only confirmation used by `pr-status` cards and `pr-review` modals. `mod.json` sets `place: none`; no layout block should refer to it. When installing a new mod, write this manifest before `main.js` to avoid the host's default right-panel docking. Callers pass `host`, `repo`, numeric `number`, `login`, reviewed `head`, optional `base`/`baseRef`; Herdr supplies `overlay`.

Opening performs only a read-only GraphQL query. The dialog uses GitHub/Primer light and dark surfaces independent of terminal colors: an icon-led header, PR title and author, blue source/target branch chips, and reviewed commit SHA. A merge-method selector offers **Create a merge commit** and **Squash and merge**, with descriptions. Repository-disabled methods are non-interactive. Merge commit remains the default when enabled; squash is selected when it is the only supported method. Rebase is not supported. Repositories disabling both supported methods show an error. An amber checkbox-style acknowledgment protects other authors' PRs. A fixed footer keeps the active account and green **Confirm merge** action visible, while a single bounded scroll area holds the details. Errors use a red alert; confirmed merges use GitHub's purple merged treatment. Loading/submission indicators animate natively rather than through redraw timers. During submission, method selection, acknowledgment controls and close/cancel actions are locked. Only **Confirm merge** can write. Cancel or Escape before confirming performs no mutation.

Any open non-draft PR may be merged here, regardless of author, assignment, review decision, CI or mergeability preflight. GitHub enforces all repository rules, checks, required reviews, conflicts and actual permissions. If the active account is not the author (or the author is unknown/deleted), an amber warning explicitly states **You are merging a pull request you did not author**, names the author and active account, and requires acknowledgment before Confirm merge appears. Acknowledgment is in-memory only and resets on every opening. It never substitutes for the final confirmation click.

Confirmation rechecks identity, reviewed head, base branch/SHA, write/maintain/admin permission and whether the selected method is still allowed. The mutation uses `expectedHeadOid` and an explicitly captured `mergeMethod` (`MERGE` or `SQUASH`); a disabled selection never silently falls back. Squash selection changes the final action to **Confirm squash and merge**. Commit titles/messages use GitHub defaults. No automatic retry, branch deletion, auto-merge, queueing, or admin bypass. A response must confirm the exact PR ID and `MERGED` before shared `github.mergedPRs` is updated. Uncertain responses warn the person to check GitHub before trying again. Dismissing an already-submitted request cannot undo it.

## Limits

GitHub atomically enforces the expected head and its own repository rules/permissions. Base revision preflight and mutation are separate requests: the base can change between them. `gh` resolves credentials per invocation: do not switch the active account or token during confirmation/submission; a switch between the final identity check and mutation cannot be atomically excluded. No credentials are read, copied or stored by the mod. Uses the installed `gh` CLI with a 45-second per-command timeout.

```sh
herdr-app check mods/pr-merge
node --test mods/pr-merge/*.test.mjs
```
