// Regression for the T15 deviation: `zi serve --port <port>` must start (it used to exit 2
// with "usage: zi serve <INVOICE_ID>") and GET /api/invoices must answer a JSON array.
// Run: node --test test/cli-serve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(p));
    });
  });
}

test('zi serve starts and GET /api/invoices returns 200 with a JSON array', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/cli.ts', 'serve', '--port', String(port)], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
  });

  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`no SERVE line within 20s; output:\n${output}`)), 20_000);
    const onData = (d: string) => {
      output += d;
      const m = /SERVE (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`serve exited ${code}; output:\n${output}`)); });
  });

  assert.equal(url, `http://127.0.0.1:${port}`);
  const res = await fetch(`${url}/api/invoices`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assert.ok(Array.isArray(await res.json()));
});
