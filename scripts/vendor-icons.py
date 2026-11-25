#!/usr/bin/env python3
"""Reproduce bundled icons from a pinned Lucide revision, or verify them offline."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REVISION = "164efbaf879fb29f55d88047efd49fc7725f53ab"
BASE = f"https://raw.githubusercontent.com/lucide-icons/lucide/{REVISION}"
NAMES = {
    "chevron-down": "chevron-down", "chevron-right": "chevron-right",
    "file": "file", "folder": "folder", "changes": "file-diff",
    "win-close": "x", "win-max": "square", "win-min": "minus", "win-restore": "copy",
    "jira": "panels-top-left", "priority-highest": "chevrons-up", "priority-high": "chevron-up",
    "priority-medium": "minus", "priority-low": "chevron-down", "priority-lowest": "chevrons-down",
    "priority-unknown": "circle-question-mark", "x-16": "x", "diff": "file-diff", "agent": "bot",
    "check-16": "check", "git-pull-request-16": "git-pull-request", "skip-16": "circle-minus",
    "dot-fill-16": "circle-dot", "question-16": "circle-question-mark", "merge": "git-merge",
    "pull-request": "git-pull-request", "alert": "triangle-exclamation-point", "spinner": "loader-circle",
    "comment": "message-square",
}
MANIFEST = ROOT / "licenses/icon-manifest.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Download pinned SVGs and full license; otherwise verify offline")
    args = parser.parse_args()
    paths = sorted(ROOT.glob("*/mods/**/*.svg"))
    if args.refresh:
        # Download and validate everything before replacing any existing file.
        icons, downloads = [], {}
        for path in paths:
            name = NAMES[path.stem]
            url = f"{BASE}/icons/{name}.svg"
            if url not in downloads:
                with urlopen(url, timeout=30) as response:
                    downloads[url] = response.read()
                if b"<svg" not in downloads[url]:
                    raise ValueError(f"Not an SVG: {url}")
            icons.append({"path": path.relative_to(ROOT).as_posix(), "upstream": name, "url": url, "sha256": digest(downloads[url])})
        license_url = f"{BASE}/LICENSE"
        with urlopen(license_url, timeout=30) as response:
            license_data = response.read()
        for item in icons:
            (ROOT / item["path"]).write_bytes(downloads[item["url"]])
        (ROOT / "licenses/Lucide-LICENSE.txt").write_bytes(license_data)
        MANIFEST.write_text(json.dumps({"revision": REVISION, "license": {"path": "licenses/Lucide-LICENSE.txt", "url": license_url, "sha256": digest(license_data)}, "icons": icons}, indent=2) + "\n")
    manifest = json.loads(MANIFEST.read_text())
    if manifest["revision"] != REVISION:
        raise SystemExit("Manifest revision differs from the script's explicit pin")
    license_item = manifest["license"]
    if license_item["path"] != "licenses/Lucide-LICENSE.txt" or license_item["url"] != f"{BASE}/LICENSE":
        raise SystemExit("Unexpected license path or source URL")
    for item in manifest["icons"]:
        name = NAMES[Path(item["path"]).stem]
        if item["upstream"] != name or item["url"] != f"{BASE}/icons/{name}.svg":
            raise SystemExit(f"Unexpected upstream icon mapping: {item['path']}")
    expected = {item["path"] for item in manifest["icons"]}
    if len(expected) != len(manifest["icons"]):
        raise SystemExit("Duplicate paths in icon inventory")
    actual = {p.relative_to(ROOT).as_posix() for p in paths}
    if expected != actual:
        raise SystemExit(f"Icon inventory mismatch: {expected ^ actual}")
    for item in [manifest["license"], *manifest["icons"]]:
        if digest((ROOT / item["path"]).read_bytes()) != item["sha256"]:
            raise SystemExit(f"Hash mismatch: {item['path']}")
    print(f"PASS: {len(paths)} SVGs and Lucide license match the pinned inventory")


if __name__ == "__main__":
    main()
