import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = await readFile(new URL('../mods/review-changes/review.js', import.meta.url), 'utf8');
const { diffRows, repoKey, rowKey, sameAnchor, makeComment, reviewMarkdown, fileSnapshot, discardFile } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function executor(command, args, { cwd }) {
  try { return { code: 0, stdout: execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }; }
  catch (error) { return { code: error.status, stdout: error.stdout, stderr: error.stderr }; }
}
async function fixture(fn, committed = true) {
  const root = await mkdtemp(join(tmpdir(), 'herdr-review-test-'));
  try {
    git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Review Test'); git(root, 'config', 'user.email', 'test@example.invalid');
    if (committed) {
      await writeFile(join(root, 'tracked.txt'), 'original\n');
      await writeFile(join(root, 'other.txt'), 'other original\n');
      git(root, 'add', '.'); git(root, 'commit', '-qm', 'initial');
    }
    await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const discard = (root, path) => discardFile(executor, { root, path, on: null });

// Exercise the real panel's comment handlers with a minimal host, without
// touching the user's shared.json, repositories, or terminal input.
const panelSource = await readFile(new URL('../mods/review-changes/main.js', import.meta.url), 'utf8');
const helperUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mockHost = `
class View {}
const state = () => ({ text: '', on() {}, value() { return this.text; }, set_value(v) { this.text = v; }, focus() {} });
const InputState = { new: state }, TextareaState = { new: state };
const memory = {};
const shared = key => memory[key];
const setShared = (key, value) => { memory[key] = value; };
const spaces = () => [{ active: true, machine: null, folder: '/repo' }];
const focused = () => ({ cwd: '/repo' });
const panes = () => [];
const exec = () => { throw new Error('Unexpected exec in comment test'); };
const readTextFile = () => {}, watchFolder = () => {}, theme = () => {}, settings = () => ({});
`;
const panelModule = await import(`data:text/javascript;base64,${Buffer.from(
  `import { diffRows, repoKey, rowKey, sameAnchor, makeComment, lineLabel, reviewMarkdown, fileSnapshot, discardFile } from ${JSON.stringify(helperUrl)};\n` +
  mockHost + panelSource.replace(/^import .*;\n/gm, '')
).toString('base64')}`);
const cx = { focus_handle: () => ({ focus() {} }), timer: { every() {} }, spawn() {}, notify() {} };
function panel() {
  const view = new panelModule.default(); view.init({}, cx);
  view.root = '/repo'; view.on = null; view.loading = false; view.head = 'head'; view.open = 'a.js';
  view.rows = diffRows(['@@ -1 +1 @@', '-old', '+new']);
  return view;
}

test('panel saves, edits and shares comments, and isolates repository and machine', () => {
  const view = panel();
  view.selectLine(rowKey(view.open, view.rows[2]), cx);
  assert.ok(view.draft); view.commentInput.set_value('Review this.\nMore detail.'); view.saveComment(cx);
  assert.equal(view.draft, null); assert.equal(view.comments().length, 1);
  const other = panel(); assert.equal(other.comments()[0].body, 'Review this.\nMore detail.');
  other.selectLine(rowKey(other.open, other.rows[2]), cx); other.commentInput.set_value('Updated'); other.saveComment(cx);
  assert.equal(view.comments().length, 1); assert.equal(view.comments()[0].body, 'Updated');
  view.root = '/other'; assert.equal(view.comments().length, 0);
  view.root = '/repo'; view.on = 'remote'; assert.equal(view.comments().length, 0);
  view.on = null; assert.equal(view.comments().length, 1);
});

test('panel ignores hunk headers, empty comments, and stale diff-row events', () => {
  const view = panel(); view.storeComments([]);
  view.selectLine(rowKey(view.open, view.rows[0]), cx); assert.equal(view.draft, null);
  view.selectLine(rowKey('another.js', view.rows[2]), cx); assert.equal(view.draft, null);
  view.selectLine(rowKey(view.open, view.rows[2]), cx); view.commentInput.set_value('  '); view.saveComment(cx);
  assert.equal(view.comments().length, 0); assert.ok(view.draft);
});

test('copy sends complete review text directly to the clipboard, including remote context', () => {
  const view = panel(); view.on = 'remote';
  const comment = { ...makeComment(view.open, view.rows[2], view.rows, 'abc123'), body: 'Please reconsider.\nMore detail.' };
  view.storeComments([comment]);
  let clipboard;
  view.copyReview({ ...cx, write_to_clipboard(text) { clipboard = text; } });
  assert.equal(clipboard, reviewMarkdown('/repo', 'remote', [comment]));
  assert.ok(clipboard.includes('Machine: remote')); assert.ok(clipboard.includes('+new'));
  assert.ok(clipboard.includes('Please reconsider.\nMore detail.'));
  assert.equal(view.copiedReview, clipboard); assert.equal(view.note, null);
  view.storeComments([]); assert.equal(view.copiedReview, null);
});

test('copy refuses an unsaved draft instead of silently omitting feedback', () => {
  const view = panel();
  view.storeComments([{ ...makeComment(view.open, view.rows[2], view.rows, 'head'), body: 'Saved' }]);
  view.draft = makeComment(view.open, view.rows[1], view.rows, 'head');
  view.commentInput.set_value('Unsaved');
  view.copyReview({ ...cx, write_to_clipboard() { assert.fail('Must not overwrite clipboard'); } });
  assert.match(view.note, /Save or cancel/);
});

test('copy leaves the clipboard unchanged for empty reviews and stale repository contexts', () => {
  const view = panel(); view.storeComments([]);
  const clipboardCx = { ...cx, write_to_clipboard() { assert.fail('Must not overwrite clipboard'); } };
  view.copyReview(clipboardCx);
  view.storeComments([{ ...makeComment(view.open, view.rows[2], view.rows, 'head'), body: 'Saved' }]);
  view.context = 'stale'; view.copyReview(clipboardCx);
});

test('copy reports clipboard failures without claiming success', () => {
  const view = panel();
  view.storeComments([{ ...makeComment(view.open, view.rows[2], view.rows, 'head'), body: 'Saved' }]);
  view.copyReview({ ...cx, write_to_clipboard() { throw new Error('Unavailable'); } });
  assert.equal(view.copiedReview, null); assert.match(view.note, /Could not copy review: Error: Unavailable/);
});

test('diff comments preserve old/new line numbers and snippet context', () => {
  const rows = diffRows(['@@ -10,2 +10,3 @@', ' same', '-before', '+after', '+extra']);
  assert.deepEqual(rows.slice(1).map(r => [r.old, r.next]), [[10, 10], [11, undefined], [undefined, 11], [undefined, 12]]);
  const comment = makeComment('a.js', rows[2], rows, 'abc');
  assert.equal(comment.old, 11); assert.equal(comment.next, undefined);
  assert.ok(comment.context.includes('-before'));
  assert.ok(sameAnchor(comment, 'a.js', rows[2]));
  assert.ok(!sameAnchor(comment, 'b.js', rows[2]));
  assert.notEqual(rowKey('a.js', rows[2]), rowKey('a.js', { ...rows[2], text: 'edited' }));
  assert.notEqual(repoKey('/repo', null), repoKey('/repo', 'remote'));
});

test('Markdown export includes feedback, repo, HEAD, deleted lines, and safe code fences', () => {
  const rows = diffRows(['@@ -1 +1 @@', '-```', '+replacement']);
  const comment = { ...makeComment('file with spaces.js', rows[1], rows, 'abc123'), body: 'Please reconsider.\nSecond line.' };
  const output = reviewMarkdown('/repo', null, [comment]);
  assert.ok(output.includes('old line 1')); assert.ok(output.includes('abc123'));
  assert.ok(output.includes('Please reconsider.\nSecond line.')); assert.ok(output.includes('````\n'));
});

test('discard restores both staged and unstaged changes, leaving other files alone', () => fixture(async root => {
  await writeFile(join(root, 'tracked.txt'), 'staged\n'); git(root, 'add', 'tracked.txt');
  await writeFile(join(root, 'tracked.txt'), 'unstaged\n');
  await writeFile(join(root, 'other.txt'), 'keep this\n');
  await discard(root, 'tracked.txt');
  assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'original\n');
  assert.equal(git(root, 'diff', '--cached', '--', 'tracked.txt'), '');
  assert.equal(await readFile(join(root, 'other.txt'), 'utf8'), 'keep this\n');
}));

test('discard restores a staged deletion', () => fixture(async root => {
  git(root, 'rm', 'tracked.txt'); await discard(root, 'tracked.txt');
  assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'original\n');
}));

test('discard deletes staged new files, including unstaged edits', () => fixture(async root => {
  await writeFile(join(root, 'new.txt'), 'new\n'); git(root, 'add', 'new.txt');
  await writeFile(join(root, 'new.txt'), 'edited\n');
  await discard(root, 'new.txt');
  await assert.rejects(access(join(root, 'new.txt')));
  assert.equal(git(root, 'ls-files', '--', 'new.txt'), '');
}));

test('discard supports new staged files before the first commit', () => fixture(async root => {
  await writeFile(join(root, 'new.txt'), 'new\n'); git(root, 'add', 'new.txt');
  await discard(root, 'new.txt');
  await assert.rejects(access(join(root, 'new.txt')));
}, false));

test('discard deletes only the selected untracked file with literal pathspec characters', () => fixture(async root => {
  await writeFile(join(root, '[a].txt'), 'remove'); await writeFile(join(root, 'a.txt'), 'keep');
  await discard(root, '[a].txt');
  await assert.rejects(access(join(root, '[a].txt')));
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'keep');
}));

test('discard restores filenames with spaces, apostrophes, Unicode and leading dashes', () => fixture(async root => {
  for (const path of ["it's 中文.txt", '-option.txt']) {
    await writeFile(join(root, path), 'original'); git(root, 'add', '--', path); git(root, 'commit', '-qm', 'file');
    await writeFile(join(root, path), 'edited'); await discard(root, path);
    assert.equal(await readFile(join(root, path), 'utf8'), 'original');
  }
}));

test('discard refuses working edits made after confirmation', () => fixture(async root => {
  await writeFile(join(root, 'tracked.txt'), 'reviewed');
  const pending = { root, path: 'tracked.txt', on: null };
  pending.snapshot = await fileSnapshot(executor, pending);
  await writeFile(join(root, 'tracked.txt'), 'new agent edits');
  await assert.rejects(discardFile(executor, pending), /changed since confirmation/);
  assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'new agent edits');
}));

test('discard refuses index changes made after confirmation', () => fixture(async root => {
  await writeFile(join(root, 'tracked.txt'), 'reviewed');
  const pending = { root, path: 'tracked.txt', on: null };
  pending.snapshot = await fileSnapshot(executor, pending);
  git(root, 'add', 'tracked.txt');
  await assert.rejects(discardFile(executor, pending), /changed since confirmation/);
  assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'reviewed');
}));

test('discard accepts an unchanged confirmation snapshot', () => fixture(async root => {
  await writeFile(join(root, 'tracked.txt'), 'reviewed');
  const pending = { root, path: 'tracked.txt', on: null };
  pending.snapshot = await fileSnapshot(executor, pending);
  await discardFile(executor, pending);
  assert.equal(await readFile(join(root, 'tracked.txt'), 'utf8'), 'original\n');
}));

test('discard snapshots also protect new untracked files', () => fixture(async root => {
  await writeFile(join(root, 'new.txt'), 'reviewed');
  const pending = { root, path: 'new.txt', on: null };
  pending.snapshot = await fileSnapshot(executor, pending);
  await writeFile(join(root, 'new.txt'), 'new edits');
  await assert.rejects(discardFile(executor, pending), /changed since confirmation/);
  assert.equal(await readFile(join(root, 'new.txt'), 'utf8'), 'new edits');
}));

test('discard handles intent-to-add files without touching siblings', () => fixture(async root => {
  await writeFile(join(root, 'intent.txt'), 'new'); git(root, 'add', '-N', 'intent.txt');
  await discard(root, 'intent.txt');
  await assert.rejects(access(join(root, 'intent.txt')));
  assert.equal(await readFile(join(root, 'other.txt'), 'utf8'), 'other original\n');
}));

test('discard refuses files replacing committed directories', () => fixture(async root => {
  await mkdir(join(root, 'directory')); await writeFile(join(root, 'directory', 'keep.txt'), 'committed');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'directory');
  await rm(join(root, 'directory'), { recursive: true }); await writeFile(join(root, 'directory'), 'replacement');
  await assert.rejects(discard(root, 'directory'), /Directories/);
  assert.equal(await readFile(join(root, 'directory'), 'utf8'), 'replacement');
}));

test('discard refuses directories and submodules', () => fixture(async root => {
  await mkdir(join(root, 'directory')); await writeFile(join(root, 'directory', 'keep.txt'), 'keep');
  await assert.rejects(discard(root, 'directory/'), /Directories/);
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${git(root, 'rev-parse', 'HEAD').trim()},submodule`);
  await assert.rejects(discard(root, 'submodule'), /Submodules/);
  assert.equal(await readFile(join(root, 'directory', 'keep.txt'), 'utf8'), 'keep');
}));
