#!/usr/bin/env python3
"""Copy only exported mods to an isolated temporary home and run native checks.
No authenticated workflows are exercised. checking() guards must remain intact.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="herdr-export-check-") as directory:
    home = Path(directory)
    mods = home / "mods"
    mods.mkdir()
    sources = sorted(ROOT.glob("*/mods/*"))
    for source in sources:
        if source.is_dir():
            shutil.copytree(source, mods / source.name, ignore=shutil.ignore_patterns("gpui-kit.d.ts", "jsconfig.json", "node_modules", "__pycache__"))
    # Do not forward service tokens or the caller's CLI configuration home.
    allowed = ("PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "SystemRoot", "WINDIR")
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update({"HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / ".config"), "HERDR_APP_HOME": str(home)})
    for mod in sorted(mods.iterdir()):
        subprocess.run(["herdr-app", "check", str(mod)], env=env, check=True)
    print(f"PASS: {len(sources)} exported mods checked in a separate temporary home; no live-service integration claimed")
