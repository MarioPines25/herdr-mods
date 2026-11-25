import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundles = ['ai-usage', 'files-icons', 'jira-workspace', 'pull-requests', 'review-changes'];
const read = path => readFileSync(resolve(root, path));
const hash = data => createHash('sha256').update(data).digest('hex');
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]);
}

test('every bundled SVG glyph has an exact pinned source and verified hash', () => {
  const inventory = JSON.parse(read('licenses/icon-manifest.json'));
  const actual = bundles.flatMap(bundle => walk(resolve(root, bundle, 'mods')))
    .filter(path => path.endsWith('.svg')).map(path => relative(root, path)).sort();
  assert.deepEqual(inventory.icons.map(item => item.path).sort(), actual);
  for (const item of [...inventory.icons, inventory.license]) {
    assert.equal(new URL(item.url).origin, 'https://raw.githubusercontent.com');
    assert.ok(item.url.includes('/lucide-icons/lucide/' + inventory.revision + '/'));
    assert.equal(hash(read(item.path)), item.sha256, item.path);
  }
});

test('displayed SVG previews are labeled synthetic; supplemental PNGs have expected dimensions', () => {
  for (const bundle of bundles) {
    const svg = read(bundle + '/preview.svg').toString();
    assert.ok(svg.includes('SYNTHETIC SCHEMATIC'));
    assert.ok(svg.includes('Not a screenshot or live integration test'));
    assert.ok(read(bundle + '/RECIPE.md').toString().includes('(preview.svg)'));
    const png = read(bundle + '/preview.png');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 720);
  }
});

test('each installable mod carries local Lucide notices and source mappings', () => {
  for (const bundle of bundles) {
    for (const entry of readdirSync(resolve(root, bundle, 'mods'))) {
      const mod = bundle + '/mods/' + entry;
      assert.ok(read(mod + '/NOTICE.md').toString().includes('licenses/Lucide-LICENSE.txt'));
      assert.equal(hash(read(mod + '/licenses/Lucide-LICENSE.txt')), hash(read('licenses/Lucide-LICENSE.txt')));
      const inventory = JSON.parse(read(mod + '/licenses/lucide-icons.json'));
      for (const item of inventory.icons) assert.equal(hash(read(mod + '/' + item.path)), item.sha256);
    }
  }
});

test('inherited source has exact license provenance and modification notices', () => {
  const source = JSON.parse(read('licenses/herdr-source.json'));
  assert.equal(source.commit, '2405bf388c568c3ed479f05b8e405ccfa44b3f2c');
  assert.equal(hash(read('licenses/Herdr-Apache-2.0.txt')), source.license_sha256);
  for (const path of ['files-icons/mods/files-icons/mod.json', 'jira-workspace/mods/jira-tabs/mod.json', 'review-changes/mods/review-changes/mod.json', 'jira-workspace/layouts/jira-workspace.json']) {
    assert.match(JSON.parse(read(path)).modification_notice, /Modified personal derivative/);
  }
});

test('bundled licenses preserve Lucide/Feather and Marked/Markdown notices', () => {
  const lucide = read('licenses/Lucide-LICENSE.txt').toString();
  assert.match(lucide, /ISC License/);
  assert.match(lucide, /Cole Bemis/);
  const marked = read('jira-workspace/mods/jira-sprint/vendor/marked.LICENSE.md').toString();
  assert.match(marked, /John Gruber/);
  assert.match(marked, /Permission is hereby granted/);
});
