import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class IconVerifierTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="icon-verifier-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        paths = [ROOT / "scripts/vendor-icons.py", ROOT / "licenses/icon-manifest.json", ROOT / "licenses/Lucide-LICENSE.txt", *ROOT.glob("*/mods/**/*.svg")]
        for source in paths:
            destination = self.root / source.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        self.manifest_path = self.root / "licenses/icon-manifest.json"
        self.manifest = json.loads(self.manifest_path.read_text())

    def run_check(self):
        return subprocess.run([sys.executable, str(self.root / "scripts/vendor-icons.py")], cwd=self.root, capture_output=True, text=True)

    def changed_manifest(self, expected):
        self.manifest_path.write_text(json.dumps(self.manifest))
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected, result.stderr + result.stdout)

    def test_valid_export(self):
        self.assertEqual(self.run_check().returncode, 0)

    def test_modified_svg(self):
        path = self.root / self.manifest["icons"][0]["path"]
        path.write_text(path.read_text() + "<!-- changed -->")
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Hash mismatch", result.stderr)

    def test_missing_inventory_entry(self):
        self.manifest["icons"].pop()
        self.changed_manifest("Icon inventory mismatch")

    def test_duplicate_entry(self):
        self.manifest["icons"].append(self.manifest["icons"][0])
        self.changed_manifest("Duplicate paths")

    def test_revision_change(self):
        self.manifest["revision"] = "unreviewed"
        self.changed_manifest("explicit pin")

    def test_source_change(self):
        self.manifest["icons"][0]["url"] = "https://example.invalid/icon.svg"
        self.changed_manifest("Unexpected upstream")

    def test_license_path_escape(self):
        self.manifest["license"]["path"] = "../outside"
        self.changed_manifest("Unexpected license path")


if __name__ == "__main__":
    unittest.main()
