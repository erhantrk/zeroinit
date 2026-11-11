// Audit claims-1, claims-11: `receipt --tx` falls back to the archival RPC when the default one has pruned the transaction;
// the mainnet URL check is a substring test, so the config tests pin exactly what it does and does not do.
// Fake JSON-RPC servers only. Run: node --test test/claims-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { DEPLOYED, tempDir, makeDoc, writeDoc, fakeRpc, handlers, onchainInvoice, b64, runCli } from './helpers.ts';
import type { InvoiceDoc } from '../src/invoice.ts';

const paid = { status: 'PAID', paid_by: 'p.testnet', paid_amount: '1000000000000000000000000', tax_amount: '80000000000000000000000' };
const txFor = (d: InvoiceDoc) => ({ status: { SuccessValue: b64('PAID') }, transaction: { hash: 'H-ARCH', signer_id: 'p.testnet', receiver_id: d.account_id, actions: [] }, receipts: [],
  receipts_outcome: [{ id: 'r', outcome: { executor_id: d.account_id, status: { SuccessValue: '' },
    logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'zeroinit', version: '3.0.0', event: 'invoice_paid', data: [{ invoice_id: d.invoice_id, account_id: d.account_id }] })] } }] });

test('claims-1: receipt --tx asks the archival endpoint when the default RPC says UNKNOWN_TRANSACTION', async () => {
  const doc = makeDoc(DEPLOYED, { invoice_id: 'INV-ARCH' });
  const dir = tempDir(); writeDoc(dir, doc);
  const pruned = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc, paid), txStatusError: true }));
  const archive = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc, paid), txResult: txFor(doc) }));
  try {
    const env = { ZI_INVOICE_DIR: dir, ZI_RPC_URL: pruned.url, ZI_CODE_HASH: DEPLOYED };
    // without an archival endpoint the lookup fails and says what to set
    const without = await runCli(['receipt', doc.invoice_id, '--tx', 'DEADBEEF', '--json'], env);
    assert.notEqual(without.code, 0);
    assert.match(without.stderr, /ZI_ARCHIVAL_RPC_URL=https:\/\/archival-rpc\.testnet\.fastnear\.com/);
    // with one, the receipt is produced from the archival answer
    const withArchive = await runCli(['receipt', doc.invoice_id, '--tx', 'DEADBEEF', '--json'], { ...env, ZI_ARCHIVAL_RPC_URL: archive.url });
    assert.equal(withArchive.code, 0, withArchive.stderr);
    assert.equal(JSON.parse(withArchive.stdout).tx_hash, 'H-ARCH');
    assert.ok(archive.calls.some((c) => c.method === 'EXPERIMENTAL_tx_status'));
  } finally { await pruned.close(); await archive.close(); }
});

test('claims-1: the archival default applies only to the default RPC, and a mainnet archival URL is refused', () => {
  assert.equal(loadConfig({}).archivalRpcUrl, 'https://archival-rpc.testnet.fastnear.com');
  assert.equal(loadConfig({ ZI_RPC_URL: 'https://rpc.testnet.fastnear.com' }).archivalRpcUrl, 'https://archival-rpc.testnet.fastnear.com', '.env.example sets the default URL explicitly');
  assert.equal(loadConfig({ ZI_RPC_URL: 'http://127.0.0.1:1' }).archivalRpcUrl, null);
  assert.equal(loadConfig({ ZI_RPC_URL: 'http://127.0.0.1:1', ZI_ARCHIVAL_RPC_URL: 'http://127.0.0.1:2' }).archivalRpcUrl, 'http://127.0.0.1:2');
  assert.throws(() => loadConfig({ ZI_ARCHIVAL_RPC_URL: 'https://archival-rpc.mainnet.fastnear.com' }), /mainnet/);
});

test('claims-11: the mainnet URL check is a substring test (documented); chain_id is the real guard', () => {
  assert.throws(() => loadConfig({ ZI_RPC_URL: 'https://rpc.mainnet.near.org' }), /mainnet/);
  // a mainnet endpoint without the word passes config: checkNetwork (rpc.ts) must refuse it by chain_id before any key is used
  assert.doesNotThrow(() => loadConfig({ ZI_RPC_URL: 'https://free.rpc.fastnear.com' }));
});
