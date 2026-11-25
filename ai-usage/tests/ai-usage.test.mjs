import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeCodex, normalizeCopilot, availableCredits, validateNewReset } from '../mods/ai-usage/model.mjs';
import { ResetStore, performReset } from '../mods/ai-usage/reset.mjs';
import { CodexRpc } from '../mods/ai-usage/rpc.mjs';

const credit = { id: 'credit-1', status: 'available', resetType: 'codexRateLimits', expiresAt: null };
const raw = { accountId: 'account-1', ordinaryUsageAllowed: true, rateLimits: {
  planType: 'plus', primary: { usedPercent: 32, windowDurationMins: 300, resetsAt: 1800000000 },
  secondary: { usedPercent: 41, windowDurationMins: 10080, resetsAt: 1800100000 },
}, rateLimitResetCredits: { availableCount: 2, credits: [credit] } };
const snapshot = () => normalizeCodex(raw, { email: 'test@example.test' });
const intent = () => ({ accountId: 'account-1', creditId: credit.id, idempotencyKey: randomUUID() });
async function withStore(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-ai-usage-test-'));
  try { await fn(new ResetStore(directory)); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('normalizes live Codex quota without confusing total count and detail count', () => {
  const data = snapshot();
  assert.equal(data.primary.remaining, 68);
  assert.equal(data.secondary.remaining, 59);
  assert.equal(data.primary.resetsAt, 1800000000000);
  assert.equal(data.resetCount, 2);
  assert.equal(data.credits.length, 1);
  assert.equal(normalizeCodex({ rateLimits: {} }, null).resetCount, null);
  assert.equal(normalizeCodex({ rateLimits: { primary: { usedPercent: null } } }, null).primary.remaining, null);
});

test('does not mix a quota identity with a separately fetched account label', () => {
  const data = normalizeCodex(raw, { accountId: 'other-account', email: 'wrong@example.test' });
  assert.equal(data.accountId, 'account-1');
  assert.doesNotMatch(data.accountLabel, /wrong/);
  assert.match(data.accountLabel, /account-1/);
  assert.equal(normalizeCodex({ rateLimits: {} }, { accountId: 'other-account' }).accountId, null);
});

test('filters expired, unknown-type and unavailable reset credits', () => {
  assert.equal(availableCredits({ credits: [credit, { ...credit, status: 'redeemed' },
    { ...credit, resetType: 'unknown' }, { ...credit, expiresAt: 10 }] }).length, 1);
  assert.throws(() => validateNewReset(snapshot(), { ...intent(), accountId: 'other' }), /account changed/);
});

test('Copilot preserves percent scale, billing flag, and unlimited entitlement', () => {
  const data = normalizeCopilot({ quotaSnapshots: {
    premium_interactions: { remainingPercentage: 96.3, tokenBasedBilling: true },
    chat: { isUnlimitedEntitlement: true, entitlementRequests: 0 },
  } }, { login: 'test' });
  assert.equal(data.quotas[0].remaining, 96.3);
  assert.equal(data.quotas[0].tokenBasedBilling, true);
  assert.equal(data.quotas[1].unlimited, true);
  assert.equal(data.quotas[1].remaining, null);
});

test('reset persists intent BEFORE provider call and caches completed response', () => withStore(async store => {
  const i = intent(); let calls = 0;
  const consume = async params => {
    calls++; assert.equal((await store.read()).status, 'pending');
    assert.deepEqual(params, { idempotencyKey: i.idempotencyKey, creditId: i.creditId });
    return { outcome: 'reset' };
  };
  const args = { store, intent: i, readSnapshot: async () => snapshot(), consume };
  assert.equal((await performReset(args)).outcome, 'reset');
  assert.equal((await store.read()).status, 'complete');
  await performReset(args);
  assert.equal(calls, 1);
}));

test('stale confirmations cannot consume a previously spent credit even after another reset', () => withStore(async store => {
  let calls = 0;
  const run = (i) => performReset({ store, intent: i,
    readSnapshot: async () => ({ ...snapshot(), credits: [credit, { ...credit, id: 'credit-2' }] }),
    consume: async () => { calls++; return { outcome: 'reset' }; } });
  await run(intent());
  await run({ ...intent(), creditId: 'credit-2' });
  await run(intent());
  assert.equal(calls, 2);
}));

test('uncertain reset blocks new attempt and retry reuses saved key even if credit disappeared', () => withStore(async store => {
  const i = intent(); let sent;
  await assert.rejects(performReset({ store, intent: i, readSnapshot: async () => snapshot(),
    consume: async params => { sent = params; throw new Error('network timeout'); } }), /network timeout/);
  assert.equal((await store.read()).status, 'pending');
  await assert.rejects(performReset({ store, intent: intent(), readSnapshot: async () => snapshot(),
    consume: async () => { throw new Error('must not send'); } }), /uncertain result/);
  assert.equal((await performReset({ store, intent: i,
    readSnapshot: async () => ({ ...snapshot(), credits: [] }), consume: async params => {
      assert.deepEqual(params, sent); return { outcome: 'alreadyRedeemed' };
    } })).outcome, 'alreadyRedeemed');
}));

test('account changes, expired credit and modified replay cannot redeem', () => withStore(async store => {
  let calls = 0;
  const run = (i, s) => performReset({ store, intent: i, readSnapshot: async () => s,
    consume: async () => { calls++; return { outcome: 'reset' }; } });
  await assert.rejects(run(intent(), { ...snapshot(), accountId: 'other' }), /account changed/);
  await assert.rejects(run(intent(), { ...snapshot(), credits: [] }), /no longer available/);
  const i = intent(); await store.write({ ...i, status: 'pending' });
  await assert.rejects(run({ ...i, creditId: 'other-credit' }, snapshot()), /does not match/);
  assert.equal(calls, 0);
}));

test('simultaneous reset helper is excluded by filesystem lock', () => withStore(async store => {
  const unlock = await store.lock();
  try {
    await assert.rejects(performReset({ store, intent: intent(), readSnapshot: async () => snapshot(),
      consume: async () => assert.fail('must not send') }), /Another reset is in progress/);
  } finally { await unlock(); }
}));

test('unknown reset outcome preserves pending attempt and releases lock', () => withStore(async store => {
  await assert.rejects(performReset({ store, intent: intent(), readSnapshot: async () => snapshot(),
    consume: async () => ({ outcome: 'something-new' }) }), /unknown reset result/);
  assert.equal((await store.read()).status, 'pending');
  const unlock = await store.lock(); await unlock();
}));

test('all known no-op outcomes resolve without being labeled success', () => withStore(async store => {
  for (const outcome of ['nothingToReset', 'noCredit', 'alreadyRedeemed']) {
    const result = await performReset({ store, intent: intent(), readSnapshot: async () => snapshot(),
      consume: async () => ({ outcome }) });
    assert.equal(result.outcome, outcome);
    assert.doesNotMatch(result.message, /successfully/);
  }
}));

// Exercise the actual GPUI render code with eager conditional callbacks, including
// post-load and confirmation states that herdr-app check cannot cover.
const source = (await readFile(new URL('../mods/ai-usage/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class', 'return class');
const renderedText = [];
function element() {
  let proxy;
  proxy = new Proxy({}, { get(_target, key) {
    if (key === 'when') return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key === 'child') return value => { if (typeof value === 'string') renderedText.push(value); return proxy; };
    return () => proxy;
  } });
  return proxy;
}
const overlays = [];
const Ui = new Function('View', 'div', 'v_flex', 'h_flex', 'Scrollbar', 'theme', 'svg', 'image',
  'openOverlay', source)(
  class {}, element, element, element, { vertical: element },
  () => ({ ansi1: 'red', ansi2: 'green', ansi3: 'yellow', dim: 'muted' }), element, element,
  options => overlays.push(options));

test('allowance colors and labels follow remaining usage thresholds', () => {
  const mod = new Ui();
  for (const [value, label] of [[100, 'Healthy'], [51, 'Healthy'], [50.1, 'Healthy'],
    [50, 'Low'], [21, 'Low'], [20.1, 'Low'], [20, 'Critical'], [0, 'Critical'],
    [null, 'Unavailable'], [NaN, 'Unavailable']]) {
    assert.equal(mod.allowanceStyle(value).label, label, `remaining=${value}`);
  }
  assert.equal(mod.allowanceStyle(0, true).label, 'Unlimited');
  assert.equal(mod.allowanceStyle(51).color, 'green');
  assert.equal(mod.allowanceStyle(50).color, 'yellow');
  assert.equal(mod.allowanceStyle(20).color, 'red');
  assert.equal(mod.allowanceStyle(null).color, 'muted');
});

test('renders compact/detail/loading/error/pending/confirmation states', () => {
  for (const compact of [false, true]) {
    const mod = new Ui();
    Object.assign(mod, { compact, data: null, busy: true, resetBusy: false }); mod.render({});
    mod.data = { codex: { ok: true, data: snapshot(), updatedAt: Date.now() },
      copilot: { ok: true, data: normalizeCopilot({ quotaSnapshots: { premium_interactions: { remainingPercentage: 96.3 } } }), updatedAt: Date.now() } };
    mod.busy = false; mod.render({});
    mod.data.codex.data.pending = { ...intent(), status: 'pending' }; mod.render({});
    mod.confirmation = { intent: intent(), credit: snapshot().credits[0], accountLabel: 'test' }; mod.render({});
    mod.confirmation = { intent: intent(), accountLabel: 'test', retry: true }; mod.render({});
    mod.confirmation = null; mod.data.codex = { ok: false, error: 'test' }; mod.render({});
  }
});

test('Copilot details put premium first without mutating provider order', () => {
  const mod = new Ui();
  const data = { quotas: [{ id: 'chat' }, { id: 'completions' }, { id: 'premium_interactions' }] };
  assert.deepEqual(mod.orderedQuotas(data).map(q => q.id), ['premium_interactions', 'chat', 'completions']);
  assert.equal(data.quotas[0].id, 'chat');
  assert.deepEqual(mod.orderedQuotas(null), []);
});

test('top strip is permanently compact with only the details action', async () => {
  const layout = JSON.parse(await readFile(new URL('../../jira-workspace/layouts/jira-workspace.json', import.meta.url), 'utf8'));
  const work = layout.children.find(node => node.id === 'work');
  const strip = work.children.find(node => node.id === 'ai-usage-panel');
  assert.equal(strip.size.px, 64);
  assert.equal(strip.min, 64);
  assert.equal(strip.max, 64);
  const topSource = source.slice(source.indexOf('  renderTop('), source.indexOf('  render(cx)'));
  assert.doesNotMatch(topSource, /top-minimize|top-refresh|Expand|Minimize/);
  assert.match(topSource, /top-details/);
});

test('permanent summary renders loading, error, populated and unavailable states', () => {
  const mod = new Ui();
  Object.assign(mod, { topBar: true, compact: true, data: null, busy: true }); mod.render({});
  mod.busy = false; mod.error = 'offline'; mod.render({});
  mod.error = null;
  mod.data = { codex: { ok: true, data: snapshot() }, copilot: { ok: true, data: normalizeCopilot({ quotaSnapshots: {
    chat: { isUnlimitedEntitlement: true }, premium_interactions: { remainingPercentage: 42 },
  } }) } };
  mod.render({});
  mod.data.codex = { ok: false, error: 'offline' }; mod.render({});
});

test('detail action opens a wider two-provider dialog', () => {
  overlays.length = 0;
  new Ui().details();
  assert.equal(overlays[0].width, 980);
  assert.equal(overlays[0].props.compact, false);
});

test('UI double clicks cannot initiate two redemptions', async () => {
  const mod = new Ui();
  Object.assign(mod, { busy: false, resetBusy: false, confirmation: { intent: intent() } });
  let calls = 0, task, release;
  const gate = new Promise(resolve => { release = resolve; });
  mod.helper = async () => { calls++; await gate; return { data: { message: 'fake result' } }; };
  mod.refresh = () => {};
  const cx = { notify() {}, spawn(fn) { task = fn(cx); } };
  mod.redeem(cx); mod.redeem(cx);
  assert.equal(calls, 1);
  release(); await task;
  assert.equal(mod.confirmation, null);
});

test('RPC handles split JSON lines, notifications, provider errors and process cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-ai-rpc-test-'));
  const binary = join(directory, 'fake-codex');
  await writeFile(binary, `#!/usr/bin/env node
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id==null)return;
const r=m.method==='fail'?{id:m.id,error:{code:-32601,message:'unsupported'}}:{id:m.id,result:{ok:true}};
const s=JSON.stringify(r)+'\\n';process.stdout.write(s.slice(0,5));setTimeout(()=>process.stdout.write(s.slice(5)),5);});
`, { mode: 0o700 });
  const rpc = new CodexRpc(binary, { timeout: 2000 });
  try {
    await rpc.start(); assert.deepEqual(await rpc.call('read'), { ok: true });
    await assert.rejects(rpc.call('fail'), error => error.code === -32601);
  } finally { await rpc.close(); await rm(directory, { recursive: true, force: true }); }
  assert.ok(rpc.child.exitCode !== null || rpc.child.signalCode !== null);
});
