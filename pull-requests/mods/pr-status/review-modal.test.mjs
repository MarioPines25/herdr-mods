import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PullRequests', 'class PullRequests') + '\nPullRequests;';

test('details-card Merge only opens confirmation with the exact account and head', () => {
  const overlays = [];
  const PullRequests = vm.runInNewContext(source, {
    View: class {}, openOverlay: spec => overlays.push(spec), canMerge: () => true,
    exec() { assert.fail('Opening confirmation must never mutate GitHub'); },
  });
  const view = new PullRequests();
  view.selected = {host:'github.com',login:'me'};
  view.merge({id:'PR_1',number:42,headRefOid:'abc123',baseRefName:'main',repository:{nameWithOwner:'org/repo'}});
  assert.equal(overlays.length,1);
  assert.equal(overlays[0].mod,'pr-merge'); assert.equal(overlays[0].kind,'dialog');
  assert.equal(overlays[0].modal,true);
  assert.equal(overlays[0].props.head,'abc123'); assert.equal(overlays[0].props.login,'me');
  assert.equal(overlays[0].props.repo,'org/repo'); assert.equal(overlays[0].props.baseRef,'main');
});

test('Review opens a large modal for the exact PR without creating a tab', () => {
  const overlays = [];
  const PullRequests = vm.runInNewContext(source, {
    View: class {}, openOverlay: spec => overlays.push(spec),
    run() { assert.fail('Review must not create a tab or alter the workspace'); },
  });
  new PullRequests().review({ number: 123, url: 'https://github.com/org/repo/pull/123' });
  assert.equal(overlays.length, 1);
  const spec = overlays[0];
  assert.equal(spec.mod, 'pr-review');
  assert.equal(spec.kind, 'dialog');
  assert.equal(spec.modal, true);
  assert.equal(spec.props.url, 'https://github.com/org/repo/pull/123');
  assert.equal(spec.width, 0.94);
  assert.equal(spec.height, 0.92);
});
