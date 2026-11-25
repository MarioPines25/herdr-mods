# Changes with review comments

Personal copy of Herdr's Changes panel, used by `layouts/jira-workspace.json` in the existing `changes` block. The shipped `mods/changes` is untouched.

## Review after the agent finishes

1. Open **Changes**, select a file, and click a numbered diff line (the hollow circle in the gutter is the add-comment affordance).
2. Write your feedback and click **Save comment**. Enter inserts a new line in the editor.
3. Commented lines get a dot. Saved comments appear below the diff, with **Edit** and **Delete** actions.
4. Click **Copy for agent**, then paste into your agent's chat. This copies all saved comments, file/line locations, reviewed HEAD and diff snippets as Markdown. Save or cancel any open draft first. Nothing is sent to terminals automatically.

Saved comments live in Herdr shared state under `review-changes.comments.v1`, scoped by machine and Git worktree root. They include the original old/new line number, reviewed HEAD, and a short diff snippet. They survive refreshes and restarts. Unsaved drafts do not survive a repository switch or reload.

Comments are not automatically relocated when the code changes. A marker is only shown when the original path, line number, side and line text still match; the comment list and clipboard text always retain the original review location and context. Verify locations against the current code. Delete old comments when starting a new review if they no longer apply.

The button uses Herdr's native clipboard API on this computer, including when reviewing a remote repository. No export file or external clipboard program is needed. The button shows **Copied!** after success; copy again after editing comments. Existing files from earlier exports are left untouched.

## Discard one file

Use **Discard** beside the file and then **Confirm discard**. The panel snapshots the file contents, index and HEAD when opening the confirmation, and refuses the discard if that snapshot has changed. Stop agents editing the file first: the final check and Git operation are not a lock against simultaneous writes. This operation is destructive and does not create a backup:

- Files present in HEAD: restore both index and working tree to HEAD.
- New staged files: remove from index and working tree.
- New untracked files: delete only the selected file.
- Directories and submodules: refused; no recursive cleaning or reset.

The inherited commit action is labeled **Commit all**: it stages and commits the entire repository, not just reviewed files. Partial diff previews show a warning when row, file-size or line-length limits are reached.

Git commands use literal pathspecs and argument arrays, including for filenames containing spaces, Unicode or glob characters. Reviews remain saved even after a file is discarded.

## Checks

```sh
herdr-app check ~/.config/herdr-app/mods/review-changes
node --test ~/.config/herdr-app/tests/review-changes.test.mjs
```

The tests operate only in disposable temporary Git repositories and an in-memory mock of Herdr shared state. The personalized copy does not automatically receive upstream Changes-panel updates.
