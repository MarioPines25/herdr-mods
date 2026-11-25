# Personal Herdr mods

A public collection of nine personal [Herdr](https://herdr.dev) mods, organized into five installable bundles. This repository contains sanitized source exports, not the running app's configuration or state.

**Release clearance is still incomplete.** Current SVG assets have pinned license provenance, the exact Herdr v0.1.14 source license is verified, and technical checks pass. A license for original work, historical asset versions and authenticated smoke tests remain open. See [PUBLIC-READINESS.md](PUBLIC-READINESS.md).

Each bundle includes a labeled synthetic preview; recipes display the reproducible SVG, with a supplemental PNG. These are illustrations with invented data, not screenshots of real accounts. Each mod carries its own third-party notices when installed independently.

| Bundle | Mods | Purpose |
|---|---|---|
| [AI usage](ai-usage/README.md) | `ai-usage` | Codex and Copilot allowance, reset credits |
| [Files icons](files-icons/README.md) | `files-icons` | File browser with file-type icons |
| [Jira workspace](jira-workspace/README.md) | `jira-sprint`, `jira-tabs` | Sprint panel, issue editor and workspace tabs |
| [Pull requests](pull-requests/README.md) | `pr-status`, `pr-agent`, `pr-review`, `pr-merge` | PR inbox, review, comments, agent handoff and confirmed merges |
| [Review changes](review-changes/README.md) | `review-changes` | Local Git changes with review notes |

## Installation

Requires Herdr with its native mod API (sources were cloned against Herdr 0.1.14). macOS is the primary target; some URL-opening and clipboard actions use macOS commands. A passing native check is not a cross-platform compatibility guarantee.

1. Read the selected bundle's README and source, especially its external commands and write actions.
2. Copy its `mods/<name>` folders into your Herdr app home (normally `~/.config/herdr-app/mods/`). **Never overwrite an existing mod.** If a name exists, rename the incoming folder and update all its asset paths, cross-mod references and self-opening overlay names first.
3. Configure executable paths and service settings locally as described in the bundle README. Authenticate the CLIs yourself. Do not put credentials in this repository.
4. Run `herdr-app check ~/.config/herdr-app/mods/<name>` for each installed mod.
5. Open a panel with `herdr-app do tab.new '{"name":"Pull requests","mod":"pr-status"}'`, or attach it to a personal cloned layout.

The optional `jira-workspace/layouts/jira-workspace.json` references **all five bundles** and standard Herdr mods. Install all nine custom mods before copying/switching to that layout. It does not include Gitview's code; the exported Changes panel uses `review-changes`. Layout filenames must not collide either. `pr-agent` separately requires a working Gitview installation for its terminal-send transport.

## Security and side effects

Mods are trusted native scripts, not sandboxed plugins. They can read files, execute programs and access the network. See each bundle's README for details. In particular, explicit user actions can edit Jira issues, post GitHub comments/reviews, merge PRs, redeem a Codex reset credit, commit Git changes, or discard local file changes. Nothing in this repo supplies credentials; CLI authentication remains local.

## Development checks

Node.js and Git are required for the fake-provider/unit tests. From this repository:

```sh
find . -name '*.test.mjs' -print0 | xargs -0 node --test
python3 scripts/vendor-icons.py
python3 scripts/package-notices.py --check
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-export.py
python3 scripts/check-native.py  # installed Herdr; uses an isolated temporary home
```

The tests do not spend real credits, edit real Jira issues, or change live GitHub PRs. Native checks skip background service queries. Full UI and authenticated service testing must be done separately. GitHub Actions runs the offline tests, icon hash verification and export hygiene checks; it does not claim native UI/service integration.

To regenerate illustrative previews: `python3 scripts/build-previews.py --png` (PNG generation requires macOS `sips`). To reproduce bundled SVGs from their pinned source: `python3 scripts/vendor-icons.py --refresh` (network access required). Run `python3 scripts/package-notices.py` after intentional asset/license updates so per-mod notice copies stay synchronized.

## License

No blanket license has been selected for this collection. Existing third-party notices remain applicable. See [LICENSE.md](LICENSE.md) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
