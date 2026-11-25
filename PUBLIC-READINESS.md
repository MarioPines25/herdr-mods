# Public-release checklist

## Completed in the staging export

- Exported nine custom mods into five bundles without modifying the running Herdr home.
- Excluded installed dependencies/binaries, runtime reset journals/locks, sessions, credentials, generated API type files, and Herdr state.
- Replaced local AI executable configuration with an ignored config.json plus config.example.json.
- Replaced the work Jira board/site with obvious setup placeholders and removed organization/team branding.
- Removed colleague names, work email addresses and team logins. The PR Team view defaults to the selected account until configured.
- Removed the layout's Gitview view dependency; review-changes now supplies its Changes view. Agent handoff still explicitly requires external Gitview transport.
- Added side-effect-free initialization guards for native checks.
- Repaired a stale copied Jira regression test and the usage test's exported layout path.
- Added setup guides, recipes, license inventory, and a conservative export scan.

## Required before public release

- [ ] Confirm the exact Herdr 0.1.14 source license/ownership and retain all required notices.
- [ ] Verify the complete icon attribution inventory. Lucide ISC and Feather MIT notices from the installed Herdr app are preserved in licenses/Lucide-Feather.txt.
- [ ] Resolve or replace the Jira logo, priority glyphs and undocumented PR icons.
- [ ] Owner chooses the license for original contributions; no blanket license was assumed.
- [ ] Capture sanitized UI previews for the five bundles. No screenshots from the live work environment were uploaded.
- [ ] Install the exported bundles in a separate Herdr home; configure real local paths/board/site and smoke-test all workflows. Native checks and fake tests do not prove live service integration.
- [ ] Re-run export scan, review the staged diff and inspect Git history before changing repository visibility.

## Scope of security checks

scripts/check-export.py is a conservative heuristic and known-private-identifier scan, not a certified secret detector or proof of absence of private information. It reports filenames and categories only. Configuration placeholders are intentional. Existing unit tests use synthetic data.
