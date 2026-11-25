#!/usr/bin/env python3
"""Build original, synthetic SVG previews. These are schematics, not UI screenshots."""
import argparse
import subprocess
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COLORS = {"canvas": "#11161d", "surface": "#1b232e", "muted": "#a3afbf", "text": "#e7edf5", "border": "#354052", "accent": "#79b7ff", "green": "#4ed078"}


def preview(bundle, title, subtitle, columns):
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img">', f'<title>{escape(title)} — synthetic schematic</title>', '<desc>Illustrative layout using invented data. Not a captured application frame.</desc>', f'<rect width="1200" height="720" rx="16" fill="{COLORS["canvas"]}"/>']
    def text(x, y, value, size=18, color="text"):
        parts.append(f'<text x="{x}" y="{y}" font-family="sans-serif" font-size="{size}" fill="{COLORS[color]}">{escape(value)}</text>')
    text(36, 50, title, 28)
    text(36, 84, subtitle, 16, "muted")
    gap = 20
    width = (1128 - (len(columns) - 1) * gap) / len(columns)
    for index, (heading, rows) in enumerate(columns):
        x = 36 + index * (width + gap)
        parts.append(f'<rect x="{x}" y="115" width="{width}" height="510" rx="12" fill="{COLORS["surface"]}" stroke="{COLORS["border"]}"/>')
        text(x + 20, 154, heading, 21, "accent")
        for row_index, row in enumerate(rows):
            text(x + 20, 202 + row_index * 43, row, 17, "text" if row_index % 2 == 0 else "muted")
    text(36, 666, "SYNTHETIC SCHEMATIC · Invented data · Not a screenshot or live integration test", 15, "muted")
    text(36, 696, "Personal Herdr mods · Colors and proportions are illustrative", 14, "muted")
    parts.append('</svg>')
    (ROOT / bundle / "preview.svg").write_text("\n".join(parts) + "\n")


preview("ai-usage", "AI usage", "Compact allowance strip + detailed provider cards", [
    ("Codex", ["5-hour remaining: 82%", "Weekly remaining: 64%", "Reset time from provider", "Eligible credit → confirm", "Cancel without spending"]),
    ("Copilot", ["Premium remaining: 75%", "Chat: unlimited (if reported)", "Completions: provider allowance", "Unknown allowance: —", "Refresh / Details"]),
])
preview("files-icons", "Files icons", "Lazy directory tree + native file preview", [
    ("Files", ["▾ example-project", "  ▾ src", "      app.ts", "      theme.ts", "  ▸ tests", "    README.md"]),
    ("app.ts", ["export function greet() {", "  return 'Hello';", "}", "", "Select a file to preview", "Follows the focused folder"]),
])
preview("jira-workspace", "Jira workspace", "Workspace chrome, terminals, Jira sprint panel and optional review panels", [
    ("Spaces / agents", ["example-project", "  feature-example", "Working · native spinner", "Blocked · status dot", "Done · status dot", "Idle · no activity dot", "Pull requests"]),
    ("Terminal workspace", ["AI usage strip", "Tabs · AI / Jira toggles", "", "$ git status", "On branch feature-example", "", "Files / Changes panels"]),
    ("Sprint panel", ["Active / Future", "Assigned to me", "EXAMPLE-101 · Add view", "Status: In progress", "Priority: High", "Story points: 3", "Explicit save to edit"]),
])
preview("pull-requests", "Pull requests", "Inbox → review → explicit comment, handoff or merge confirmation", [
    ("PR inbox", ["Assigned / Opened / Team", "example/repository", "#42 · Add preferences view", "feature → main", "CI: passing", "Review / Agent / Merge"]),
    ("Review", ["Files / Checks / Comments", "+ const enabled = true;", "- const enabled = false;", "Select a diff line", "Write review comment", "Explicit submit"]),
    ("Confirm merge", ["Revalidate PR identity", "Revalidate revision", "Choose permitted method", "Respect branch protection", "Cancel / Confirm", "No automatic merge"]),
])
preview("review-changes", "Review changes", "Local Git diff, anchored notes, Markdown export and guarded discard", [
    ("Changes", ["M src/app.ts    +4 −2", "M README.md     +1 −0", "", "Commit message…", "Explicit Commit", "Discard → confirmation"]),
    ("Diff / notes", ["@@ app.ts @@", "+ const visible = true;", "Review note on selected line", "Save / Edit / Delete note", "Copy review Markdown", "Unsaved draft blocks copy"]),
])
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--png", action="store_true", help="Also rasterize with macOS sips")
args = parser.parse_args()
if args.png:
    for bundle in ["ai-usage", "files-icons", "jira-workspace", "pull-requests", "review-changes"]:
        subprocess.run(["sips", "-s", "format", "png", str(ROOT / bundle / "preview.svg"), "--out", str(ROOT / bundle / "preview.png")], check=True, stdout=subprocess.DEVNULL)
print("Built five synthetic previews; no live data was read")
