// Dashboard token flows (docs/STABLECOIN.md §10): create validation, pay/reject/pending mapping,
// plain transfer, sweep and refund. Fake JSON-RPC only.
// Run: node --test test/server-token.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync } from 'node:fs';
import { serve } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { DEPLOYED, tempDir, makeTokenDoc, writeDoc, throwawaySigner, fakeRpc, handlers, statusResult, viewResult, unknownAccount,
  onchainInvoice, b64, TEST_TOKEN, type Chain } from './helpers.ts';
import type { InvoiceDoc } from '../src/invoice.ts';

const TOKEN = 'tusdc.example.testnet';
const MIN = '1250000000000000000000';

function call(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = request({ host: '127.0.0.1', port, method, path, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'x-zi-token': TEST_TOKEN } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', (d) => { text += d; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const eventLog = (e: any) => 'EVENT_JSON:' + JSON.stringify(e);
const paidEvent = (doc: InvoiceDoc) => ({ standard: 'zeroinit', version: '3.0.0', event: 'invoice_paid',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, via: 'pay', payer: 'payer.testnet', amount: '1500000',
    merchant_amount: '1380000', tax_amount: '120000', excess_refunded: '0', late: false, retried: false, token: TOKEN }] });
const rejectedEvent = (doc: InvoiceDoc, reason: string) => ({ standard: 'zeroinit', version: '3.0.0', event: 'payment_rejected',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, sender: 'payer.testnet', amount: '500000', reason, predecessor: TOKEN, token: TOKEN }] });
const failedEvent = (doc: InvoiceDoc) => ({ standard: 'zeroinit', version: '3.0.0', event: 'transfer_failed',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, role: 'merchant', to: 'zi-merchant.testnet', amount: '1380000', token: TOKEN }] });
const txResult = (doc: InvoiceDoc, value: string, events: any[] = []) => ({
  status: { SuccessValue: b64(value) },
  transaction: { hash: 'H', signer_id: 'payer.testnet', receiver_id: doc.account_id, actions: [] }, receipts: [],
  receipts_outcome: events.map((e, i) => ({ id: `c${i}`, outcome: { executor_id: doc.account_id, logs: [eventLog(e)], status: { SuccessValue: '' } } })),
});

async function boot(t: { after: (fn: () => Promise<void>) => void }, doc: InvoiceDoc | null, ch: Chain, env: Record<string, string> = {}) {
  const dir = tempDir(); if (doc) writeDoc(dir, doc);
  const rpc = await fakeRpc(handlers(doc ?? makeTokenDoc(), ch));
  const s = throwawaySigner();
  const cfg = loadConfig({ ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED, ZI_TUSDC_ACCOUNT: TOKEN,
    ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret, ZI_SWEEPER_ACCOUNT: s.account, ZI_SWEEPER_KEY: s.secret, ...env });
  const server = await serve(cfg, 0, { token: TEST_TOKEN });
  t.after(async () => { await new Promise<void>((r) => (server as Server).close(() => r())); await rpc.close(); });
  return { port: (server.address() as AddressInfo).port, rpc, dir };
}

test('POST /api/invoices: a token invoice in display units; bad asset/units/allow-list are 400', async (t) => {
  const { port, dir } = await boot(t, null, { invoice: {} });
  const good = { id: 'INV-W-T1', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: '800', asset: 'tUSDC', amount: '1.5', expires_in_minutes: '60', payout_grace_ms: '120000' };
  const ok = await call(port, 'POST', '/api/invoices', good);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.format, 'zeroinit-invoice/2');
  assert.equal(ok.json.amount_raw, '1500000');
  assert.equal(ok.json.amount_display, '1.5');
  assert.deepEqual(ok.json.asset, { kind: 'ft', contract: TOKEN, symbol: 'tUSDC', decimals: 6 });
  for (const bad of [{ asset: 'USDC' }, { amount: '1.0000001' }, { amount: '0.000000' }, { asset: 'near', amount: 'x' }, { payout_grace_ms: '59999' }]) {
    const r = await call(port, 'POST', '/api/invoices', { ...good, id: `INV-W-${Object.keys(bad)[0]}`, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad) + ' ' + JSON.stringify(r.json));
  }
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.json')), ['INV-W-T1.json']);
});

test('POST /api/invoices: no ZI_TUSDC_ACCOUNT means the token asset is refused', async (t) => {
  const { port } = await boot(t, null, { invoice: {} }, { ZI_TUSDC_ACCOUNT: '' });
  const r = await call(port, 'POST', '/api/invoices', { id: 'INV-W-T2', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: '800', asset: 'tUSDC', amount: '1.5', expires_in_minutes: '60' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no token is configured/);
});

test('token pay: invoice_paid is 200/paid:true; rejected is 409; pending is 202; a failed payout is 409', async (t) => {
  const doc = makeTokenDoc();
  const cases: Array<[string, any, number, (j: any) => void]> = [
    ['paid', txResult(doc, '0', [paidEvent(doc)]), 200, (j) => { assert.equal(j.paid, true); }],
    ['rejected', txResult(doc, '1500000', [rejectedEvent(doc, 'underpaid')]), 409, (j) => { assert.equal(j.paid, false); assert.equal(j.rejected, 'underpaid'); }],
    ['pending', txResult(doc, '0'), 202, (j) => { assert.equal(j.paid, false); assert.equal(j.pending, true); }],
    ['failed', txResult(doc, '0', [failedEvent(doc)]), 409, (j) => { assert.equal(j.paid, false); assert.equal(j.transfers_failed, 1); }],
  ];
  for (const [name, tx, status, check] of cases) {
    const { port } = await boot(t, doc, { storageBalance: { total: MIN, available: '0' }, invoice: onchainInvoice(doc), txResult: tx });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/pay`, {});
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.json)}`);
    check(r.json);
  }
});

test('token plain transfer and sweep/refund endpoints', async (t) => {
  const doc = makeTokenDoc();
  {
    const { port, rpc } = await boot(t, doc, { storageBalance: { total: MIN, available: '0' }, invoice: onchainInvoice(doc), txResult: txResult(doc, '') });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/plain`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const sent = rpc.calls.filter((c) => c.method === 'send_tx');
    assert.equal(sent.length, 1);
  }
  {
    const { port } = await boot(t, doc, { invoice: onchainInvoice(doc), accountAmount: '1000', txResult: txResult(doc, 'PAID') });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/sweep`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'PAID');
  }
  {
    const { port } = await boot(t, doc, { invoice: onchainInvoice(doc), txResult: txResult(doc, 'UNDERPAID') });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/sweep`, {});
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.result, 'UNDERPAID');
  }
  {
    const { port } = await boot(t, doc, { invoice: onchainInvoice(doc), txResult: txResult(doc, 'REFUNDED') });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/refund`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'REFUNDED');
  }
});

test('GET status returns the token, its balance and the owed fields', async (t) => {
  const doc = makeTokenDoc();
  const { port } = await boot(t, doc, { invoice: onchainInvoice(doc, { status: 'SETTLING', owed_merchant: '1380000' }), ftBalance: '1500000' });
  const r = await call(port, 'GET', `/api/invoices/${doc.invoice_id}/status`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.state, 'INITIALIZED');
  assert.equal(r.json.token, TOKEN);
  assert.equal(r.json.token_symbol, 'tUSDC');
  assert.equal(r.json.token_balance_raw, '1500000');
  assert.equal(r.json.owed_merchant, '1380000');
  assert.equal(r.json.invoice.status, 'SETTLING');
});
