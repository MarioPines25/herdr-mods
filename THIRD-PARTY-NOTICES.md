# Third-party provenance

## Herdr-derived code

The files-icons, jira-tabs and review-changes mod manifests record clones of Herdr files, tabs and changes at version 0.1.14. The example workspace layout was adapted from Herdr main. Modified source entry points contain change notices.

The official upstream v0.1.14 tag resolves to commit `2405bf388c568c3ed479f05b8e405ccfa44b3f2c`. Its root license is Apache-2.0 and is byte-identical to the preserved [licenses/Herdr-Apache-2.0.txt](licenses/Herdr-Apache-2.0.txt). Exact source paths, license URL and SHA-256 are recorded in [licenses/herdr-source.json](licenses/herdr-source.json).

Primary sources:
- https://github.com/herdrdev/herdr-app/tree/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults
- https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/LICENSE

Apache-2.0 permits modified derivatives subject to its conditions. Modified inherited JS files have change headers; the three clone manifests and example layout have explicit modification_notice metadata. Applicable notices are retained. Upstream's license/inspected source does not name a copyright holder/year; this repository does not invent one or infer ownership from commit authorship.

## Current bundled SVG glyphs: Lucide / Feather

Every SVG under a bundle's mods/ tree is now an **unmodified Lucide SVG**, fetched from revision `164efbaf879fb29f55d88047efd49fc7725f53ab`:

- Source: https://github.com/lucide-icons/lucide/tree/164efbaf879fb29f55d88047efd49fc7725f53ab/icons
- Exact per-file paths, URLs and SHA-256 hashes: [licenses/icon-manifest.json](licenses/icon-manifest.json).
- Complete license from that revision, including ISC and applicable Feather MIT terms/attribution: [licenses/Lucide-LICENSE.txt](licenses/Lucide-LICENSE.txt).
- Each installable mod carries local license/manifest copies and a NOTICE.md so attribution travels with it; verify with `python3 scripts/package-notices.py --check`.
- Herdr's older Lucide/Feather notice is also retained in [licenses/Lucide-Feather.txt](licenses/Lucide-Feather.txt).

This includes the former Jira logo (now a neutral panel icon), priority glyphs, PR glyphs, file-tree glyphs, Changes glyph and window-control glyphs. Local filenames preserve mod asset references; the manifest identifies the upstream names.

Offline verification: `python3 scripts/vendor-icons.py`. Reproduction from the pinned upstream requires network access: `python3 scripts/vendor-icons.py --refresh`. These commands do not fetch a floating latest version.

SVG workspace/preview schematics outside mods/ are repository-generated artwork, not Lucide glyphs. Their source generator is scripts/build-previews.py. Their original-contribution license remains subject to the owner's decision.

## Marked v15.0.12 / Markdown

jira-workspace/mods/jira-sprint/vendor/marked.js retains its adjacent marked.LICENSE.md. Preserve both the Marked MIT text and John Gruber's Markdown conditions/disclaimer.

Source license: https://github.com/markedjs/marked/blob/v15.0.12/LICENSE.md

## Primer colors and historical Octicons attribution

PR UI color modules retain their existing Primer source attribution. The adjacent licenses/READMEs in pr-status/icons and pr-review/icons/checks are kept for historical Octicons/color provenance. The **current SVGs are Lucide**, not Octicons; the root icon manifest is authoritative for current glyphs.

## Runtime-provided assets

Some mods reference Herdr's installed icons/fonts (for example Codex/Copilot program icons). Those files are not bundled in this repository; Herdr supplies them at runtime. Gitview agent transport is an optional external dependency, not redistributed here.

## Git history

Initial commit `9e22082` contains the former Jira mark and other SVGs whose provenance was not established. Replacing HEAD does not remove those versions from Git history or prove their rights. History has **not** been rewritten. Resolve those sources or obtain explicit owner approval for a history cleanup; a force-push also cannot retract existing clones.

This inventory describes evidence and outstanding work, not a legal opinion or a blanket license.
