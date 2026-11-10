// Run: node --test test/outcome.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTxStatus } from '../src/outcome.ts';

const f = JSON.parse(readFileSync('fixtures/v2/synthetic-demo.json', 'utf8'));
const doc = f.invoices[0];
const txs = f.calls.find((c: any) => c.label === 'pay: tx_status').response.result;

test('parse synthetic PAY tx_status', () => {
  const p = parseTxStatus(txs, doc.account_id);
  assert.equal(p.success, true);
  assert.equal(p.returnValue, 'PAID');
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0].event, 'invoice_paid');
  assert.deepEqual(p.transfers.map((t) => [t.to, t.yocto.toString()]), [
    ['zi-merchant.testnet', '920000000000000000000000'], ['zi-taxvault.testnet', '80000000000000000000000']]);
  assert.equal(Buffer.from(p.stateInitBase64!, 'base64').toString('hex'), doc.raw_state_init_hex);
});

test('a failed receipt makes success false', () => {
  const bad = structuredClone(txs);
  bad.receipts_outcome[0].outcome.status = { Failure: { ActionError: { index: 1, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: UNDERPAID' } } } } };
  assert.equal(parseTxStatus(bad, doc.account_id).success, false);
});

test('a failed transfer on ANOTHER account (v2 records it via on_transfer) is a downstream failure, not a failed tx', () => {
  const tx = structuredClone(txs);
  const extra = structuredClone(tx.receipts_outcome[0]);
  extra.outcome.executor_id = 'nope.testnet';
  extra.outcome.status = { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: 'nope.testnet' } } } } };
  tx.receipts_outcome.push(extra);
  const p = parseTxStatus(tx, doc.account_id);
  assert.equal(p.success, true);
  assert.deepEqual(p.failures, []);
  assert.equal(p.downstreamFailures.length, 1);
  // the same failure executed ON the invoice account still fails the tx
  extra.outcome.executor_id = doc.account_id;
  const q = parseTxStatus(tx, doc.account_id);
  assert.equal(q.success, false);
  assert.equal(q.downstreamFailures.length, 0);
});

import { redactSignatures } from '../src/rpc.ts';
test('redactSignatures replaces every ed25519 signature value (no secret-looking 88-char value stays in a fixture) and nothing else', () => {
  const sig = 'ed25519:' + '5'.repeat(88);
  const pub = 'ed25519:' + '6'.repeat(44);
  const out = redactSignatures({ a: { signature: sig, public_key: pub }, list: [{ signature: sig, x: 1 }], approvals: [sig, null], signature: 7 });
  assert.equal(JSON.stringify(out).includes(sig), false);
  assert.equal(out.a.public_key, pub);
  assert.equal(out.list[0].x, 1);
  assert.equal(out.signature, 7);
  assert.deepEqual(out.approvals, ['ed25519:REDACTED-PUBLIC-SIGNATURE', null]);
  assert.match(out.a.signature, /^ed25519:REDACTED/);
});

// ---- v3 token fields (docs/STABLECOIN.md §10) ----
const b64o = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
const ftTx = () => ({
  status: { SuccessValue: b64o('0') },
  transaction: { hash: 'FT', signer_id: 'payer.testnet', receiver_id: 'tusdc.example.testnet',
    actions: [{ FunctionCall: { method_name: 'ft_transfer_call', args: b64o({ receiver_id: '0uinvoice', amount: '1500000', msg: '{"action":"pay"}' }), deposit: '1', gas: '200000000000000' } }] },
  receipts: [
    { receipt_id: 'r1', predecessor_id: '0uinvoice', receiver_id: 'tusdc.example.testnet',
      receipt: { Action: { actions: [{ FunctionCall: { method_name: 'ft_transfer', args: b64o({ receiver_id: 'zi-merchant.testnet', amount: '1380000' }), deposit: '1', gas: '15000000000000' } }] } } },
    { receipt_id: 'r2', predecessor_id: '0uinvoice', receiver_id: 'tusdc.example.testnet',
      receipt: { Action: { actions: [{ FunctionCall: { method_name: 'ft_transfer', args: b64o({ receiver_id: 'zi-taxvault.testnet', amount: '120000' }), deposit: '1', gas: '15000000000000' } }] } } },
  ],
  receipts_outcome: [
    { id: 'r1', outcome: { executor_id: 'tusdc.example.testnet', status: { SuccessValue: '' },
      logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: '0uinvoice', new_owner_id: 'zi-merchant.testnet', amount: '1380000' }] })] } },
    { id: 'r2', outcome: { executor_id: 'tusdc.example.testnet', status: { SuccessValue: '' }, logs: [] } },
  ],
});

test('v3: ftTransfers are decoded from the ft_transfer actions sent by the invoice account', () => {
  const p = parseTxStatus(ftTx(), '0uinvoice');
  assert.deepEqual(p.ftTransfers.map((t) => [t.token, t.to, t.amount.toString()]), [
    ['tusdc.example.testnet', 'zi-merchant.testnet', '1380000'],
    ['tusdc.example.testnet', 'zi-taxvault.testnet', '120000'],
  ]);
  assert.equal(p.transfers.length, 0);
});

test('v3: nep141 events are parsed separately from zeroinit events', () => {
  const p = parseTxStatus(ftTx(), '0uinvoice');
  assert.equal(p.events.length, 0);
  assert.equal(p.nep141Events.length, 1);
  assert.equal((p.nep141Events[0].data as any)[0].amount, '1380000');
});

test('v3: a failed ft_transfer receipt on the token account is a downstream failure', () => {
  const tx = ftTx();
  tx.receipts_outcome[0].outcome.status = { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: 'zi-merchant.testnet' } } } } };
  const p = parseTxStatus(tx, '0uinvoice');
  assert.equal(p.success, true);
  assert.deepEqual(p.failures, []);
  assert.equal(p.downstreamFailures.length, 1);
});

test('v3: an ft_transfer_call final value "0" is the unused amount, never PAID', () => {
  const p = parseTxStatus(ftTx(), '0uinvoice');
  assert.equal(p.returnValue, '0');
  assert.notEqual(p.returnValue, 'PAID');
});
