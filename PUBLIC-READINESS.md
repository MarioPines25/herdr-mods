# Public-readiness checklist

**Status: public repository, release clearance still incomplete.** The owner made the repository public before all release items were resolved. This checklist distinguishes completed technical work from unverified rights and live workflows.

## Completed

- [x] Export nine mods into five documented bundles without modifying the running Herdr home.
- [x] Exclude credentials, sessions, installed dependencies/binaries, reset journals/locks, generated API files and Herdr state.
- [x] Provide ignored local AI configuration and a sanitized config.example.json.
- [x] Replace work Jira board/site settings with setup placeholders; remove colleague identities and organization/team branding.
- [x] Document the external Gitview agent-handoff dependency; remove Gitview from the example layout's Changes view.
- [x] Add check-safe initialization, setup guides and mod recipes.
- [x] Replace **all 43 current bundled mod SVGs** with pinned Lucide assets, including the Jira mark and previously undocumented PR/priority icons.
- [x] Preserve the complete pinned Lucide ISC/Feather MIT license; verify a per-file source/hash manifest offline.
- [x] Retain Marked/Markdown and Primer-related notices; document current versus historical asset provenance.
- [x] Verify Herdr v0.1.14's exact official source commit and Apache-2.0 license, preserve a hashed provenance record, and mark changed inherited JS/JSON files.
- [x] Package licenses, asset manifests and NOTICE.md inside each installable mod; verify those copies offline.
- [x] Add five sanitized PNG/SVG previews, explicitly labeled **synthetic schematics**, with no live account/work data. Recipes display canonical SVGs; CI regenerates and compares them. Supplemental PNGs were rendered locally, not treated as screenshots.
- [x] Copy all nine exported mods into a separate temporary Herdr home and pass native checks with Herdr 0.1.18.
- [x] Pass 163 Node fake-provider/safety/unit/packaging tests plus seven Python icon-verifier regression tests.
- [x] Pass scripts/check-export.py and Gitleaks 8.30.1 scans of the working tree and existing Git history (redacted output, no findings).
- [x] Add reproducible checks and a read-only GitHub Actions workflow for offline tests, icon integrity and export hygiene.

## Remaining rights / owner decisions

- [ ] Owner selects a license for original contributions. No blanket license is silently assumed.
- [ ] Resolve provenance of the replaced assets in initial commit 9e22082, or explicitly authorize a history cleanup. Current replacements do not remove historical versions; history has not been rewritten.

## Remaining live verification

- [ ] Configure local paths and a test Jira board/site in an isolated home, then exercise real UI/service workflows. Native checks and mocks do not prove authenticated integration.
- [ ] Manually verify previewed UI behavior, including new SVG sizing and window-control affordances, in a non-work test environment.
- [ ] If publishing a polished Herdr gallery entry, replace/supplement schematic previews with sanitized real screenshots and add the appropriate repository topics only after release clearance.

Do not test destructive workflows on work repositories/PRs/issues or spend real credits simply to complete this checklist. Confirm the intended test accounts and resources first.

## Reproducible technical checks

```sh
find . -name '*.test.mjs' -not -path '*/node_modules/*' -print0 | xargs -0 node --test
python3 scripts/vendor-icons.py
python3 scripts/package-notices.py --check
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-export.py
python3 scripts/check-native.py  # requires local Herdr; temporary home, checking() mode
git diff --check
# Optional installed secret scanner:
gitleaks git --redact --no-banner --log-opts=--all .
gitleaks dir --redact --no-banner .
```

Regenerate synthetic artwork with `python3 scripts/build-previews.py --png` (PNG rasterization uses macOS sips). Offline CI does not invoke authenticated services or install a native Herdr app.

## Scope and limits

The export scan is a conservative heuristic, not proof that private information is absent. Gitleaks is also not a guarantee. No scanner establishes redistribution rights. Generated previews are illustrations, not screenshots or integration-test evidence. Successful isolated checks did not launch interactive UI workflows or perform any authenticated writes.
