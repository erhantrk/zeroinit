// Refund rules proven on the real recorded fixture (INTERFACES.md §5.1-5.2).
// Run: node --test test/refund-cases.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayFixture } from '../src/replay.ts';
import { parseTxStatus, type ParsedTx } from '../src/outcome.ts';
import { decodeViewResult, accountStateFromResponse } from '../src/rpc.ts';
import { parseNear } from '../src/bytes.ts';

const FIXTURE = 'fixtures/refund-cases.json';
const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const doc = (id: string): any => {
  const d = f.invoices.find((x: any) => x.invoice_id === id);
  assert.ok(d, `invoice ${id} missing from ${FIXTURE}`);
  return d;
};
const calls = (id: string, label: string): any[] => f.calls.filter((c: any) => c.invoice_id === id && c.label === label);
const txResult = (id: string, n = 0): any => {
  const t = calls(id, 'pay: tx_status')[n];
  assert.ok(t, `${id}: pay tx #${n} missing`);
  return t.response.result;
};
const parsed = (id: string, n = 0): ParsedTx => parseTxStatus(txResult(id, n), doc(id).account_id);
const finalStatus = (id: string): string => {
  const after = calls(id, 'after: get_invoice');
  assert.ok(after.length > 0, `${id}: no after: get_invoice snapshot`);
  return decodeViewResult(after[after.length - 1].response).status;
};
const eventData = (p: ParsedTx, name: string): any => {
  const ev = p.events.find((e) => e.event === name);
  assert.ok(ev, `missing ${name} event`);
  return ev.data[0];
};
const paid = (p: ParsedTx, to: string): bigint => p.transfers.filter((t) => t.to === to).reduce((s, t) => s + t.yocto, 0n);

test('replay proves every refund case in fixtures/refund-cases.json', () => {
  const checks = replayFixture(FIXTURE);
  assert.ok(checks.length > 0);
  for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
  const statuses = checks.filter((c) => c.name.startsWith('after-status-'));
  assert.deepEqual(
    new Set(statuses.map((c) => c.name)),
    new Set(['after-status-OPEN', 'after-status-EXPIRED', 'after-status-PAID']),
  );
});

test('REF-UNDER: underpaid pay refunds 0.05 to the payer, reason underpaid, status stays OPEN', () => {
  const p = parsed('REF-UNDER');
  assert.equal(p.success, true);
  assert.equal(p.returnValue, 'REFUNDED_UNDERPAID');
  const ev = eventData(p, 'payment_refunded');
  assert.equal(ev.reason, 'underpaid');
  assert.equal(ev.invoice_id, 'REF-UNDER');
  assert.equal(ev.account_id, doc('REF-UNDER').account_id);
  assert.equal(ev.payer, txResult('REF-UNDER').transaction.signer_id);
  assert.equal(BigInt(ev.amount), parseNear('0.05'));
  assert.equal(paid(p, ev.payer), parseNear('0.05'));
  assert.equal(finalStatus('REF-UNDER'), 'OPEN');
});

test('REF-EXPIRED: expired pay refunds 0.1 to the payer, reason expired, status EXPIRED', () => {
  const p = parsed('REF-EXPIRED');
  assert.equal(p.success, true);
  assert.equal(p.returnValue, 'REFUNDED_EXPIRED');
  const ev = eventData(p, 'payment_refunded');
  assert.equal(ev.reason, 'expired');
  assert.equal(ev.payer, txResult('REF-EXPIRED').transaction.signer_id);
  assert.equal(BigInt(ev.amount), parseNear('0.1'));
  assert.equal(paid(p, ev.payer), parseNear('0.1'));
  assert.equal(finalStatus('REF-EXPIRED'), 'EXPIRED');
});

test('REF-TWICE: second pay refunds 0.1 with reason not_open, status stays PAID', () => {
  assert.equal(parsed('REF-TWICE', 0).returnValue, 'PAID');
  const p = parsed('REF-TWICE', 1);
  assert.equal(p.success, true);
  assert.equal(p.returnValue, 'REFUNDED_NOT_OPEN');
  const ev = eventData(p, 'payment_refunded');
  assert.equal(ev.reason, 'not_open');
  assert.equal(ev.payer, txResult('REF-TWICE', 1).transaction.signer_id);
  assert.equal(BigInt(ev.amount), parseNear('0.1'));
  assert.equal(paid(p, ev.payer), parseNear('0.1'));
  assert.equal(finalStatus('REF-TWICE'), 'PAID');
});

test('REF-OVER: overpaid pay splits 0.092/0.008 and refunds the 0.05 excess to the payer', () => {
  const p = parsed('REF-OVER');
  assert.equal(p.success, true);
  assert.equal(p.returnValue, 'PAID');
  const d = doc('REF-OVER');
  assert.equal(paid(p, d.merchant), parseNear('0.092'));
  assert.equal(paid(p, d.tax_vault), parseNear('0.008'));
  const ev = eventData(p, 'invoice_paid');
  const payer = ev.payer;
  assert.equal(payer, txResult('REF-OVER').transaction.signer_id);
  assert.equal(BigInt(ev.excess_refunded), parseNear('0.05'));
  assert.equal(paid(p, payer), parseNear('0.05'));
  assert.equal(finalStatus('REF-OVER'), 'PAID');
});

test('REF-SWEEPLOW: sweep reverts on UNDERPAID and the 0.05 stays parked', () => {
  const t = calls('REF-SWEEPLOW', 'sweep: tx_status')[0];
  assert.ok(t, 'REF-SWEEPLOW: sweep tx missing');
  const p = parseTxStatus(t.response.result, doc('REF-SWEEPLOW').account_id);
  assert.equal(p.success, false);
  assert.ok(
    JSON.stringify(p.failures).includes(
      'UNDERPAID: available 50000000000000000000000 < amount 100000000000000000000000',
    ),
    `unexpected failure: ${JSON.stringify(p.failures)}`,
  );
  const parked = accountStateFromResponse(calls('REF-SWEEPLOW', 'sweep-after: view_account')[0].response);
  assert.equal(parked.kind, 'UNINITIALIZED');
  if (parked.kind === 'UNINITIALIZED') assert.equal(parked.amount, parseNear('0.05'));
  assert.equal(calls('REF-SWEEPLOW', 'sweep-after: get_invoice').length, 0);
});
