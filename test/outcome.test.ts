// Run: node --test test/outcome.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTxStatus } from '../src/outcome.ts';

const f = JSON.parse(readFileSync('fixtures/synthetic-demo.json', 'utf8'));
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
