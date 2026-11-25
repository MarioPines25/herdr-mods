# AI usage bundle

Codex five-hour/weekly allowance, Copilot premium allowance, and a confirmed Codex reset-credit workflow. See mods/ai-usage/README.md for behavior and recovery safety.

## Setup

1. Install Node.js (tested with Node 24), a signed-in Copilot CLI, and Herdr.
2. Copy mods/ai-usage without overwriting an existing mod.
3. In the installed mod, copy config.example.json to config.json and set absolute paths to Node, Copilot, and the Copilot SDK bundled with that CLI.
4. Run `npm ci` in the mod's runtime directory. The included lockfile pins the private Codex CLI dependency; no binaries are committed.
5. The example Codex native binary path is for Apple Silicon macOS. On another platform, inspect the installed package and set the correct binary path. Copilot SDK compatibility must be verified with the installed CLI.
6. Authenticate the configured CLIs locally, then run the native check.
7. Open as a mod tab, or use the optional all-bundles workspace layout for the 64px top strip and AI usage toggle.

## Access and actions

Runs local Node/Codex/Copilot processes. Usage reads contact provider services using each CLI's signed-in identity. Explicitly confirmed reset redemption spends a real credit. The reset journal stores account/credit IDs and recovery receipts locally and is ignored by Git; never delete it to bypass an uncertain operation. Opening provider pages uses macOS `open`.

The top-strip test reads the example layout in the adjacent jira-workspace bundle; keep the repository structure when running tests.
