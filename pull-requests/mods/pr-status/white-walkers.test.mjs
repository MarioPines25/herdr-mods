import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as model from './model.js';

const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PullRequests', 'class PullRequests') + '\nPullRequests;';
const account = { host: 'github.com', login: 'me' };
const group = () => ({ nodes: [{ id: 'first' }], issueCount: 3, pageInfo: { hasNextPage: true, endCursor: 'one' } });
function fixture(responses) {
  const calls = [];
  const exec = async (_command, args) => {
    calls.push(args);
    const result = typeof responses === 'function' ? responses(calls.length) : responses.shift();
    return { code: 0, stdout: JSON.stringify(result) };
  };
  const View = vm.runInNewContext(source, { View: class {}, exec, ...model });
  return { view: new View(), calls };
}
const page = (nodes, hasNextPage, endCursor, login = 'me') => ({
  data: { viewer: { login }, whiteWalkers: { nodes, pageInfo: { hasNextPage, endCursor } } },
});

test('Team defaults to the selected author instead of an unfiltered search', () => {
  const team = model.GROUPS.find(g => g.key === 'whiteWalkers');
  assert.equal(team.label, 'Team');
  assert.deepEqual(model.WHITE_WALKERS, []);
  assert.equal(model.groupQuery(team, 'someone-else'),
    'is:pr is:open author:someone-else sort:updated-desc');
  assert.match(model.QUERY, /whiteWalkers: search\(query: \$whiteWalkers/);
  assert.match(model.WHITE_WALKERS_PAGE_QUERY, /after: \$cursor/);
});

test('Team loads subsequent pages and deduplicates PRs across pages', async () => {
  const { view, calls } = fixture([
    page([{ id: 'first' }, { id: 'second' }], true, 'two'),
    page([{ id: 'third' }], false, 'three'),
  ]);
  const results = group();
  await view.loadWhiteWalkers(results, account);
  assert.deepEqual(Array.from(results.nodes, p => p.id), ['first', 'second', 'third']);
  assert.equal(results.pageInfo.hasNextPage, false);
  assert.equal(results.issueCount, 3);
  assert.ok(calls[0].includes('cursor=one'));
  assert.ok(calls[1].includes('cursor=two'));
  for (const args of calls) assert.ok(args.includes('search=' + model.groupQuery(model.GROUPS.at(-1), 'me')));
});

test('Team does not fetch when the initial page is complete', async () => {
  const { view, calls } = fixture([]);
  await view.loadWhiteWalkers({ nodes: [], pageInfo: { hasNextPage: false } }, account);
  assert.equal(calls.length, 0);
});

test('pagination rejects errors, invalid pages and repeated or missing cursors', async () => {
  for (const response of [
    { errors: [{ message: 'Rate limited' }] },
    { data: { viewer: { login: 'me' }, whiteWalkers: null } },
    page([{ id: 'second' }], true, 'one'),
    page([{ id: 'second' }], true, null),
  ]) {
    const { view } = fixture([response]);
    await assert.rejects(view.loadWhiteWalkers(group(), account));
  }
});

test('pagination detects identity changes and clears stale results', async () => {
  const { view } = fixture([page([], false, null, 'other')]);
  view.data = { previous: true }; view.updated = 'old';
  await assert.rejects(view.loadWhiteWalkers(group(), account), /account changed/);
  assert.equal(view.data, null);
  assert.equal(view.updated, null);
});

test('pagination respects GitHub search limit and keeps the truncation warning', async () => {
  const results = {
    nodes: Array.from({ length: 50 }, (_, i) => ({ id: `initial-${i}` })),
    issueCount: 1200, pageInfo: { hasNextPage: true, endCursor: 'initial' },
  };
  const { view, calls } = fixture(i => page(
    Array.from({ length: 50 }, (_, n) => ({ id: `${i}-${n}` })), true, `cursor-${i}`));
  await view.loadWhiteWalkers(results, account);
  assert.equal(results.nodes.length, 1000);
  assert.equal(calls.length, 19);
  assert.equal(results.pageInfo.hasNextPage, true);
});
