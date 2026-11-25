import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Codex app-server uses newline-delimited JSON-RPC, not Content-Length framing.
export class CodexRpc {
  constructor(binary, { timeout = 18000 } = {}) {
    this.timeout = timeout;
    this.nextId = 0;
    this.pending = new Map();
    this.child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, RUST_LOG: 'error' },
    });
    // Never expose stderr: a client can log auth or unrelated local configuration.
    this.child.stderr.resume();
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id == null) return;
      const pending = this.pending.get(message.id);
      if (!pending) {
        if (message.method) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
          error: { code: -32601, message: 'This usage-only client does not support server requests' } }) + '\n');
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(message.error.message || 'Codex rejected the request');
        error.code = message.error.code;
        pending.reject(error);
      } else pending.resolve(message.result);
    });
    this.child.on('error', () => this.fail('Cannot start the configured Codex CLI. Check config.json.'));
    this.child.on('exit', (_code, signal) => this.fail(`Codex client exited${signal ? ` (${signal})` : ''}. Check the CLI and login.`));
    this.child.stdin.on('error', () => this.fail('Codex client connection closed.'));
  }

  fail(message) {
    this.failure = message;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer); reject(new Error(message));
    }
    this.pending.clear();
  }

  call(method, params = {}) {
    if (this.failure) return Promise.reject(new Error(this.failure));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out. No automatic retry was made.`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async start() {
    await this.call('initialize', {
      clientInfo: { name: 'herdr_ai_usage', title: 'Herdr AI usage', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
  }

  async close() {
    this.fail('Usage client closed.');
    this.lines.close();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 1000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
