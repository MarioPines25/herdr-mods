import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as model from './model.js';
import { githubColors } from './colors.js';

const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PullRequests', 'class PullRequests') + '\nPullRequests;';

function fixture() {
  const controls = [], overlays = [], clicks = {}, styles = {};
  function element() {
    let id;
    const proxy = new Proxy({}, { get(_target, key) {
      if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (key === 'id') return value => { id = value; styles[id] = {}; return proxy; };
      if (key === 'on_click') return fn => { clicks[id] = fn; return proxy; };
      return (...args) => { if (id) styles[id][key] = args; return proxy; };
    }});
    return proxy;
  }
  const View = vm.runInNewContext(source, {
    View: class {}, ...model, githubColors, div: element, h_flex: element, v_flex: element, svg: element,
    theme: () => ({}), settings: () => ({ dark: true }), openOverlay: spec => overlays.push(spec),
  });
  const view = new View();
  Object.assign(view, { compact: true, busy: false, error: null, selected: { host: 'github.com', login: 'me' } });
  const actionButton = view.actionButton.bind(view);
  view.actionButton = (...args) => { controls.push(args); return actionButton(...args); };
  const pr = { id: 'PR_1', number: 42, title: 'Test PR', state: 'OPEN', isDraft: false,
    headRefOid: 'head', headRefName: 'feature', baseRefName: 'main', repository: { nameWithOwner: 'org/repo' } };
  return { view, pr, controls, overlays, clicks, styles };
}

test('Merge stays mounted like Diff throughout refresh and errors, but cannot open confirmation while disabled', () => {
  const h = fixture();
  for (const [busy, error] of [[false, null], [true, null], [false, null], [false, 'HTTP 503'], [false, null]]) {
    Object.assign(h.view, { busy, error }); h.controls.length = 0;
    h.view.row(h.pr);
    assert.ok(h.controls.some(([id]) => id === 'review-PR_1'), 'Diff remains mounted');
    const merge = h.controls.find(([id]) => id === 'merge-PR_1');
    assert.ok(merge, 'Merge must not disappear during refresh');
    assert.equal(Boolean(merge[4]), Boolean(busy || error), 'disabled while refreshing or showing stale results');
    h.overlays.length = 0;
    // Invoking a captured action must still honor the method-level safety guard.
    merge[2]();
    assert.equal(h.overlays.length, busy || error ? 0 : 1);
    if (busy || error) assert.equal(h.clicks['merge-PR_1'], undefined, 'disabled control registers no handler');
    delete h.clicks['merge-PR_1'];
  }
});
