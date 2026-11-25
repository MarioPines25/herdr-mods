# Review changes bundle

A Herdr Changes clone with diff-anchored review notes and Markdown review export.

Install mods/review-changes without overwriting an existing mod, check it, then open a tab or reference it from your personal layout. Requires Git on the space's machine.

Reads repository status/diffs and file content, watches local folders, and stores review notes in Herdr's local shared state (not exported). Explicit user actions can copy review text, commit changes, or discard a selected file's staged/unstaged edits after snapshot validation. Discard is destructive; read the full mod README before using it. Clipboard export uses macOS pbcopy, including for remotely viewed repositories.

Copied review Markdown includes the current repository path and machine name; redact that context before sharing if necessary. No live review notes, repository paths or Git state are bundled. See mods/review-changes/README.md for detailed behavior and root notices for inherited-code licensing.
