import { mkdir, readFile, writeFile, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateNewReset, RESET_MESSAGES } from './model.mjs';

export class ResetStore {
  constructor(directory) { this.directory = directory; this.path = join(directory, '.reset-attempt.json'); }
  async read() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Cannot read the reset journal. Do not retry until it is recovered.'); }
  }
  async write(value) {
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, this.path);
  }
  async lock() {
    const path = join(this.directory, '.reset-lock');
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another reset is in progress, or a previous helper stopped unexpectedly. No reset sent. See README for lock recovery.');
      throw error;
    }
    try { await writeFile(join(path, 'owner'), String(process.pid), { mode: 0o600 }); }
    catch (error) { await rmdir(path).catch(() => {}); throw error; }
    return async () => { await unlink(join(path, 'owner')); await rmdir(path); };
  }
}

export function validateIntent(intent) {
  if (!intent || !/^[a-f0-9-]{36}$/i.test(intent.idempotencyKey || '')
      || typeof intent.accountId !== 'string' || !intent.accountId
      || typeof intent.creditId !== 'string' || !intent.creditId) {
    throw new Error('Invalid reset confirmation. Refresh and choose a credit again.');
  }
}

// Used only after an explicit confirmation. All tests inject a fake provider.
export async function performReset({ store, intent, readSnapshot, consume }) {
  validateIntent(intent);
  const unlock = await store.lock();
  try {
    const previous = await store.read();
    const sameAttempt = previous?.idempotencyKey === intent.idempotencyKey;
    if (sameAttempt && (previous.accountId !== intent.accountId || previous.creditId !== intent.creditId)) {
      throw new Error('Reset confirmation does not match the saved attempt.');
    }
    if (previous?.status === 'pending' && !sameAttempt) {
      throw new Error('An earlier reset has an uncertain result. Resolve that same attempt before spending another credit.');
    }
    if (sameAttempt && previous.status === 'complete') return { outcome: previous.outcome, message: RESET_MESSAGES[previous.outcome] };
    const completed = [...(previous?.completed || [])];
    if (previous?.status === 'complete' && ['reset', 'alreadyRedeemed'].includes(previous.outcome)) {
      completed.push({ accountId: previous.accountId, creditId: previous.creditId, outcome: previous.outcome });
    }
    const receipt = completed.find(item => item.accountId === intent.accountId && item.creditId === intent.creditId);
    if (receipt) return { outcome: receipt.outcome, message: RESET_MESSAGES[receipt.outcome] };
    const snapshot = await readSnapshot();
    if (!snapshot.accountId || snapshot.accountId !== intent.accountId) throw new Error('Codex account changed. No reset was sent. Switch back before resolving the saved attempt.');
    if (!sameAttempt) validateNewReset(snapshot, intent);
    // Persist before the provider call. A timeout/crash must retain this exact key and credit.
    await store.write({ ...intent, completed, status: 'pending', startedAt: sameAttempt ? previous.startedAt : Date.now() });
    const result = await consume({ idempotencyKey: intent.idempotencyKey, creditId: intent.creditId });
    if (!Object.hasOwn(RESET_MESSAGES, result?.outcome)) throw new Error('Codex returned an unknown reset result. The attempt remains pending; do not spend another credit.');
    await store.write({ ...intent, completed, status: 'complete', outcome: result.outcome, completedAt: Date.now() });
    return { outcome: result.outcome, message: RESET_MESSAGES[result.outcome] };
  } finally { await unlock(); }
}
