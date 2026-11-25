import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CodexRpc } from './rpc.mjs';
import { normalizeCodex, normalizeCopilot } from './model.mjs';
import { ResetStore, performReset, validateIntent } from './reset.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(resolve(directory, 'config.json'), 'utf8'));
// GUI launches need not inherit the shell's Node PATH; Copilot uses /usr/bin/env node.
process.env.PATH = `${dirname(config.node)}:${process.env.PATH || '/usr/bin:/bin'}`;
const store = new ResetStore(directory);
const clients = new Set();

function safeError(error) {
  return String(error?.message || error)
    .replace(/(?:gh[o pusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 700);
}

async function withCodex(fn) {
  const rpc = new CodexRpc(resolve(directory, config.codex));
  clients.add(rpc);
  try { await rpc.start(); return await fn(rpc); }
  finally { await rpc.close(); clients.delete(rpc); }
}

async function readCodex(rpc) {
  const response = await rpc.call('account/rateLimits/read', {});
  let account = null;
  // Do not refresh credentials explicitly, switch accounts, or return auth objects to the UI.
  try { account = (await rpc.call('account/read', { refreshToken: false })).account; } catch { /* quota still useful */ }
  return normalizeCodex(response, account);
}

async function codexUsage() {
  return withCodex(async rpc => {
    const snapshot = await readCodex(rpc);
    const journal = await store.read();
    return { ...snapshot, pending: journal?.status === 'pending' ? journal : null };
  });
}

async function copilotUsage() {
  const { CopilotClient } = await import(pathToFileURL(config.copilotSdk).href);
  const client = new CopilotClient({ cliPath: config.copilot, logLevel: 'error' });
  const adapter = { close: () => client.stop() };
  clients.add(adapter);
  try {
    await client.start();
    const auth = await client.getAuthStatus();
    if (!auth.isAuthenticated) throw new Error('Copilot is not logged in. Run copilot login, then Refresh.');
    return normalizeCopilot(await client.rpc.account.getQuota(), auth);
  } finally { await client.stop(); clients.delete(adapter); }
}

async function result(fn) {
  try { return { ok: true, data: await fn(), updatedAt: Date.now() }; }
  catch (error) { return { ok: false, error: safeError(error), updatedAt: Date.now() }; }
}

let ending = false;
async function shutdown() {
  if (ending) return;
  ending = true;
  await Promise.allSettled([...clients].map(client => client.close()));
}
// This also closes usage-only children if the parent mod stops or times out.
process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(143)); });
process.once('SIGINT', () => { void shutdown().finally(() => process.exit(130)); });
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, error: 'Usage helper timed out. A reset result may be uncertain; refresh before retrying.' }));
  void shutdown().finally(() => process.exit(1));
}, 70000);

try {
  const command = process.argv[2] || 'usage';
  let output;
  if (command === 'usage') {
    const [codex, copilot] = await Promise.all([result(codexUsage), result(copilotUsage)]);
    output = { codex, copilot };
  } else if (command === 'prepare-reset') {
    const selection = JSON.parse(process.argv[3] || 'null');
    output = await result(() => withCodex(async rpc => {
      const snapshot = await readCodex(rpc);
      const journal = await store.read();
      if (journal?.status === 'pending') throw new Error('Resolve the pending reset attempt before selecting another credit.');
      const intent = { accountId: selection?.accountId, creditId: selection?.creditId, idempotencyKey: randomUUID() };
      const { validateNewReset } = await import('./model.mjs');
      const credit = validateNewReset(snapshot, intent);
      return { intent, credit, accountLabel: snapshot.accountLabel };
    }));
  } else if (command === 'reset') {
    const intent = JSON.parse(process.argv[3] || 'null');
    validateIntent(intent);
    output = await result(() => withCodex(rpc => performReset({
      store, intent, readSnapshot: () => readCodex(rpc),
      consume: params => rpc.call('account/rateLimitResetCredit/consume', params),
    })));
  } else throw new Error('Unknown helper action. Expected usage or reset.');
  console.log(JSON.stringify(output));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: safeError(error) }));
  process.exitCode = 1;
} finally { clearTimeout(watchdog); await shutdown(); }
