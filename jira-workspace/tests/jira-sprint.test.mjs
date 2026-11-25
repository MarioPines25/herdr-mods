import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Exercise the mod's real refresh method without starting the native UI.
const source = (await readFile(new URL('../mods/jira-sprint/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class', 'return class');
const Jira = new Function('View', source)(class {});

test('loads assigned issues using acli-compatible fields and publishes before story points', async () => {
  const mod = new Jira();
  Object.assign(mod, { mode: 'future', views: { future: mod.newView() } });
  let releaseDetails;
  const details = new Promise(resolve => { releaseDetails = resolve; });
  let detailsStarted;
  const started = new Promise(resolve => { detailsStarted = resolve; });
  mod.query = async args => {
    if (args[0] === 'board') return [{ id: 1332 }];
    if (args[0] === 'sprint') return [{ key: 'TEST-1', fields: {} }];
    if (args[1] === 'search') {
      assert.equal(args[3], 'sprint = 1332 AND assignee = currentUser()');
      // Real acli returns null rows when only key is requested.
      return args[args.indexOf('--fields') + 1] === 'key' ? [null] : [{ key: 'TEST-1' }];
    }
    detailsStarted();
    await details;
    return { fields: { customfield_10014: 5 } };
  };
  const tasks = [];
  const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); } };
  mod.refresh(cx);
  await Promise.race([started, Promise.all(tasks)]);
  try {
    assert.equal(mod.sprints.length, 1, mod.error || 'Issues must appear before detail calls finish');
    assert.equal(mod.sprints[0].issues[0].assignedToMe, true);
    assert.equal(mod.loading, false);
    assert.equal(mod.currentView.detailsLoading, true);
  } finally { releaseDetails(); await Promise.all(tasks); }
  assert.equal(mod.error, null);
  assert.equal(mod.sprints[0].issues[0].fields.customfield_10014, 5);
  assert.equal(mod.loading, false);
});
