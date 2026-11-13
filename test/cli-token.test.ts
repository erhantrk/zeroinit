// Token flows in the CLI (docs/STABLECOIN.md §10, §11.2): registration, init+fund, ft_transfer_call,
// token sweep/refund, status/verify lines, and the exit codes. Fake JSON-RPC, throwaway signer.
// Run: node --test test/cli-token.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOYED, tempDir, makeTokenDoc, makeDoc, writeDoc, throwawaySigner, fakeRpc, handlers, statusResult, viewResult,
  unknownAccount, onchainInvoice, runCli, decodeSignedTx, b64, type Chain } from './helpers.ts';
import type { InvoiceDoc } from '../src/invoice.ts';

const TOKEN = 'tusdc.example.testnet';
const MIN = '1250000000000000000000';

const eventLog = (e: any) => 'EVENT_JSON:' + JSON.stringify(e);
const paidEvent = (doc: InvoiceDoc, payer = 'payer.testnet') => ({ standard: 'zeroinit', version: '3.0.0', event: 'invoice_paid',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, via: 'pay', payer, amount: '1500000', merchant_amount: '1380000',
    tax_amount: '120000', excess_refunded: '0', late: false, retried: false, token: TOKEN }] });
const rejectedEvent = (doc: InvoiceDoc, reason: string) => ({ standard: 'zeroinit', version: '3.0.0', event: 'payment_rejected',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, sender: 'payer.testnet', amount: '500000', reason, predecessor: TOKEN, token: TOKEN }] });
const failedEvent = (doc: InvoiceDoc) => ({ standard: 'zeroinit', version: '3.0.0', event: 'transfer_failed',
  data: [{ invoice_id: doc.invoice_id, account_id: doc.account_id, role: 'merchant', to: 'zi-merchant.testnet', amount: '1380000', token: TOKEN }] });

function txResult(doc: InvoiceDoc, returnValue: string, events: any[] = []) {
  return {
    status: { SuccessValue: b64(returnValue) },
    transaction: { hash: 'H', signer_id: 'payer.testnet', receiver_id: doc.account_id, actions: [] },
    receipts: [],
    receipts_outcome: events.map((e, i) => ({ id: `c${i}`, outcome: { executor_id: doc.account_id, logs: [eventLog(e)], status: { SuccessValue: '' } } })),
  };
}
function failedTx(msg: string) {
  return { status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } },
    transaction: { hash: 'H', signer_id: 'payer.testnet', receiver_id: 'x', actions: [] }, receipts: [], receipts_outcome: [] };
}

async function setup(doc: InvoiceDoc, ch: Chain, extraEnv: Record<string, string> = {}) {
  const dir = tempDir(); writeDoc(dir, doc);
  const rpc = await fakeRpc(handlers(doc, ch));
  const s = throwawaySigner();
  const env = { ZI_RPC_URL: rpc.url, ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: TOKEN,
    ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret, ZI_SWEEPER_ACCOUNT: s.account, ZI_SWEEPER_KEY: s.secret, ...extraEnv };
  const sent = () => rpc.calls.filter((c) => c.method === 'send_tx').map((c) => decodeSignedTx(c.params.signed_tx_base64));
  return { dir, rpc, env, sent };
}

test('pay token: init+fund, then [storage_deposit, ft_transfer_call] in one transaction (1 yocto, 200 Tgas, exact msg)', async () => {
  const doc = makeTokenDoc();
  const { rpc, env, sent } = await setup(doc, { storageBalance: null, txResult: txResult(doc, '0', [paidEvent(doc)]) });
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /REGISTERED .* in the same transaction/);
    const txs = sent();
    assert.equal(txs.length, 2, `${txs.length} transactions`);
    assert.equal(txs[0].receiver, doc.account_id);
    assert.deepEqual(txs[0].actions.map((a) => a.kind), ['UniversalStateInit', 'FunctionCall']);
    assert.equal(txs[0].actions[1].method, 'fund');
    assert.equal(txs[0].actions[1].deposit, 1000n);
    assert.equal(txs[1].receiver, TOKEN);
    assert.deepEqual(txs[1].actions.map((a) => a.method), ['storage_deposit', 'ft_transfer_call']);
    assert.equal(txs[1].actions[0].deposit, 1_250_000_000_000_000_000_000n);
    assert.deepEqual(JSON.parse(txs[1].actions[0].args ?? ''), { account_id: doc.account_id, registration_only: true });
    assert.equal(txs[1].actions[1].deposit, 1n);
    assert.equal(txs[1].actions[1].gas, 200_000_000_000_000n);
    assert.deepEqual(JSON.parse(txs[1].actions[1].args ?? ''), { receiver_id: doc.account_id, amount: '1500000', msg: `{"action":"pay","invoice_id":"${doc.invoice_id}"}` });
  } finally { await rpc.close(); }
});

test('pay token: no second registration, no init when the account exists', async () => {
  const doc = makeTokenDoc();
  const { rpc, env, sent } = await setup(doc, { storageBalance: { total: MIN, available: '0' }, invoice: onchainInvoice(doc, { status: 'OPEN' }), txResult: txResult(doc, '0', [paidEvent(doc)]) });
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const txs = sent();
    assert.equal(txs.length, 1, `${txs.length} transactions`);
    assert.equal(txs[0].actions[0].method, 'ft_transfer_call');
  } finally { await rpc.close(); }
});

test('pay token exit codes: 0 only with invoice_paid; rejections and pending are 1', async () => {
  const doc = makeTokenDoc();
  const cases: Array<[string, any, number, RegExp]> = [
    ['invoice_paid', txResult(doc, '0', [paidEvent(doc)]), 0, /TX /],
    ['payment_rejected', txResult(doc, '1500000', [rejectedEvent(doc, 'underpaid')]), 1, /payment_rejected underpaid/],
    ['pending', txResult(doc, '0'), 1, /NOT PAID yet/],
    ['transfer_failed', txResult(doc, '0', [failedEvent(doc)]), 1, /payout\(s\) failed/],
    ['tx failure', failedTx('boom'), 1, /RESULT FAILED/],
  ];
  for (const [name, txResultValue, code, re] of cases) {
    const { rpc, env } = await setup(doc, { storageBalance: { total: MIN, available: '0' }, invoice: onchainInvoice(doc), txResult: txResultValue });
    try {
      const r = await runCli(['pay', doc.invoice_id], env);
      assert.equal(r.code, code, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(`${r.stdout}\n${r.stderr}`, re, name);
    } finally { await rpc.close(); }
  }
});

test('pay --plain: [storage_deposit, ft_transfer] in one transaction, no state init', async () => {
  const doc = makeTokenDoc();
  const { rpc, env, sent } = await setup(doc, { storageBalance: null, txResult: txResult(doc, '') });
  try {
    const r = await runCli(['pay', doc.invoice_id, '--plain'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const txs = sent();
    assert.equal(txs.length, 1);
    assert.equal(txs[0].receiver, TOKEN);
    assert.deepEqual(txs[0].actions.map((a) => a.method), ['storage_deposit', 'ft_transfer']);
    assert.equal(txs[0].actions[1].deposit, 1n);
    assert.ok(txs.every((t) => t.actions.every((a) => a.kind !== 'UniversalStateInit')));
  } finally { await rpc.close(); }
});

test('sweep token: [state init, fund, sweep] when nonexistent, [fund, sweep] with a low float, [sweep] when funded', async () => {
  const doc = makeTokenDoc();
  {
    const { rpc, env, sent } = await setup(doc, { txResult: txResult(doc, 'PAID') });
    try {
      const r = await runCli(['sweep', doc.invoice_id], env);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const txs = sent();
      assert.deepEqual(txs[0].actions.map((a) => a.kind), ['UniversalStateInit', 'FunctionCall', 'FunctionCall']);
      assert.deepEqual(txs[0].actions.slice(1).map((a) => a.method), ['fund', 'sweep']);
      assert.equal(txs[0].actions[2].gas, 200_000_000_000_000n);
    } finally { await rpc.close(); }
  }
  {
    // 50 yocto is below the 100-yocto float: fund then sweep
    const { rpc, env, sent } = await setup(doc, { invoice: onchainInvoice(doc), accountAmount: '50', txResult: txResult(doc, 'PAID') });
    try {
      const r = await runCli(['sweep', doc.invoice_id], env);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(sent()[0].actions.map((a) => a.kind), ['FunctionCall', 'FunctionCall']);
      assert.deepEqual(sent()[0].actions.map((a) => a.method), ['fund', 'sweep']);
    } finally { await rpc.close(); }
  }
  {
    // 1000 yocto: sweep alone
    const { rpc, env, sent } = await setup(doc, { invoice: onchainInvoice(doc), accountAmount: '1000', txResult: txResult(doc, 'PAID') });
    try {
      const r = await runCli(['sweep', doc.invoice_id], env);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(sent()[0].actions.map((a) => a.kind), ['FunctionCall']);
      assert.equal(sent()[0].actions[0].method, 'sweep');
    } finally { await rpc.close(); }
  }
});

test('sweep token exit codes: UNDERPAID, NOTHING_TO_SWEEP, NEEDS_YOCTO, BALANCE_UNAVAILABLE, CONCURRENT_PAYMENT are 1', async () => {
  const doc = makeTokenDoc();
  for (const value of ['UNDERPAID', 'NOTHING_TO_SWEEP', 'NEEDS_YOCTO', 'BALANCE_UNAVAILABLE', 'CONCURRENT_PAYMENT']) {
    const { rpc, env } = await setup(doc, { txResult: txResult(doc, value) });
    try {
      const r = await runCli(['sweep', doc.invoice_id], env);
      assert.equal(r.code, 1, `${value}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(`SWEEP NOT COMPLETE: ${value}`), value);
    } finally { await rpc.close(); }
  }
});

test('token register: storage_deposit with the bounds minimum and registration_only', async () => {
  const doc = makeTokenDoc();
  // the real token answers storage_deposit with a StorageBalance object: it must not print as "[object Object]"
  const { rpc, env, sent } = await setup(doc, { txResult: txResult(doc, '{"total":"1250000000000000000000","available":"0"}') });
  try {
    const r = await runCli(['token', 'register', doc.account_id], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /\[object Object\]/);
    assert.match(r.stdout, /RESULT \{"total":"1250000000000000000000","available":"0"\}/);
    const txs = sent();
    assert.equal(txs.length, 1);
    assert.equal(txs[0].receiver, TOKEN);
    assert.deepEqual(JSON.parse(txs[0].actions[0].args ?? ''), { account_id: doc.account_id, registration_only: true });
    assert.equal(txs[0].actions[0].deposit, BigInt(MIN));
  } finally { await rpc.close(); }
});

test('token balance and status show display units', async () => {
  const doc = makeTokenDoc();
  {
    const { rpc, env } = await setup(doc, { ftBalance: '1500000' });
    try {
      const b = await runCli(['token', 'balance', doc.account_id], env);
      assert.equal(b.code, 0, b.stdout + b.stderr);
      assert.match(b.stdout, /BALANCE 1\.5 tUSDC/);
      const s = await runCli(['status', doc.invoice_id], env);
      assert.equal(s.code, 0, s.stdout + s.stderr);
      assert.match(s.stdout, /STATE NONEXISTENT tokens_parked=1\.5 tUSDC/);
    } finally { await rpc.close(); }
  }
  {
    const { rpc, env } = await setup(doc, { invoice: onchainInvoice(doc, { status: 'SETTLING' }), ftBalance: '0' });
    try {
      const s = await runCli(['status', doc.invoice_id], env);
      assert.equal(s.code, 0, s.stdout + s.stderr);
      assert.match(s.stdout, /STATE INITIALIZED status=SETTLING/);
      assert.match(s.stdout, /owed_merchant=0 owed_tax=0 owed_payer=0/);
    } finally { await rpc.close(); }
  }
});

test('refund-payer too early prints the time it becomes allowed', async () => {
  const doc = makeTokenDoc();
  const { rpc, env } = await setup(doc, { txResult: failedTx('NOT_YET: refundable after 1794700800000') });
  try {
    const r = await runCli(['refund-payer', doc.invoice_id], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /NOT YET: refundable after 2026-/);
    assert.match(r.stderr, /1794700800000/);
  } finally { await rpc.close(); }
});

test('verify token: token-allowed and token-metadata-onchain, offline and online', async () => {
  const doc = makeTokenDoc();
  const dir = tempDir(); writeDoc(dir, doc);
  const offline = await runCli(['verify', doc.invoice_id, '--offline'], { ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: TOKEN });
  assert.equal(offline.code, 0, offline.stdout);
  assert.match(offline.stdout, /PASS token-allowed tUSDC tusdc\.example\.testnet/);
  const noAllow = await runCli(['verify', doc.invoice_id, '--offline'], { ZI_INVOICE_DIR: dir });
  assert.equal(noAllow.code, 1, noAllow.stdout);
  assert.match(noAllow.stdout, /FAIL token-allowed/);
  const { rpc, env } = await setup(doc, { invoice: onchainInvoice(doc, { status: 'OPEN' }), ftBalance: '0' });
  try {
    const r = await runCli(['verify', doc.invoice_id], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS token-metadata-onchain tUSDC 6/);
    assert.match(r.stdout, /PASS terms-onchain/);
  } finally { await rpc.close(); }
});

test('pay NEAR v3: 100 Tgas, PAID is 0 and PAYOUT_PENDING is 1', async () => {
  const doc = makeDoc();
  for (const [value, code] of [['PAID', 0], ['PAYOUT_PENDING', 1]] as const) {
    const { rpc, env, sent } = await setup(doc, { txResult: txResult(doc, value) }, { ZI_TUSDC_ACCOUNT: '' });
    try {
      const r = await runCli(['pay', doc.invoice_id], env);
      assert.equal(r.code, code, `${value}: ${r.stdout}${r.stderr}`);
      // PAYOUT_PENDING is an accepted payment with a failed payout, never "the deposit was refunded".
      if (value === 'PAYOUT_PENDING') {
        assert.doesNotMatch(r.stderr, /deposit was refunded/);
        assert.match(r.stderr, /NOT PAID \(yet\): PAYOUT_PENDING/);
      }
      const txs = sent();
      const pay = txs[txs.length - 1].actions.find((a) => a.method === 'pay');
      assert.equal(pay?.gas, 100_000_000_000_000n);
      assert.equal(pay?.deposit, 1_000_000_000_000_000_000_000_000n);
    } finally { await rpc.close(); }
  }
});

test('invoice new --token: display units, the allow-list, and the online registration check', async () => {
  const dir = tempDir();
  const args = (id: string, extra: string[] = []) => ['invoice', 'new', '--id', id, '--merchant', 'zi-merchant.testnet', '--tax-vault', 'zi-taxvault.testnet',
    '--tax-bps', '800', '--amount', '1.5', '--expires-in', '2h', '--token', 'tUSDC', ...extra];
  const noAllow = await runCli(args('INV-TOK-1', ['--offline']), { ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: '' });
  assert.equal(noAllow.code, 2, noAllow.stderr);
  assert.match(noAllow.stderr, /allow-list is empty/);
  // No ZI_TUSDC_ACCOUNT at all: the client defaults to the deployed testnet tUSDC mock.
  const dflt = await runCli(args('INV-TOK-0', ['--offline']), { ZI_INVOICE_DIR: dir });
  assert.equal(dflt.code, 0, dflt.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, 'INV-TOK-0.json'), 'utf8')).asset.contract, 'sm1110-tusdc.testnet');
  const offline = await runCli(args('INV-TOK-1', ['--offline']), { ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: TOKEN });
  assert.equal(offline.code, 0, offline.stderr);
  const doc = JSON.parse(readFileSync(join(dir, 'INV-TOK-1.json'), 'utf8'));
  assert.equal(doc.format, 'zeroinit-invoice/2');
  assert.equal(doc.amount_raw, '1500000');
  assert.equal(doc.amount_display, '1.5');
  assert.deepEqual(doc.asset, { kind: 'ft', contract: TOKEN, symbol: 'tUSDC', decimals: 6 });

  const ok = await fakeRpc({
    status: () => statusResult('testnet'),
    query: (p: any) => {
      if (p.request_type === 'view_account') return { amount: '1', storage_usage: 1, global_contract_hash: null };
      if (p.method_name === 'ft_metadata') return viewResult({ spec: 'ft-1.0.0', symbol: 'tUSDC', decimals: 6 });
      if (p.method_name === 'storage_balance_of') return viewResult({ total: MIN, available: '0' });
      return unknownAccount;
    },
  });
  try {
    const online = await runCli(args('INV-TOK-2'), { ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: TOKEN, ZI_RPC_URL: ok.url });
    assert.equal(online.code, 0, online.stderr);
    assert.equal(existsSync(join(dir, 'INV-TOK-2.json')), true);
  } finally { await ok.close(); }
  const unregistered = await fakeRpc({
    status: () => statusResult('testnet'),
    query: (p: any) => {
      if (p.request_type === 'view_account') return { amount: '1', storage_usage: 1, global_contract_hash: null };
      if (p.method_name === 'ft_metadata') return viewResult({ spec: 'ft-1.0.0', symbol: 'tUSDC', decimals: 6 });
      if (p.method_name === 'storage_balance_of') return viewResult(null);
      return unknownAccount;
    },
  });
  try {
    const bad = await runCli(args('INV-TOK-3'), { ZI_INVOICE_DIR: dir, ZI_TUSDC_ACCOUNT: TOKEN, ZI_RPC_URL: unregistered.url });
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /not registered on token/);
    assert.equal(existsSync(join(dir, 'INV-TOK-3.json')), false);
  } finally { await unregistered.close(); }
});

// A real ft_transfer_call transaction is sent TO the token: tx.receiver_id is the token, and a payout that fails because the
// merchant is not registered fails on the TOKEN account. That is a downstream failure (the invoice records it as owed), not a failed
// transaction. Before the fix sendActions parsed the tx with the token as "the invoice", so it printed RESULT FAILED and exited as a tx failure.
test('pay token: an unregistered merchant (ft_transfer fails on the token) is a downstream failure, not a failed tx', async () => {
  const doc = makeTokenDoc();
  const ev = failedEvent(doc);
  const tx = {
    status: { SuccessValue: b64('0') },
    transaction: { hash: 'H', signer_id: 'payer.testnet', receiver_id: TOKEN, actions: [] },
    receipts: [],
    receipts_outcome: [
      { id: 'a', outcome: { executor_id: TOKEN, logs: [], status: { SuccessValue: '' } } },
      { id: 'b', outcome: { executor_id: TOKEN, logs: [], status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: The account zi-merchant.testnet is not registered' } } } } } } },
      { id: 'c', outcome: { executor_id: doc.account_id, logs: [eventLog(ev)], status: { SuccessValue: '' } } },
    ],
  };
  const { rpc, env } = await setup(doc, { storageBalance: { total: MIN, available: '0' }, invoice: onchainInvoice(doc), txResult: tx });
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /RESULT FAILED/, 'the transaction itself succeeded');
    assert.match(r.stdout, /RESULT 0/);
    assert.match(r.stdout, /TRANSFER_FAILED/);
    assert.match(r.stderr, /payout\(s\) failed/);
  } finally { await rpc.close(); }
});

// audit claims-3: ft_on_transfer cannot see tokens parked by a plain ft_transfer, so a one-step payment on top would be charged twice.
test('pay token refuses when tokens are already parked (no transaction sent); --allow-parked and --plain go through', async () => {
  const doc = makeTokenDoc();
  const chain: Chain = { storageBalance: { total: MIN, available: '0' }, ftBalance: '1500000', invoice: onchainInvoice(doc, { status: 'OPEN' }), txResult: txResult(doc, '0', [paidEvent(doc)]) };
  const a = await setup(doc, chain);
  try {
    const r = await runCli(['pay', doc.invoice_id], a.env);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /already holds 1\.5 \w+ from a plain transfer: run `zi sweep /);
    assert.equal(a.sent().length, 0, 'nothing may be signed');
  } finally { await a.rpc.close(); }
  const b = await setup(doc, chain);
  try {
    const r = await runCli(['pay', doc.invoice_id, '--allow-parked'], b.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(b.sent().at(-1)?.actions[0].method, 'ft_transfer_call');
  } finally { await b.rpc.close(); }
  const c = await setup(doc, { ...chain, txResult: txResult(doc, '') });
  try {
    const r = await runCli(['pay', doc.invoice_id, '--plain'], c.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(c.sent().at(-1)?.actions[0].method, 'ft_transfer');
  } finally { await c.rpc.close(); }
});
