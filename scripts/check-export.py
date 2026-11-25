#!/usr/bin/env python3
"""Conservative staging hygiene scan. Never prints matched values; not a complete secret detector."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "GitHub credential": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "provider API credential": re.compile(r"\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "credential URL": re.compile(r"https?://[^/\s:@]+:[^/\s@]+@"),
    "personal home path": re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/"),
}
EXCLUDED_NAMES = {"config.json", ".reset-attempt.json", ".env", "shared.json", "view.json", "window.json", "windows.json", "gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json"}
problems = []
count = 0
# Scan tracked files (even force-added ignored ones) and non-ignored new files.
# Native checks regenerate ignored type metadata; those files are not part of an export.
listed = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
for name in sorted(set(listed.decode().split("\0")) - {""}):
    rel = Path(name)
    path = ROOT / rel
    if path.is_symlink():
        problems.append((rel, "symlink: inspect target manually"))
        continue
    if not path.is_file():
        continue
    count += 1
    if path.name in EXCLUDED_NAMES or any(part in {"node_modules", "__pycache__", ".reset-lock", ".state"} for part in rel.parts):
        problems.append((rel, "local/generated/runtime file"))
    if path.stat().st_size > 1_000_000:
        problems.append((rel, "large file: inspect before committing"))
    # Test fixtures intentionally contain invalid credential URLs. Do not exempt
    # fixtures from actual token, private-key or personal-path scans.
    text = path.read_text(errors="replace")
    for category, pattern in PATTERNS.items():
        if category == "credential URL" and (path.name.endswith(".test.mjs") or path == Path(__file__).resolve()):
            continue
        if pattern.search(text):
            problems.append((rel, category))
for rel, reason in problems:
    print(f"FAIL {rel}: {reason}")
if problems:
    raise SystemExit(1)
print(f"PASS: {count} files checked; no configured pattern matched. Manual review and license clearance still required.")
