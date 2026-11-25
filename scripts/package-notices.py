#!/usr/bin/env python3
"""Make third-party notices travel with each installable mod, or verify copies."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Verify without writing')
args = parser.parse_args()
inventory = json.loads((ROOT / 'licenses/icon-manifest.json').read_text())
errors = []


def supply(path, content):
    if args.check:
        if not path.is_file() or path.read_bytes() != content:
            errors.append(str(path.relative_to(ROOT)))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


mods = sorted(ROOT.glob('*/mods/*'))
for mod in mods:
    if not mod.is_dir():
        continue
    prefix = mod.relative_to(ROOT).as_posix() + '/'
    icons = [{**item, 'path': item['path'][len(prefix):]} for item in inventory['icons'] if item['path'].startswith(prefix)]
    # Include even in pr-agent: its bundle uses the sibling PR glyphs.
    supply(mod / 'licenses/Lucide-LICENSE.txt', (ROOT / 'licenses/Lucide-LICENSE.txt').read_bytes())
    local = {'revision': inventory['revision'], 'license': {**inventory['license'], 'path': 'licenses/Lucide-LICENSE.txt'}, 'icons': icons}
    supply(mod / 'licenses/lucide-icons.json', (json.dumps(local, indent=2) + '\n').encode())
    text = '# Notices for this installed mod\n\n'
    text += 'Current local SVG glyphs are unmodified pinned Lucide assets. Full ISC and applicable Feather MIT notices are in licenses/Lucide-LICENSE.txt; exact source URLs and hashes are in licenses/lucide-icons.json.\n\n'
    metadata = json.loads((mod / 'mod.json').read_text())
    clone = metadata.get('cloned_from')
    if clone:
        text += f"Modified derivative of Herdr {clone['name']} {clone['version']}. See licenses/Herdr-Apache-2.0.txt and licenses/herdr-source.json for exact upstream source/license provenance. Do not invent a copyright holder where upstream supplies none.\n\n"
        for name in ['Herdr-Apache-2.0.txt', 'herdr-source.json']:
            supply(mod / 'licenses' / name, (ROOT / 'licenses' / name).read_bytes())
    if mod.name == 'jira-sprint':
        text += 'Vendored Marked/Markdown retains both sets of terms in vendor/marked.LICENSE.md. The jira.svg filename now contains a neutral panel glyph, not the Jira trademark.\n\n'
    if mod.name.startswith('pr-'):
        text += 'Primer color-source attribution and any historical Octicons licenses remain applicable where present. Current SVG glyphs are Lucide, not Octicons.\n\n'
    text += 'Original contributions have not yet received an owner-selected redistribution license. Upstream licenses do not automatically license the owner\'s new code.\n\nRepository: https://github.com/MarioPines25/herdr-mods\n'
    supply(mod / 'NOTICE.md', text.encode())
if errors:
    raise SystemExit('Notice copies missing or stale: ' + ', '.join(errors))
print(f"PASS: notices {'verified' if args.check else 'packaged'} for {len(mods)} installable mods")
