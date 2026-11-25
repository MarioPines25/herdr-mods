import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { loadChecks, checksSummary, detailsUrl } from './checks.js';

const run = (id, conclusion = 'success', status = 'completed') => ({ id, name: `Build ${id}`, status, conclusion,
  app: { name: 'GitHub Actions' }, output: { title: 'Build output' }, html_url: `https://github.com/org/repo/actions/runs/${id}` });
const response = (rows, key = 'check_runs', total_count = rows.length) => ({ [key]: rows, total_count });

test('loads check runs and legacy status contexts for the exact displayed SHA', async () => {
  const calls = [];
  const checks = await loadChecks(async path => {
    calls.push(path);
    return path.includes('check-runs') ? response([run(1), run(2, null, 'queued'), run(3, 'cancelled'), run(4, 'skipped'), run(5, 'neutral')])
      : response([{ id: 6, context: 'External CI', state: 'failure', description: 'Failed to build', target_url: 'https://ci.example.com/build/6' }], 'statuses');
  }, 'org/repo', 'snapshot-sha');
  assert.ok(calls.every(path => path.startsWith('repos/org/repo/commits/snapshot-sha/')));
  assert.ok(calls.some(path => path.includes('filter=latest')));
  assert.deepEqual(checks.rows.map(r => r.kind), ['failure', 'failure', 'pending', 'success', 'neutral', 'skipped']);
  assert.equal(checks.rows.find(r => r.id === 'status-6').url, 'https://ci.example.com/build/6');
  assert.equal(checksSummary(checks).title, 'Some checks were not successful');
});

test('summaries distinguish absent, pending, skipped, partial and unknown results from success', () => {
  assert.equal(checksSummary(null).title, 'Loading checks…');
  assert.equal(checksSummary({ rows: [] }).title, 'No checks reported');
  assert.equal(checksSummary({ rows: [{ kind: 'pending' }] }).kind, 'pending');
  assert.equal(checksSummary({ rows: [{ kind: 'success' }] }).title, 'All checks have passed');
  assert.equal(checksSummary({ rows: [{ kind: 'skipped' }] }).kind, 'neutral');
  assert.equal(checksSummary({ rows: [{ kind: 'neutral' }] }).kind, 'neutral');
  assert.equal(checksSummary({ rows: [{ kind: 'success' }], partial: true }).kind, 'unknown');
  assert.equal(checksSummary({ rows: [{ kind: 'unknown' }] }).kind, 'unknown');
});

test('normalizes all terminal check conclusions and does not treat unknown conclusions as passing', async () => {
  const conclusions = ['success', 'failure', 'timed_out', 'cancelled', 'action_required', 'stale', 'startup_failure', 'neutral', 'skipped', null];
  const result = await loadChecks(async path => path.includes('check-runs')
    ? response(conclusions.map((c, i) => run(i, c))) : response([], 'statuses'), 'org/repo', 'sha');
  for (const [i, conclusion] of conclusions.entries()) {
    const kind = result.rows.find(r => r.id === `run-${i}`).kind;
    assert.equal(kind, conclusion === 'success' ? 'success' : conclusion === 'skipped' ? 'skipped'
      : conclusion === 'neutral' ? 'neutral' : conclusion === null ? 'unknown' : 'failure');
  }
});

test('paginates checks and status contexts beyond 100 entries', async () => {
  const calls = [];
  const result = await loadChecks(async path => {
    calls.push(path);
    const key = path.includes('check-runs') ? 'check_runs' : 'statuses';
    const first = path.endsWith('page=1');
    const rows = Array.from({ length: first ? 100 : 1 }, (_, i) => key === 'check_runs' ? run(first ? i : 100)
      : { id: first ? i : 100, context: `status ${i}`, state: 'success' });
    return response(rows, key, 101);
  }, 'org/repo', 'sha');
  assert.equal(calls.length, 4);
  assert.equal(result.rows.length, 202);
  assert.equal(result.partial, false);
});

test('bounded pagination marks truncated results instead of claiming all checks passed', async () => {
  const result = await loadChecks(async path => path.includes('check-runs')
    ? response(Array.from({ length: 100 }, (_, i) => run(i)), 'check_runs', 1200)
    : response([], 'statuses'), 'org/repo', 'sha');
  assert.equal(result.rows.length, 1000);
  assert.equal(result.partial, true);
  assert.equal(checksSummary(result).kind, 'unknown');
});

test('API errors and malformed responses are surfaced; unsafe links are omitted', async () => {
  await assert.rejects(loadChecks(async () => { throw new Error('HTTP 403'); }, 'org/repo', 'sha'), /HTTP 403/);
  await assert.rejects(loadChecks(async () => ({}), 'org/repo', 'sha'), /Unexpected GitHub checks response/);
  for (const value of [null, '', 'javascript:alert(1)', 'file:///tmp/file', 'https://example.com/with space']) assert.equal(detailsUrl(value), null);
  assert.equal(detailsUrl('https://ci.example.com/build/1'), 'https://ci.example.com/build/1');
});

const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PRReview', 'class PRReview') + '\nPRReview;';
function viewFixture(api) {
  const Review = vm.runInNewContext(source, { View: class {}, loadChecks });
  const view = new Review();
  Object.assign(view, { meta: { head: { sha: 'old' } }, target: { repo: 'org/repo' }, checkGeneration: 0, checksBusy: false, api });
  const tasks = [], cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); } };
  return { view, tasks, cx };
}

test('checks refresh cannot replace results for a newer PR snapshot', async () => {
  const pending = [];
  const { view, tasks, cx } = viewFixture(() => new Promise(resolve => pending.push(resolve)));
  view.refreshChecks(cx);
  view.meta = { head: { sha: 'new' } }; view.checkGeneration++; view.checksBusy = false;
  view.checks = { rows: [{ name: 'new snapshot results' }] };
  pending[0](response([run(1)])); pending[1](response([], 'statuses'));
  await Promise.all(tasks);
  assert.equal(view.checks.rows[0].name, 'new snapshot results');
  assert.equal(view.checksBusy, false);
});

test('a failed checks refresh preserves the diff and marks retained checks stale', async () => {
  const { view, tasks, cx } = viewFixture(async () => { throw new Error('HTTP 403'); });
  view.files = [{ filename: 'keep.ts' }]; view.draft = { text: 'Keep my draft' };
  view.checks = { rows: [{ name: 'previous results' }] };
  view.refreshChecks(cx); view.refreshChecks(cx);
  await Promise.all(tasks);
  assert.equal(tasks.length, 1);
  assert.match(view.checksError, /HTTP 403/);
  assert.equal(view.checks.rows[0].name, 'previous results');
  assert.equal(view.files[0].filename, 'keep.ts');
  assert.equal(view.draft.text, 'Keep my draft');
  assert.equal(view.checksBusy, false);
});
