// Audit fixes cli-server-secrets-2/3/5/8/9 + protocol-1/5 for the dashboard server: Host check, strict body validation, refund != paid,
// testnet check before signing, pinned code hash. Fake JSON-RPC server only.
// Run: node --test test/server-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync } from 'node:fs';
import { serve } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { DEPLOYED, FOREIGN, tempDir, makeDoc, writeDoc, throwawaySigner, fakeRpc, statusResult, unknownAccount, handlers, onchainInvoice, payResult, type Chain } from './helpers.ts';
import type { InvoiceDoc } from '../src/invoice.ts';

function call(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = request({ host: '127.0.0.1', port, method, path, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', (d) => { text += d; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function boot(t: { after: (fn: () => Promise<void>) => void }, doc: InvoiceDoc | null, ch: Chain = {}) {
  const dir = tempDir(); if (doc) writeDoc(dir, doc);
  const rpc = await fakeRpc(doc ? handlers(doc, ch) : { status: () => statusResult(ch.chainId ?? 'testnet'), query: (p: any) => (p.account_id.startsWith('typo') ? unknownAccount : { amount: '1', storage_usage: 1, global_contract_hash: null }) });
  const s = throwawaySigner();
  const server = await serve(loadConfig({ ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED, ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret, ZI_SWEEPER_ACCOUNT: s.account, ZI_SWEEPER_KEY: s.secret }), 0);
  t.after(async () => { await new Promise<void>((r) => (server as Server).close(() => r())); await rpc.close(); });
  return { port: (server.address() as AddressInfo).port, rpc, dir };
}

test('Host header must be 127.0.0.1:<port> or localhost:<port> (DNS-rebinding guard)', async (t) => {
  const { port } = await boot(t, null);
  assert.equal((await call(port, 'GET', '/api/invoices', undefined, { host: `attacker.example:${port}` })).status, 403);
  assert.equal((await call(port, 'GET', '/api/invoices', undefined, { host: '127.0.0.1' })).status, 403, 'missing port');
  assert.equal((await call(port, 'GET', '/api/invoices', undefined, { host: `127.0.0.1:${port + 1}` })).status, 403);
  assert.equal((await call(port, 'GET', '/api/invoices', undefined, { host: `localhost:${port}` })).status, 200);
  assert.equal((await call(port, 'GET', '/api/invoices')).status, 200);
});

test('POST /api/invoices rejects missing / empty fields instead of coercing them into valid terms', async (t) => {
  const { port, dir } = await boot(t, null);
  const good = { id: 'INV-S-1', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: '800', amount_near: '1', expires_in_minutes: '60' };
  for (const bad of [{ id: undefined }, { id: '' }, { merchant: '' }, { tax_bps: '' }, { tax_bps: undefined }, { tax_bps: '8.5' }, { tax_bps: '-1' }, { expires_in_minutes: '' },
    { expires_in_minutes: '0' }, { expires_in_minutes: '-5000000000000' }, { expires_in_minutes: undefined }, { amount_near: '' }]) {
    const r = await call(port, 'POST', '/api/invoices', { ...good, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad) + ' ' + JSON.stringify(r.json));
  }
  assert.deepEqual(readdirSync(dir), [], 'no invoice was created by a rejected request');
  const ok = await call(port, 'POST', '/api/invoices', good);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.tax_bps, 800);
});

test('POST /api/invoices refuses a merchant that does not exist on testnet', async (t) => {
  const { port, dir } = await boot(t, null);
  const r = await call(port, 'POST', '/api/invoices', { id: 'INV-S-2', merchant: 'typo-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: '800', amount_near: '1', expires_in_minutes: '60' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /does not exist on testnet/);
  assert.deepEqual(readdirSync(dir), []);
});

test('pay: REFUNDED_* is not a payment (409, paid:false); PAID is 200, paid:true', async (t) => {
  const doc = makeDoc();
  for (const [value, status, paid] of [['REFUNDED_UNDERPAID', 409, false], ['REFUNDED_EXPIRED', 409, false], ['PAID', 200, true]] as const) {
    const { port } = await boot(t, doc, { invoice: onchainInvoice(doc), txResult: payResult(doc, value) });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/pay`, {});
    assert.equal(r.status, status, value);
    assert.equal(r.json.paid, paid);
    assert.equal(r.json.result, value);
  }
});

test('pay refuses a foreign-contract doc (400) and sends nothing', async (t) => {
  const doc = makeDoc(FOREIGN);
  const { port, rpc } = await boot(t, doc, {});
  const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/pay`, {});
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not the trusted hash/);
  assert.equal(rpc.calls.some((c) => c.method === 'send_tx'), false);
});

test('pay on a non-testnet RPC fails before any key is used (no nonce, block or send_tx call)', async (t) => {
  const doc = makeDoc();
  const { port, rpc } = await boot(t, doc, { chainId: 'mainnet', invoice: onchainInvoice(doc) });
  const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/pay`, {});
  assert.equal(r.status, 502);
  assert.match(r.json.error, /chain_id is mainnet/);
  assert.deepEqual([...new Set(rpc.calls.map((c) => c.method))], ['status']);
});

test('GET /api/invoices shows amount_near derived from amount_yocto, not the file\'s display field', async (t) => {
  const lying = { ...makeDoc(), amount_near: '0.1' };
  const { port } = await boot(t, lying, {});
  const r = await call(port, 'GET', '/api/invoices');
  assert.equal(r.json[0].amount_near, '1');
});
