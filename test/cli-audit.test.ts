// Audit fixes protocol-1, cli-server-secrets-1/2/3/6/7/8: `zi` pins the deployed code hash, exits non-zero on failure/refund,
// and never signs without the testnet check. Uses a local fake JSON-RPC server; nothing touches a real network.
// Run: node --test test/cli-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOYED, FOREIGN, tempDir, makeDoc, writeDoc, throwawaySigner, fakeRpc, statusResult, unknownAccount, viewResult, runCli, handlers, onchainInvoice, payResult } from './helpers.ts';
import type { InvoiceDoc } from '../src/invoice.ts';

async function setup(doc: InvoiceDoc, ch: Chain, extraEnv: Record<string, string> = {}) {
  const dir = tempDir(); writeDoc(dir, doc);
  const rpc = await fakeRpc(handlers(doc, ch));
  const s = throwawaySigner();
  const env = { ZI_RPC_URL: rpc.url, ZI_INVOICE_DIR: dir, ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret, ZI_SWEEPER_ACCOUNT: s.account, ZI_SWEEPER_KEY: s.secret, ...extraEnv };
  return { dir, rpc, env };
}

test('verify --offline FAILs (exit 1) a doc built on a foreign contract, before any payment', async () => {
  const doc = makeDoc(FOREIGN); const dir = tempDir(); writeDoc(dir, doc);
  const r = await runCli(['verify', doc.invoice_id, '--offline'], { ZI_INVOICE_DIR: dir });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /FAIL code-hash-trusted/);
  // an operator who deliberately pins their own deployment can verify it
  const own = await runCli(['verify', doc.invoice_id, '--offline'], { ZI_INVOICE_DIR: dir, ZI_CODE_HASH: FOREIGN });
  assert.equal(own.code, 0, own.stdout);
});

test('verify online: the on-chain hash is compared with the pinned hash, not with the doc', async () => {
  const doc = makeDoc(FOREIGN);
  const { rpc, env } = await setup(doc, { hash: FOREIGN, invoice: onchainInvoice(doc) });
  try {
    const r = await runCli(['verify', doc.invoice_id], env);   // pinned = DEPLOYED (ZI_CODE_HASH unset)
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /FAIL code-hash-trusted/);
    assert.match(r.stdout, /FAIL code-hash-onchain/);
  } finally { await rpc.close(); }
});

test('verify online: an honest invoice passes; a tampered tax_vault on chain fails', async () => {
  const doc = makeDoc();
  const ok = await setup(doc, { invoice: onchainInvoice(doc) });
  try {
    const r = await runCli(['verify', doc.invoice_id], ok.env);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /PASS code-hash-onchain/);
  } finally { await ok.rpc.close(); }
  const bad = await setup(doc, { invoice: onchainInvoice(doc, { tax_vault: 'evil.testnet' }) });
  try {
    const r = await runCli(['verify', doc.invoice_id], bad.env);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL terms-onchain/);
  } finally { await bad.rpc.close(); }
});

test('pay refuses a foreign-contract doc and never sends a transaction', async () => {
  const doc = makeDoc(FOREIGN);
  const { rpc, env } = await setup(doc, {});
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /refusing invoice .*not the trusted hash/);
    assert.equal(rpc.calls.some((c) => c.method === 'send_tx'), false);
  } finally { await rpc.close(); }
});

test('pay refuses a doc whose raw_state_init_hex was swapped, and never sends', async () => {
  const doc = { ...makeDoc(), raw_state_init_hex: '00'.repeat(40) };
  const { rpc, env } = await setup(doc, {});
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /raw_state_init_hex/);
    assert.equal(rpc.calls.some((c) => c.method === 'send_tx'), false);
  } finally { await rpc.close(); }
});

test('pay exits 1 for REFUNDED_* and 0 for PAID', async () => {
  const doc = makeDoc();
  for (const [value, code] of [['REFUNDED_UNDERPAID', 1], ['REFUNDED_EXPIRED', 1], ['REFUNDED_NOT_OPEN', 1], ['PAID', 0]] as const) {
    const { rpc, env } = await setup(doc, { invoice: onchainInvoice(doc), txResult: payResult(doc, value) });
    try {
      const r = await runCli(['pay', doc.invoice_id], env);
      assert.equal(r.code, code, `${value}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, new RegExp(`RESULT ${value}`));
    } finally { await rpc.close(); }
  }
});

test('pay on a mainnet RPC signs nothing (chain_id check runs inside the signing path)', async () => {
  const doc = makeDoc();
  const { rpc, env } = await setup(doc, { chainId: 'mainnet' });
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /chain_id is mainnet/);
    assert.equal(rpc.calls.some((c) => c.method === 'send_tx' || c.method === 'block'), false);
  } finally { await rpc.close(); }
});

test('receipt exits 1 and writes nothing when the invoice is not PAID, or any term differs on chain', async () => {
  const doc = makeDoc();
  const open = await setup(doc, { invoice: onchainInvoice(doc) });
  try {
    const r = await runCli(['receipt', doc.invoice_id], open.env);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /FAIL status/);
    assert.equal(existsSync(join(open.dir, `${doc.invoice_id}.receipt.json`)), false);
  } finally { await open.rpc.close(); }
  const paid = { status: 'PAID', paid_by: 'p.testnet', paid_amount: doc.amount_yocto, tax_amount: '80000000000000000000000' };
  const taxDiff = await setup(doc, { invoice: onchainInvoice(doc, { ...paid, tax_vault: 'evil.testnet' }) });
  try {
    const r = await runCli(['receipt', doc.invoice_id], taxDiff.env);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /FAIL terms_match_onchain/);
  } finally { await taxDiff.rpc.close(); }
  const foreignHash = await setup(doc, { hash: FOREIGN, invoice: onchainInvoice(doc, paid) });
  try {
    const r = await runCli(['receipt', doc.invoice_id], foreignHash.env);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /FAIL code_hash_matches/);
  } finally { await foreignHash.rpc.close(); }
  const good = await setup(doc, { invoice: onchainInvoice(doc, paid), txResult: payResult(doc, 'PAID') });
  try {
    const r = await runCli(['receipt', doc.invoice_id], good.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(good.dir, `${doc.invoice_id}.receipt.json`)), true);
    const withTx = await runCli(['receipt', doc.invoice_id, '--tx', 'DEADBEEF', '--json'], good.env);
    assert.equal(withTx.code, 0, withTx.stderr);
    assert.equal(JSON.parse(withTx.stdout).tx_hash, 'H');
  } finally { await good.rpc.close(); }
  const lookup = await setup(doc, { invoice: onchainInvoice(doc, paid), txStatusError: true });
  try {
    const r = await runCli(['receipt', doc.invoice_id, '--tx', 'DEADBEEF'], lookup.env);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /tx_status lookup failed/);
  } finally { await lookup.rpc.close(); }
});

test('invoice new rejects out-of-range salt and past / pre-1970 expiries', async () => {
  const dir = tempDir();
  const base = ['invoice', 'new', '--id', 'INV-R-1', '--merchant', 'zi-merchant.testnet', '--tax-vault', 'zi-taxvault.testnet', '--tax-bps', '800', '--amount', '1', '--offline'];
  const env = { ZI_INVOICE_DIR: dir };
  assert.notEqual((await runCli([...base, '--expires-in', '2h', '--salt', '18446744073709551658'], env)).code, 0);
  assert.notEqual((await runCli([...base, '--expires-in', '2h', '--salt', '-1'], env)).code, 0);
  assert.notEqual((await runCli([...base, '--expires-at', '1969-12-31T23:59:59Z'], env)).code, 0);
  assert.notEqual((await runCli([...base, '--expires-at', '2001-01-01T00:00:00Z'], env)).code, 0);
  assert.notEqual((await runCli([...base, '--expires-in', '2h', '--tax-bps', ''], env)).code, 0);
  const ok = await runCli([...base, '--expires-in', '2h', '--salt', '42'], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(existsSync(join(dir, 'INV-R-1.json')), true);
});

test('invoice new refuses a merchant that does not exist on testnet (typo) unless --offline', async () => {
  const doc = makeDoc();
  const rpc = await fakeRpc({ status: () => statusResult('testnet'),
    query: (p: any) => (p.account_id === 'zi-merchnt.testnet' ? unknownAccount : { amount: '1', storage_usage: 1, global_contract_hash: null }) });
  try {
    const dir = tempDir();
    const args = (merchant: string, id: string) => ['invoice', 'new', '--id', id, '--merchant', merchant, '--tax-vault', doc.tax_vault, '--tax-bps', '800', '--amount', '1', '--expires-in', '2h'];
    const env = { ZI_INVOICE_DIR: dir, ZI_RPC_URL: rpc.url };
    const typo = await runCli(args('zi-merchnt.testnet', 'INV-X-1'), env);
    assert.notEqual(typo.code, 0);
    assert.match(typo.stderr, /does not exist on testnet/);
    const mainnetId = await runCli(args('shop.near', 'INV-X-2'), env);
    assert.notEqual(mainnetId.code, 0);
    assert.match(mainnetId.stderr, /not a testnet account/);
    const ok = await runCli(args('zi-merchant.testnet', 'INV-X-3'), env);
    assert.equal(ok.code, 0, ok.stderr);
  } finally { await rpc.close(); }
});

test('pay refuses when a plain transfer already parked funds (contract v1 would charge twice) and never sends', async () => {
  const doc = makeDoc();
  const { rpc, env } = await setup(doc, { uninitialized: true });
  try {
    const r = await runCli(['pay', doc.invoice_id], env);
    assert.notEqual(r.code, 0, r.stdout);
    assert.match(r.stderr, /already holds 1 NEAR from a plain transfer: run `zi sweep/);
    assert.equal(rpc.calls.some((c) => c.method === 'send_tx'), false);
  } finally { await rpc.close(); }
});
