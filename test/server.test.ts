// Local dashboard API (INTERFACES.md §8): localhost bind, Origin/content-type guards, 400 for bad input.
// Run: node --test test/server.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';

const CODE_HASH = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';

function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

async function start(t: { after: (fn: () => Promise<void>) => void }) {
  const server = await serve(loadConfig({ ZI_INVOICE_DIR: 'invoices', ZI_CODE_HASH: CODE_HASH }), 0);
  t.after(() => new Promise<void>((resolve) => (server as Server).close(() => resolve())));
  return { server, port: (server.address() as AddressInfo).port };
}

test('serve binds 127.0.0.1 and serves the dashboard plus the invoice list', async (t) => {
  const { server, port } = await start(t);
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1');

  const root = await call(port, 'GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.type, /^text\/html/);
  assert.match(root.text, /ZeroInit/);

  const js = await call(port, 'GET', '/state.js');
  assert.equal(js.status, 200);
  assert.match(js.type, /^text\/javascript/);

  const list = await call(port, 'GET', '/api/invoices');
  assert.equal(list.status, 200);
  assert.match(list.type, /^application\/json/);
  assert.ok(Array.isArray(JSON.parse(list.text)));
});

test('POST requires Content-Type: application/json', async (t) => {
  const { port } = await start(t);

  const none = await call(port, 'POST', '/api/invoices', '{}');
  assert.equal(none.status, 400);
  assert.match(JSON.parse(none.text).error, /content-type/);

  const text = await call(port, 'POST', '/api/invoices', '{}', { 'content-type': 'text/plain' });
  assert.equal(text.status, 400);
  assert.match(JSON.parse(text.text).error, /content-type/);

  const pay = await call(port, 'POST', '/api/invoices/NOPE/pay', '{}', { 'content-type': 'text/plain' });
  assert.equal(pay.status, 400);
});

test('a foreign Origin is rejected with 403; the dashboard origin is allowed', async (t) => {
  const { port } = await start(t);
  const foreign = await call(port, 'POST', '/api/invoices', '{}', { 'content-type': 'application/json', origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.match(JSON.parse(foreign.text).error, /origin/);

  const foreignGet = await call(port, 'GET', '/api/invoices', undefined, { origin: 'http://evil.example' });
  assert.equal(foreignGet.status, 403);

  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
    const own = await call(port, 'POST', '/api/invoices/NOPE/pay', '{}', { 'content-type': 'application/json', origin });
    assert.equal(own.status, 400, `origin ${origin} should reach the invoice lookup`);
  }
});

test('bad JSON and unknown invoice ids are 400, not 502', async (t) => {
  const { port } = await start(t);

  const badJson = await call(port, 'POST', '/api/invoices', '{', { 'content-type': 'application/json' });
  assert.equal(badJson.status, 400);
  assert.match(JSON.parse(badJson.text).error, /invalid JSON/);

  const unknown = await call(port, 'POST', '/api/invoices/NOPE/pay', '{}', { 'content-type': 'application/json' });
  assert.equal(unknown.status, 400);
  assert.match(JSON.parse(unknown.text).error, /not found/);
});
