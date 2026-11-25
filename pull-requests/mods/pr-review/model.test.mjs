import test from 'node:test';
import assert from 'node:assert/strict';
import { targetFrom, diffRows, patchNotice, sameRevision, previewFile } from './model.js';

test('extracts github.com and enterprise PR targets without requiring checkout', () => {
  assert.deepEqual(targetFrom({url: 'https://github.com/org/repo/pull/42'}), {host:'github.com',repo:'org/repo',number:42});
  assert.equal(targetFrom({url: 'https://git.example.com/org/repo/pull/7/'}).host, 'git.example.com');
  for (const url of ['http://github.com/org/repo/pull/42', 'https://github.com/org/repo/issues/1', 'https://u:p@github.com/org/repo/pull/1']) assert.throws(() => targetFrom({url}));
});
test('maps both line numbers through additions, removals and multiple hunks', () => {
  const rows = diffRows('@@ -5,2 +5,2 @@\n same\n-old\n+new\n@@ -20,0 +21,1 @@\n+added\n\\ No newline at end of file');
  assert.deepEqual(rows[1], {kind:' ',old:5,next:5,text:' same'});
  assert.deepEqual(rows[2], {kind:'-',old:6,text:'-old'});
  assert.deepEqual(rows[3], {kind:'+',next:6,text:'+new'});
  assert.deepEqual(rows[5], {kind:'+',next:21,text:'+added'});
  assert.equal(rows[6].kind, '@');
});
test('handles omitted line counts and deleted files', () => {
  assert.deepEqual(diffRows('@@ -1 +0,0 @@\n-x')[1], {kind:'-',old:1,text:'-x'});
});
test('labels omitted and partial patches rather than claiming complete coverage', () => {
  assert.match(patchNotice({}), /No text patch/);
  assert.match(patchNotice({patch:'@@ -1 +1 @@\n-a\n+b', additions:2,deletions:1}), /Partial patch/);
  assert.match(patchNotice({patch:'@@ -1 +1 @@\n-a\n+b', additions:1,deletions:1}), /GitHub-provided/);
});
test('bounds retained patch bytes and synchronous parsing work', () => {
  const file = {filename:'a',patch:'+ok',additions:1,deletions:0};
  assert.equal(previewFile(file), file);
  for (const f of [previewFile(file, 1), previewFile({...file,patch:'x'.repeat(500_001)}), previewFile({...file,patch:'\n'.repeat(20_000)})]) {
    assert.equal(f.patch, undefined);
    assert.match(patchNotice(f), /preview limit/);
    assert.equal(f.filename, 'a');
  }
});

test('rejects snapshots when either branch or file count changes', () => {
  const a = {head:{sha:'head'},base:{sha:'base'},changed_files:2};
  assert.equal(sameRevision(a, structuredClone(a)), true);
  for (const b of [{...a,head:{sha:'new'}}, {...a,base:{sha:'new'}}, {...a,changed_files:3}]) assert.equal(sameRevision(a,b), false);
});
