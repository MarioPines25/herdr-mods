import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Run the real controller, with only native UI imports and network calls stubbed.
const source = (await fs.readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace('export default class JiraSprint extends View', 'globalThis.JiraSprint = class JiraSprint extends View');
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const overlays = [];
  const sandbox = { View: class {}, Set, Date, props() { return {}; }, shared() { return null; }, openOverlay(spec) { overlays.push(spec); }, InputState: {
    new() { let value = ''; return { value: () => value, set_value(v) { value = v; } }; }
  } };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const app = new sandbox.JiraSprint();
  const tasks = [], calls = [];
  const cx = { notify() {}, timer: { every() {} }, spawn(fn) { tasks.push(fn(cx)); } };
  const details = deferred();
  app.query = async args => {
    calls.push(args);
    if (args[0] === 'board') {
      const mode = args[args.indexOf('--state') + 1];
      return [{ id: mode === 'active' ? 1 : 2, name: mode, state: mode }];
    }
    if (args[0] === 'sprint') {
      const id = args[args.indexOf('--sprint') + 1];
      return [{ key: `ADV-${id}`, fields: { status: { name: 'To Do' } } }];
    }
    if (args[1] === 'search') return [{ key: args[args.indexOf('--jql') + 1].includes('= 1 ') ? 'ADV-1' : 'ADV-2' }];
    await details.promise;
    return { fields: { customfield_10014: 3 } };
  };
  app.init({}, cx);
  return { app, cx, tasks, calls, details, overlays };
}

test('tabs switch while story points load; filters work and responses stay in their tab', async () => {
  const { app, cx, tasks, calls, details } = setup();
  await tick();
  assert.equal(app.sprints[0].name, 'active');
  assert.equal(app.loading, false);
  assert.equal(app.currentView.detailsLoading, true);
  app.choose('future', cx);
  assert.equal(app.mode, 'future');
  await tick();
  assert.equal(app.sprints[0].name, 'future');
  app.toggleStatus('To Do', cx);
  app.onlyMine = true;
  assert.equal(app.matches(app.sprints[0].issues[0]), true);
  app.toggleStatus('To Do', cx);
  app.toggleStatus('Done', cx);
  assert.equal(app.matches(app.sprints[0].issues[0]), false);
  const count = calls.length;
  app.choose('active', cx);
  assert.equal(app.sprints[0].name, 'active');
  assert.equal(calls.length, count, 'cached tab must not refetch');
  details.resolve(); await Promise.all(tasks);
  assert.equal(app.sprints[0].issues[0].fields.customfield_10014, 3);
  assert.equal(app.views.future.sprints[0].name, 'future');
  assert.equal(app.views.future.sprints[0].issues[0].fields.customfield_10014, 3);
  app.choose('future', cx);
  assert.equal(calls.length, count, 'completed fresh cache must not refetch either');
});

test('switches tabs even before initial sprint list resolves, without duplicate requests', async () => {
  const { app, cx, tasks, details, calls } = setup();
  app.choose('future', cx);
  app.choose('active', cx);
  assert.equal(app.mode, 'active');
  await tick();
  assert.equal(app.sprints[0].name, 'active');
  assert.equal(calls.filter(args => args[0] === 'board').length, 2);
  details.resolve(); await Promise.all(tasks);
});

test('stale cached tabs stay visible during refresh; edits update all cached copies', async () => {
  const { app, cx, tasks, details, calls, overlays } = setup();
  details.resolve(); await Promise.all(tasks);
  app.choose('future', cx); await Promise.all(tasks);
  app.views.active.fetchedAt = 0;
  app.choose('active', cx);
  assert.equal(app.sprints[0].name, 'active');
  assert.equal(app.loading, true);
  await Promise.all(tasks);
  await app.updateIssue('ADV-1', { summary: 'Updated' });
  assert.equal(app.views.active.sprints[0].issues[0].fields.summary, 'Updated');
  app.edit(app.sprints[0].issues[0], cx);
  assert.equal(overlays[0].mod, 'jira-sprint');
  assert.equal(overlays[0].kind, 'dialog');
  assert.equal(overlays[0].props.issueKey, 'ADV-1');
  assert.equal(app.editors.size, 0, 'the browsing panel has no inline editors');
  app.choose('future', cx); app.toggleStatus('Done', cx);
  assert.equal(app.mode, 'future', 'editing must not block tabs');
  assert.equal(app.statusFilters.size, 1, 'editing must not block filters');
  const count = calls.length;
  app.refresh(cx);
  assert.ok(calls.length > count, 'editing must not block refresh');
  app.edit({ key: 'ADV-2' }, cx);
  assert.equal(overlays[1].props.issueKey, 'ADV-2', 'other issues open their own dialog');
  assert.equal(app.editors.size, 0);
  await Promise.all(tasks);
});

test('dismiss errors hides displayed failures without discarding issue data or failure state', async () => {
  const { app, cx, tasks, details } = setup();
  details.resolve(); await Promise.all(tasks);
  const issues = app.sprints;
  app.currentView.mineError = 'Assignment failed';
  app.currentView.detailError = 'Story points failed';
  app.error = 'Refresh failed';
  app.editors.set('ADV-1', { error: 'Save may be partial' });
  assert.equal(app.displayedFailures.length, 4);
  app.dismissFailures(cx);
  assert.equal(app.displayedFailures.length, 0);
  assert.equal(app.sprints, issues);
  assert.equal(app.currentView.mineError, 'Assignment failed', 'retain state for assignment filter');
  assert.equal(app.editors.get('ADV-1').error, 'Save may be partial');
  app.currentView.detailError = 'A different failure';
  assert.equal(app.displayedFailures.length, 1, 'new messages still appear');
});

test('slow and failing assignment lookup must not hide sprint issues', async () => {
  const { app, cx, tasks, details } = setup();
  const assignment = deferred();
  const query = app.query;
  app.query = async args => {
    if (args[1] === 'search') {
      await assignment.promise;
      throw new Error('failed to search work items');
    }
    return query(args);
  };
  await tick();
  assert.equal(app.sprints[0].issues.length, 1, 'issues appear before assignment lookup finishes');
  assert.equal(app.loading, false);
  assert.equal(app.currentView.mineLoading, true);
  assert.equal(app.error, null);
  assignment.resolve(); details.resolve(); await Promise.all(tasks);
  assert.equal(app.sprints[0].issues.length, 1, 'assignment failure must not discard issues');
  assert.equal(app.error, null);
  assert.match(app.currentView.mineError, /failed to search work items/);
  assert.equal(app.currentView.mineLoading, false);
});

test('optional story-point failures do not fail the issue list or keep navigation locked', async () => {
  const { app, cx, tasks, details } = setup();
  const query = app.query;
  app.query = args => args[1] === 'view' ? Promise.reject(new Error('Detail unavailable')) : query(args);
  details.resolve(); await Promise.all(tasks);
  assert.equal(app.error, null);
  assert.match(app.currentView.detailError, /Detail unavailable/);
  assert.equal(app.currentView.detailsLoading, false);
  assert.equal(app.sprints.length, 1);
  app.choose('future', cx);
  assert.equal(app.mode, 'future');
  await Promise.all(tasks);
});
