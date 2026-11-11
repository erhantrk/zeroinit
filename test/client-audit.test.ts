// Audit fixes client-1..8: escaped dashboard rows + CSP, API token on POST, NEAR sweep result mapping, UNVERIFIED status for forged docs,
// unknown (not zero) token balance, RPC timeouts treated as in flight, receipt --tx belongs to the invoice, robust invoice listing.
// Fake JSON-RPC server only. Run: node --test test/client-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';
import { sendActions } from '../src/send.ts';
import { listDocs, type InvoiceDoc } from '../src/invoice.ts';
import { parseTxStatus } from '../src/outcome.ts';
import { escapeHtml, rowHtml, selectedHtml, badgeLabel, amountLabel } from '../web/state.js';
import { TEST_TOKEN, DEPLOYED, FOREIGN, tempDir, makeDoc, makeTokenDoc, writeDoc, throwawaySigner, fakeRpc, handlers, onchainInvoice, payResult, b64,
  runCli, viewResult, type Chain } from './helpers.ts';

function call(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: any; headers: Record<string, any>; text: string }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = request({ host: '127.0.0.1', port, method, path, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'x-zi-token': TEST_TOKEN } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8'); res.on('data', (d) => { text += d; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode ?? 0, json, headers: res.headers, text }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function boot(t: { after: (fn: () => Promise<void>) => void }, docs: InvoiceDoc[], ch: Chain, handlerDoc: InvoiceDoc = docs[0] ?? makeDoc(), env: Record<string, string> = {}, wrap?: (h: any) => any) {
  const dir = tempDir(); for (const d of docs) writeDoc(dir, d);
  const h = handlers(handlerDoc, ch);
  const rpc = await fakeRpc(wrap ? wrap(h) : h);
  const s = throwawaySigner();
  const cfg = loadConfig({ ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED, ZI_TUSDC_ACCOUNT: 'tusdc.example.testnet',
    ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret, ZI_SWEEPER_ACCOUNT: s.account, ZI_SWEEPER_KEY: s.secret, ...env });
  const server = await serve(cfg, 0, { token: TEST_TOKEN });
  t.after(async () => { await new Promise<void>((r) => (server as Server).close(() => r())); await rpc.close(); });
  return { port: (server.address() as AddressInfo).port, rpc, dir };
}

// ---- client-1 ----
test('client-1: dashboard rows and the selection header escape every invoice-file / RPC value', () => {
  const evil = `<img src=x onerror=fetch('/api/invoices/OTHER/pay',{method:'POST'})>`;
  const doc = { invoice_id: evil, account_id: '<b>acct</b>', amount_display: '1', unit: '<i>sym</i>' };
  const html = rowHtml({ doc, status: { state: 'UNVERIFIED', reason: '<script>x</script>' }, label: badgeLabel({ state: 'UNVERIFIED' }) });
  for (const bad of ['<img', '<b>', '<i>', '<script']) assert.ok(!html.includes(bad), `${bad} must not appear raw: ${html}`);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.equal(escapeHtml(`"'<>&\``), '&quot;&#39;&lt;&gt;&amp;&#96;');
  const sel = selectedHtml({ id: evil, amountLabel: '<u>1</u>', accountId: '<b>acct</b>' });
  assert.ok(!sel.includes('<img') && !sel.includes('<u>') && !sel.includes('<b>acct'), sel);
});

test('client-1: a status label from the chain is only ever a known badge (it becomes a CSS class)', () => {
  assert.equal(badgeLabel({ state: 'INITIALIZED', invoice: { status: '"><img src=x onerror=alert(1)>' } }), 'UNKNOWN');
  assert.equal(badgeLabel({ state: 'INITIALIZED', invoice: { status: 'PAID' } }), 'PAID');
});

test('client-1: GET / has a CSP and no inline script; the hostile invoice_id never reaches the page list', async (t) => {
  const evilId = `<img src=x onerror=alert(1)>`;
  const good = makeDoc();
  const { port, dir } = await boot(t, [good], {});
  writeFileSync(join(dir, 'evil.json'), JSON.stringify({ ...good, invoice_id: evilId }));
  const root = await call(port, 'GET', '/');
  assert.equal(root.status, 200);
  const csp = String(root.headers['content-security-policy']);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /default-src 'none'/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(root.text), 'no inline <script>');
  assert.equal((await call(port, 'GET', '/app.js')).status, 200);
  const list = await call(port, 'GET', '/api/invoices');
  assert.deepEqual(list.json.map((d: any) => d.invoice_id), [good.invoice_id]);
  assert.ok(!list.text.includes('onerror'));
});

// ---- client-2 ----
test('client-2: NEAR sweep answering PAYOUT_PENDING is 202 pending, never paid:true / 200', async (t) => {
  const doc = makeDoc();
  for (const [value, status, paid, pending] of [['PAYOUT_PENDING', 202, false, true], ['PAID', 200, true, false], ['EXTRA_SWEPT', 200, false, false],
    ['NOTHING_ELSE', 409, false, false]] as const) {
    const { port } = await boot(t, [doc], { invoice: onchainInvoice(doc), txResult: payResult(doc, value) });
    const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/sweep`, {});
    assert.equal(r.status, status, value);
    assert.equal(r.json.paid, paid, value);
    assert.equal(!!r.json.pending, pending, value);
    assert.equal(r.json.result, value);
  }
});

test('client-2: a NEAR sweep with a downstream transfer failure is not ok even if the value says PAID', async (t) => {
  const doc = makeDoc();
  const tx: any = payResult(doc, 'PAID');
  tx.receipts_outcome = [{ id: 'r', outcome: { executor_id: 'nobody.testnet', logs: [], status: { Failure: { ActionError: { index: 0, kind: 'AccountDoesNotExist' } } } } }];
  const { port } = await boot(t, [doc], { invoice: onchainInvoice(doc), txResult: tx });
  const r = await call(port, 'POST', `/api/invoices/${doc.invoice_id}/sweep`, {});
  assert.equal(r.json.paid, false);
  assert.notEqual(r.status, 200);
});

// ---- client-3 ----
function forged(real: InvoiceDoc): InvoiceDoc {
  const f: any = { ...real, invoice_id: 'FAKE', amount_raw: '1000000000000000000000000000', amount_display: '1000' };
  return f;
}
test('client-3: a forged doc that copies a PAID invoice account_id shows UNVERIFIED (dashboard) and fails `zi status`', async (t) => {
  const real = makeDoc();
  const fake = forged(real);
  const { port, dir, rpc } = await boot(t, [fake], { invoice: onchainInvoice(real, { status: 'PAID', paid_by: 'p.testnet' }) }, real);
  const s = await call(port, 'GET', '/api/invoices/FAKE/status');
  assert.equal(s.json.state, 'UNVERIFIED');
  assert.equal(badgeLabel(s.json), 'UNVERIFIED');
  assert.equal(s.json.invoice, null);
  assert.equal((await call(port, 'GET', '/api/invoices')).json[0].unverified_reason?.length > 0, true);
  const cli = await runCli(['status', 'FAKE'], { ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED });
  assert.equal(cli.code, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /STATE UNVERIFIED/);
  assert.ok(!/status=PAID/.test(cli.stdout));
});

test('client-3: a self-consistent doc whose account runs another contract or other terms is UNVERIFIED; the honest one is not', async (t) => {
  const doc = makeDoc();
  const hashed = await boot(t, [doc], { hash: FOREIGN, invoice: onchainInvoice(doc) });
  assert.equal((await call(hashed.port, 'GET', `/api/invoices/${doc.invoice_id}/status`)).json.state, 'UNVERIFIED');
  const terms = await boot(t, [doc], { invoice: onchainInvoice(doc, { tax_vault: 'evil.testnet' }) });
  assert.equal((await call(terms.port, 'GET', `/api/invoices/${doc.invoice_id}/status`)).json.state, 'UNVERIFIED');
  const ok = await boot(t, [doc], { invoice: onchainInvoice(doc, { status: 'PAID' }) });
  const r = await call(ok.port, 'GET', `/api/invoices/${doc.invoice_id}/status`);
  assert.equal(r.json.state, 'INITIALIZED');
  assert.equal(r.json.invoice.status, 'PAID');
});

test('client-3: decimals in a token doc that disagree with the allow-list are UNVERIFIED, not "1 tUSDC"', async (t) => {
  const tok = makeTokenDoc();
  const bad: any = { ...tok, asset: { ...(tok as any).asset, decimals: 12 } };
  const { port } = await boot(t, [bad], { invoice: onchainInvoice(tok) }, tok);
  assert.equal((await call(port, 'GET', `/api/invoices/${bad.invoice_id}/status`)).json.state, 'UNVERIFIED');
});

// ---- client-4 ----
test('client-4: a POST without (or with a wrong) API token is 403 and signs / writes nothing', async (t) => {
  const doc = makeDoc();
  const { port, rpc, dir } = await boot(t, [doc], { invoice: onchainInvoice(doc), txResult: payResult(doc, 'PAID') });
  const before = rpc.calls.length;
  for (const headers of [{ 'x-zi-token': '' }, { 'x-zi-token': 'wrong' }, { 'x-zi-token': TEST_TOKEN + 'x' }]) {
    for (const [path, body] of [[`/api/invoices/${doc.invoice_id}/pay`, {}], [`/api/invoices/${doc.invoice_id}/plain`, { amount_near: '5' }], [`/api/invoices/${doc.invoice_id}/sweep`, {}],
      ['/api/invoices', { id: 'X1', merchant: 'a.testnet', tax_vault: 'a.testnet', tax_bps: '1', amount: '1', expires_in_minutes: '5' }]] as const) {
      const r = await call(port, 'POST', path, body, headers);
      assert.equal(r.status, 403, `${path} ${JSON.stringify(headers)}`);
    }
  }
  // no header at all (a local process that does not know the token)
  await new Promise<void>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, method: 'POST', path: `/api/invoices/${doc.invoice_id}/pay`, headers: { 'content-type': 'application/json' } }, (res) => { assert.equal(res.statusCode, 403); res.resume(); res.on('end', resolve); });
    r.on('error', reject); r.end('{}');
  });
  assert.equal(rpc.calls.length, before, 'no RPC call (no signing) happened');
  assert.deepEqual(listDocs(dir).map((d) => d.invoice_id), [doc.invoice_id]);
  assert.equal((await call(port, 'POST', `/api/invoices/${doc.invoice_id}/pay`, {})).status, 200, 'the right token works');
});

test('client-4: the token is random per server and is not in anything GET serves', async (t) => {
  const dir = tempDir();
  const cfg = loadConfig({ ZI_INVOICE_DIR: dir, ZI_CODE_HASH: DEPLOYED });
  const a = await serve(cfg, 0); const b = await serve(cfg, 0);
  t.after(async () => { await new Promise<void>((r) => (a as Server).close(() => r())); await new Promise<void>((r) => (b as Server).close(() => r())); });
  const pa = (a.address() as AddressInfo).port;
  for (const path of ['/', '/app.js', '/state.js', '/api/invoices']) assert.ok(!/[0-9a-f]{32,}/.test((await call(pa, 'GET', path)).text), path);
  assert.equal((await call(pa, 'POST', '/api/invoices', {}, { 'x-zi-token': TEST_TOKEN })).status, 403);
});

// ---- client-5 ----
const sendEnv = async (h: Record<string, (p: any) => unknown>) => {
  const rpc = await fakeRpc({ status: () => ({ chain_id: 'testnet', protocol_version: 88, version: { version: 't' } }), block: () => ({ header: { hash: '11111111111111111111111111111111' } }),
    query: () => ({ nonce: 5 }), ...h });
  const s = throwawaySigner();
  const cfg = loadConfig({ ZI_RPC_URL: rpc.url, ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret });
  return { rpc, cfg, signer: cfg.payer! };
};
const timeoutErr = { __error: { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR', info: {} }, code: -32000, message: 'Server error' } };
const unknownTx = { __error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, code: -32000, message: 'Server error' } };
const okTx = { status: { SuccessValue: '' }, transaction: { hash: 'H', receiver_id: 'r.testnet', actions: [] }, receipts_outcome: [], receipts: [] };

test('client-5: a send_tx TIMEOUT_ERROR is in flight: tx_status is polled and the landed tx is returned', async () => {
  process.env.ZI_RPC_BACKOFF_MS = '1';
  let polls = 0;
  const { rpc, cfg, signer } = await sendEnv({ send_tx: () => timeoutErr, EXPERIMENTAL_tx_status: () => (++polls < 3 ? unknownTx : okTx) });
  try {
    const p = await sendActions(cfg, signer, 'r.testnet', [], 'plain');
    assert.equal(p.success, true);
    assert.equal(polls, 3);
    assert.equal(rpc.calls.filter((c) => c.method === 'send_tx').length, 1, 'never re-sent');
  } finally { await rpc.close(); }
});

test('client-5: a tx that stays unknown says it may still be included and never says rejected', async () => {
  process.env.ZI_RPC_BACKOFF_MS = '1';
  const { rpc, cfg, signer } = await sendEnv({ send_tx: () => timeoutErr, EXPERIMENTAL_tx_status: () => timeoutErr });
  try {
    await assert.rejects(() => sendActions(cfg, signer, 'r.testnet', [], 'plain'), (e: Error) => /may still be included/.test(e.message) && /before retrying/.test(e.message) && !/rejected/.test(e.message));
  } finally { await rpc.close(); }
});

test('client-5: a definite send_tx error is still "rejected" and tx_status is not polled', async () => {
  const { rpc, cfg, signer } = await sendEnv({ send_tx: () => ({ __error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION', info: {} }, message: 'bad' } }), EXPERIMENTAL_tx_status: () => okTx });
  try {
    await assert.rejects(() => sendActions(cfg, signer, 'r.testnet', [], 'plain'), /send_tx rejected/);
    assert.equal(rpc.calls.filter((c) => c.method === 'EXPERIMENTAL_tx_status').length, 0);
  } finally { await rpc.close(); }
});

// ---- client-6 ----
const failFtBalance = (h: any) => ({ ...h, query: (p: any) => (p.request_type === 'call_function' && p.method_name === 'ft_balance_of' ? { __error: { name: 'HANDLER_ERROR', cause: { name: 'X' }, message: 'view failed' } } : h.query(p)) });
test('client-6: a failed ft_balance_of is unknown (null + error), not "0", in the dashboard status and `zi status`', async (t) => {
  const tok = makeTokenDoc();
  const { port, dir, rpc } = await boot(t, [tok], { uninitialized: true }, tok, {}, failFtBalance);
  const s = await call(port, 'GET', `/api/invoices/${tok.invoice_id}/status`);
  assert.equal(s.json.token_balance_raw, null);
  assert.match(s.json.token_balance_error, /ft_balance_of|view failed|call_function/);
  assert.match(amountLabel({ amount_display: '1.5', unit: 'tUSDC' }, s.json), /token balance unknown/);
  const cli = await runCli(['status', tok.invoice_id], { ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED, ZI_TUSDC_ACCOUNT: 'tusdc.example.testnet', ZI_RPC_BACKOFF_MS: '1' });
  assert.match(cli.stdout, /tokens=UNKNOWN/);
  assert.equal(cli.code, 0, cli.stderr);
});

test('client-6: a readable balance is still shown (regression guard)', async (t) => {
  const tok = makeTokenDoc();
  const { port } = await boot(t, [tok], { uninitialized: true, ftBalance: '1500000' }, tok);
  const s = await call(port, 'GET', `/api/invoices/${tok.invoice_id}/status`);
  assert.equal(s.json.token_balance_raw, '1500000');
  assert.equal(s.json.token_balance_error, undefined);
});

// ---- client-7 ----
test('client-7: parseTxStatus keeps zeroinit events only from the invoice account', () => {
  const ev = (id: string) => 'EVENT_JSON:' + JSON.stringify({ standard: 'zeroinit', version: '3.0.0', event: 'invoice_paid', data: [{ invoice_id: id, account_id: id }] });
  const p = parseTxStatus({ status: { SuccessValue: '' }, transaction: { hash: 'H', receiver_id: 'x' },
    receipts_outcome: [{ outcome: { executor_id: '0uA', logs: [ev('A')], status: { SuccessValue: '' } } }, { outcome: { executor_id: 'look-alike.testnet', logs: [ev('B')], status: { SuccessValue: '' } } }], receipts: [] }, '0uA');
  assert.deepEqual(p.events.map((e) => e.data[0].invoice_id), ['A']);
});

test('client-7: receipt --tx with another invoice\'s tx fails and writes no receipt; its own tx works', async (t) => {
  const mine = makeDoc(DEPLOYED, { invoice_id: 'INV-MINE' });
  const other = makeDoc(DEPLOYED, { invoice_id: 'INV-OTHER', salt: 99n });
  const paid = { status: 'PAID', paid_by: 'p.testnet', paid_amount: '1000000000000000000000000', tax_amount: '80000000000000000000000' };
  const ev = (d: InvoiceDoc) => 'EVENT_JSON:' + JSON.stringify({ standard: 'zeroinit', version: '3.0.0', event: 'invoice_paid', data: [{ invoice_id: d.invoice_id, account_id: d.account_id }] });
  const txFor = (d: InvoiceDoc) => ({ status: { SuccessValue: b64('PAID') }, transaction: { hash: 'H-' + d.invoice_id, signer_id: 'p.testnet', receiver_id: d.account_id, actions: [] }, receipts: [],
    receipts_outcome: [{ id: 'r', outcome: { executor_id: d.account_id, logs: [ev(d)], status: { SuccessValue: '' } } }] });
  for (const [d, ok] of [[other, false], [mine, true]] as const) {
    const dir = tempDir(); writeDoc(dir, mine);
    const rpc = await fakeRpc(handlers(mine, { invoice: onchainInvoice(mine, paid), txResult: txFor(d) }));
    try {
      const r = await runCli(['receipt', mine.invoice_id, '--tx', 'DEADBEEF', '--json'], { ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url, ZI_CODE_HASH: DEPLOYED });
      if (ok) {
        assert.equal(r.code, 0, r.stderr);
        assert.equal(JSON.parse(r.stdout).tx_hash, 'H-INV-MINE');
      } else {
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /does not belong to this invoice/);
        assert.throws(() => readFileSync(join(dir, 'INV-MINE.receipt.json')));
      }
    } finally { await rpc.close(); }
  }
});

// ---- client-8 ----
test('client-8: listDocs skips unparsable and non-invoice files with a warning; the API still answers a list', async (t) => {
  const good = makeDoc();
  const { port, dir } = await boot(t, [good], {});
  writeFileSync(join(dir, 'half.json'), '{"format": "zeroinit-inv');
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ format: 'zeroinit-fixture/1', invoices: [], calls: [] }));
  writeFileSync(join(dir, 'arr.json'), '[1,2]');
  const warns: string[] = [];
  assert.deepEqual(listDocs(dir, (m) => warns.push(m)).map((d) => d.invoice_id), [good.invoice_id]);
  assert.equal(warns.length, 3);
  const r = await call(port, 'GET', '/api/invoices');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((d: any) => d.invoice_id), [good.invoice_id]);
});

test('client-8: the dashboard files are found when the server runs from another directory', async (t) => {
  const { port } = await boot(t, [], {});
  const cwd = process.cwd();
  process.chdir(tempDir());
  try {
    assert.equal((await call(port, 'GET', '/')).status, 200);
    assert.equal((await call(port, 'GET', '/state.js')).status, 200);
    assert.equal((await call(port, 'GET', '/app.js')).status, 200);
  } finally { process.chdir(cwd); }
});
