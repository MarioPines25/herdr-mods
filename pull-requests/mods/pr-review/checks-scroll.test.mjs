import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { checksSummary } from './checks.js';
import { githubColors } from './colors.js';
import { labelColors } from './description.js';

const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class PRReview', 'class PRReview') + '\nPRReview;';

// Each tab owns exactly one overflow viewport, bounded by the modal's remaining
// flex height rather than an inner fixed-height card and an outer scroller.
function renderPanel(count, tab = 'checks') {
  function element(type = 'div') {
    const data = { type, styles: {}, nodes: [] };
    let proxy;
    proxy = new Proxy(data, { get(target, key) {
      if (key in target) return target[key];
      if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
      if (key === 'child') return child => { data.nodes.push(child); return proxy; };
      if (key === 'children') return children => { data.nodes.push(...children); return proxy; };
      return (...args) => {
        data.styles[key] = args.length === 1 ? args[0] : args;
        return proxy;
      };
    } });
    return proxy;
  }
  const Review = vm.runInNewContext(source, {
    View: class {}, checksSummary, labelColors, TextView: {markdown: () => element('markdown')},
    div: element, v_flex: element, h_flex: element, svg: element,
    Scrollbar: { vertical: target => element('scrollbar').target(target) },
  });
  const view = new Review();
  Object.assign(view, {
    meta: { number: 42, body: '## Description\n\n' + 'Long content\n\n'.repeat(100), head: { sha: 'abcdef123' } },
    target: {repo: 'org/repo'},
    checks: { rows: Array.from({ length: count }, (_, i) => ({
      id: String(i), name: `Check ${i}`, kind: i === count - 1 ? 'failure' : 'success', label: 'Completed',
    })) },
  });
  return tab === 'checks' ? view.checksPanel(githubColors(true)) : view.descriptionPanel(githubColors(true));
}
function find(node, predicate) {
  if (!node || typeof node === 'string') return null;
  if (predicate(node)) return node;
  for (const child of node.nodes || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}

test('checks tab uses the full remaining height and a single scroll viewport for all rows', () => {
  const panel = renderPanel(49);
  const viewport = find(panel, n => n.styles.id === 'pr-checks-viewport');
  assert.ok(viewport);
  for (const style of ['flex_1', 'min_h', 'relative']) assert.ok(style in viewport.styles, style);
  assert.equal(viewport.styles.h, undefined, 'no fixed inner card height');
  assert.equal(panel.styles.min_h, 0);
  assert.ok('flex_1' in panel.styles);
  const list = find(viewport, n => n.styles.id === 'pr-checks-list');
  assert.ok(list);
  for (const style of ['absolute', 'inset_0', 'overflow_y_scroll']) assert.ok(style in list.styles, style);
  assert.equal(list.nodes.length, 49, 'checks below the fold, including failures, must remain reachable');
  assert.ok(find(viewport, n => n.type === 'scrollbar' && n.styles.target === 'pr-checks-list'));
  assert.equal(scrollCount(panel), 1);
});

function scrollCount(node) {
  if (!node || typeof node === 'string') return 0;
  return (Object.keys(node.styles || {}).some(key => key.startsWith('overflow_') && key.includes('scroll')) ? 1 : 0)
    + (node.nodes || []).reduce((count, child) => count + scrollCount(child), 0);
}

test('description has one full-height viewport, not nested vertical scrollers', () => {
  const panel = renderPanel(0, 'description');
  const viewport = find(panel, n => n.styles.id === 'pr-description-viewport');
  assert.ok('flex_1' in viewport.styles); assert.equal(viewport.styles.min_h, 0);
  assert.equal(viewport.styles.h, undefined);
  const content = find(panel, n => n.styles.id === 'pr-description-content');
  for (const style of ['absolute', 'inset_0', 'overflow_y_scroll']) assert.ok(style in content.styles);
  assert.ok(find(panel, n => n.type === 'scrollbar' && n.styles.target === 'pr-description-content'));
  assert.equal(scrollCount(panel), 1);
});
