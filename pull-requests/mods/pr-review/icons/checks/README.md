# Current icon provenance

The current SVGs in this folder are unmodified Lucide assets, replacing the former Octicons/unknown-origin glyphs. See the root licenses/icon-manifest.json for exact file URLs, revision and SHA-256 hashes, and licenses/Lucide-LICENSE.txt for ISC and applicable Feather MIT terms.

The following historical source/color attribution is retained for context; it does not describe the replacement SVG files:

# GitHub CI status assets

These are original, unmodified 16px SVGs from GitHub's Primer Octicons (MIT):
https://github.com/primer/octicons/tree/68ec2de8d0ddfcbb7497da01d0b7d98eb5593020/icons

- `check-16.svg`: overall success
- `x-16.svg`: overall failure
- `dot-fill-16.svg`: pending/in progress
- `skip-16.svg`: no checks
- `question-16.svg`: incomplete/unknown results

Copyright and license: see LICENSE in this folder. Assets are bundled locally; rendering does not fetch GitHub assets.

Colors are Primer's standard light/dark `fgColor.success`, `fgColor.danger`, `fgColor.attention`, and `fgColor.muted`:
https://github.com/primer/primitives/blob/47736486bf67b2a14ba1ada61fa0f57af29bb875/src/tokens/functional/color/fgColor.json5

| Token | Light | Dark |
| --- | --- | --- |
| success | #1a7f37 | #3fb950 |
| danger | #d1242f | #f85149 |
| attention | #9a6700 | #d29922 |
| muted | #59636e | #9198a1 |

This uses the same assets and standard palette, not a claim to replicate every GitHub status variant or accessibility theme.
