// v3 replay rules on a SYNTHETIC v3 fixture (no v3 contract is deployed, so no live recording exists).
// Each mutation below must produce a FAIL: that is the guard the rule exists for.
// Run: node --test test/replay-v3.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture } from '../src/replay.ts';
import { DEPLOYED, V2, tempDir } from './helpers.ts';

const FIXTURE = 'fixtures/v3-synthetic-token.json';
const load = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const failed = (checks: any[]) => checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
const callOf = (fx: any, id: string, label: string, n = 0) => fx.calls.filter((c: any) => c.invoice_id === id && c.label === label)[n];
function mutated(mutate: (fx: any) => void): string[] {
  const fx = load(); mutate(fx);
  const p = join(tempDir(), 'fixture.json'); writeFileSync(p, JSON.stringify(fx));
  return failed(replayFixture(p, DEPLOYED));
}

test('the synthetic v3 fixture is marked synthetic and replays clean under the v3 pin', () => {
  assert.equal(load().synthetic, true);
  const checks = replayFixture(FIXTURE, DEPLOYED);
  assert.ok(checks.length > 0);
  for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
  const names = new Set(checks.map((c) => c.name));
  for (const want of ['invoice-paid-after-callback', 'no-invoice-paid-on-failure', 'ft-parked-balance', 'ft-split-merchant',
    'ft-split-vault', 'ft-rejected-underpaid', 'transfer-failed-unregistered', 'owed-after-failure', 'owed-resent', 'refund-payer-to-paid-by']) {
    assert.ok(names.has(want), `missing check ${want}`);
  }
});

test('v3 fixtures are pinned to their deployment: a foreign trusted hash fails the doc checks', () => {
  const f = failed(replayFixture(FIXTURE, V2));
  assert.ok(f.includes('code-hash-trusted INV-V3-TOK'), f.join(', '));
  assert.ok(f.includes('format-matches-deployment INV-V3-TOK'), f.join(', '));
});

test('invoice_paid must come from on_settled after every payout succeeded', () => {
  // deleting the on_settled receipt removes the only valid invoice_paid
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-TOK', 'sweep: tx_status').response.result;
    r.receipts = r.receipts.filter((x: any) => !x.receipt.Action.actions.some((a: any) => a.FunctionCall?.method_name === 'on_settled'));
    r.receipts_outcome = r.receipts_outcome.filter((x: any) => !x.outcome.logs.some((l: string) => l.includes('invoice_paid')));
  }).includes('invoice-paid-after-callback INV-V3-TOK'));
  // moving the log into a payout receipt is not a callback
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-TOK', 'sweep: tx_status').response.result;
    const cb = r.receipts_outcome.find((x: any) => x.id === 'r3');
    const payout = r.receipts_outcome.find((x: any) => x.id === 'r1');
    payout.outcome.logs = cb.outcome.logs; cb.outcome.logs = [];
  }).includes('invoice-paid-after-callback INV-V3-TOK'));
  // a failed payout with an invoice_paid in the same tx is the v2 bug
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-TOK', 'sweep: tx_status').response.result;
    r.receipts_outcome.find((x: any) => x.id === 'r1').outcome.status = { Failure: { ActionError: { kind: 'X' } } };
  }).includes('no-invoice-paid-on-failure INV-V3-TOK'));
});

test('the token split and the recipients are checked against the invoice_paid event', () => {
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-TOK', 'sweep: tx_status').response.result;
    const a = r.receipts.find((x: any) => x.receipt_id === 'r1').receipt.Action.actions[0].FunctionCall;
    const args = JSON.parse(Buffer.from(a.args, 'base64').toString()); args.amount = '900000';
    a.args = Buffer.from(JSON.stringify(args)).toString('base64');
  }).includes('ft-split-merchant INV-V3-TOK'));
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-TOK', 'sweep: tx_status').response.result;
    const rec = r.receipts.find((x: any) => x.receipt_id === 'r1');
    const a = rec.receipt.Action.actions[0].FunctionCall;
    const args = JSON.parse(Buffer.from(a.args, 'base64').toString()); args.receiver_id = 'someone-else.testnet';
    a.args = Buffer.from(JSON.stringify(args)).toString('base64');
  }).includes('ft-split-merchant INV-V3-TOK'));
});

test('a rejected token payment must return the whole amount with a reason', () => {
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-REJECT', 'pay: tx_status').response.result;
    r.status.SuccessValue = Buffer.from(JSON.stringify('0')).toString('base64');
  }).includes('ft-rejected-underpaid INV-V3-REJECT'));
});

test('a failed payout must be recorded, stay owed, and be re-sent to its own recipient', () => {
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-FAIL', 'pay: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('transfer_failed'));
  }).includes('transfer-failed-unregistered INV-V3-FAIL'));
  assert.ok(mutated((fx) => {
    const v = callOf(fx, 'INV-V3-FAIL', 'after: get_invoice').response.result.result;
    const inv = JSON.parse(Buffer.from(v).toString());
    inv.owed_merchant = '0';
    callOf(fx, 'INV-V3-FAIL', 'after: get_invoice').response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).includes('owed-after-failure INV-V3-FAIL'));
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-FAIL', 'sweep: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('owed_resent'));
  }).includes('owed-resent INV-V3-FAIL'));
});

test('refund_payer pays paid_by and only paid_by; the after status must match', () => {
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'INV-V3-REFUND', 'refund-payer: tx_status').response.result;
    const a = r.receipts.find((x: any) => x.receipt_id === 'z1').receipt.Action.actions[0].FunctionCall;
    const args = JSON.parse(Buffer.from(a.args, 'base64').toString()); args.receiver_id = 'someone-else.testnet';
    a.args = Buffer.from(JSON.stringify(args)).toString('base64');
  }).includes('refund-payer-to-paid-by INV-V3-REFUND'));
  assert.ok(mutated((fx) => {
    const v = callOf(fx, 'INV-V3-TOK', 'sweep-after: get_invoice').response.result.result;
    const inv = JSON.parse(Buffer.from(v).toString());
    inv.status = 'OPEN';
    callOf(fx, 'INV-V3-TOK', 'sweep-after: get_invoice').response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).includes('after-status-PAID INV-V3-TOK'));
});
