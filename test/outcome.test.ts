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
