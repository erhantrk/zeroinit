// The three audit scenarios (contract-1/2/3), re-run LIVE against contract v2 and recorded in fixtures/v2/audit-scenarios.json
// (scripts/record-audit-scenarios.sh). Each test pins what v1 got wrong and v2 must now do, from the recorded tx results.
// Run: node --test test/audit-scenarios.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture } from '../src/replay.ts';
import { parseTxStatus, type ParsedTx } from '../src/outcome.ts';
import { accountStateFromResponse, decodeViewResult } from '../src/rpc.ts';
import { parseNear } from '../src/bytes.ts';
import { V2, tempDir } from './helpers.ts';

const FIXTURE = 'fixtures/v2/audit-scenarios.json';
const load = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const f = load();
const doc = (id: string): any => { const d = f.invoices.find((x: any) => x.invoice_id === id); assert.ok(d, `${id} missing`); return d; };
const calls = (id: string, label: string): any[] => f.calls.filter((c: any) => c.invoice_id === id && c.label === label);
const tx = (id: string, label: 'pay: tx_status' | 'sweep: tx_status', n = 0): { p: ParsedTx; result: any } => {
  const c = calls(id, label)[n]; assert.ok(c, `${id}: ${label} #${n} missing`);
  return { p: parseTxStatus(c.response.result, doc(id).account_id), result: c.response.result };
};
const sum = (p: ParsedTx, to: string): bigint => p.transfers.filter((t) => t.to === to).reduce((s, t) => s + t.yocto, 0n);
const ev = (p: ParsedTx, name: string): any => { const e = p.events.find((x) => x.event === name); assert.ok(e, `missing ${name}`); return e.data[0]; };
const after = (id: string, label: string) => accountStateFromResponse(calls(id, label)[calls(id, label).length - 1].response);
const finalInvoice = (id: string, label: string) => decodeViewResult(calls(id, label)[calls(id, label).length - 1].response);
const deposit = (result: any): bigint => BigInt(result.transaction.actions.find((a: any) => a.FunctionCall).FunctionCall.deposit);

test('the recorded audit scenarios were made on contract v2 and replay clean against the pinned v2 hash', () => {
  for (const d of f.invoices) assert.equal(d.code_hash, V2);
  const checks = replayFixture(FIXTURE, V2);
  assert.ok(checks.length > 0);
  for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
});

test('contract-1: transfer, a zero-deposit pay after expiry, then sweep: the tax vault still gets its share', () => {
  const id = 'AUD1-V2'; const d = doc(id); const tax = parseNear('0.1') * 800n / 10000n;
  const before = accountStateFromResponse(calls(id, 'before: view_account')[0].response);
  assert.equal(before.kind, 'UNINITIALIZED', 'the plain transfer parked the money before expiry');
  assert.equal(before.kind === 'UNINITIALIZED' && before.amount, parseNear('0.1'));
  const zero = tx(id, 'pay: tx_status');
  assert.equal(deposit(zero.result), 0n, 'the pay carries a zero deposit');
  assert.equal(zero.p.returnValue, 'REFUNDED_EXPIRED');
  assert.equal(BigInt(ev(zero.p, 'payment_refunded').amount), 0n, 'nothing to refund');
  assert.equal(finalInvoice(id, 'after: get_invoice').status, 'EXPIRED');
  const parked = after(id, 'after: view_account');
  assert.equal(parked.kind === 'INITIALIZED' && parked.amount, parseNear('0.1'), 'the parked money is still on the invoice (v1 would now give all of it to the merchant)');
  const sweep = tx(id, 'sweep: tx_status');
  assert.equal(sweep.p.returnValue, 'PAID');
  assert.equal(sum(sweep.p, d.tax_vault), tax, 'tax vault gets tax_bps (v1: 0)');
  assert.equal(sum(sweep.p, d.merchant), parseNear('0.1') - tax);
  const paid = ev(sweep.p, 'invoice_paid');
  assert.equal(paid.via, 'transfer');
  assert.equal(paid.late, true);
  assert.equal(BigInt(paid.tax_amount), tax);
  assert.equal(finalInvoice(id, 'sweep-after: get_invoice').status, 'PAID');
  assert.equal(BigInt(finalInvoice(id, 'sweep-after: get_invoice').tax_amount), tax, 'the record shows the tax too (v1: tax_amount 0)');
  const end = after(id, 'sweep-after: view_account');
  assert.equal(end.kind === 'INITIALIZED' && end.amount, 0n);
});

test('contract-3: transfer, then pay: the deposit is refunded in full and nobody is charged twice', () => {
  const id = 'AUD3-V2'; const d = doc(id); const tax = parseNear('0.1') * 800n / 10000n;
  const before = accountStateFromResponse(calls(id, 'before: view_account')[0].response);
  assert.equal(before.kind === 'UNINITIALIZED' && before.amount, parseNear('0.1'), 'the plain transfer is parked');
  const { p, result } = tx(id, 'pay: tx_status');
  assert.equal(p.returnValue, 'PAID');
  assert.equal(deposit(result), parseNear('0.1'));
  const refund = ev(p, 'payment_refunded');
  assert.equal(refund.reason, 'already_funded');
  assert.equal(BigInt(refund.amount), deposit(result));
  assert.equal(refund.payer, result.transaction.signer_id);
  assert.equal(sum(p, result.transaction.signer_id), deposit(result), 'the payer gets the whole deposit back');
  // the invoice is settled exactly once, from the parked funds: one 92/8 split of 0.1 (v1: a second 92/8 split of the deposit)
  assert.equal(sum(p, d.merchant), parseNear('0.1') - tax);
  assert.equal(sum(p, d.tax_vault), tax);
  assert.equal(ev(p, 'invoice_paid').via, 'transfer');
  assert.equal(p.transfers.reduce((s, t) => s + t.yocto, 0n), parseNear('0.2'), 'out = parked 0.1 + refunded deposit 0.1');
  assert.equal(finalInvoice(id, 'after: get_invoice').status, 'PAID');
  const end = after(id, 'after: view_account');
  assert.equal(end.kind === 'INITIALIZED' && end.amount, 0n, 'nothing is left parked to be swept untaxed later');
});

test('contract-2: a failed tax transfer is recorded (transfer_failed), stays owed, and a sweep re-sends it to the vault only', () => {
  const id = 'AUD2-V2'; const d = doc(id); const tax = parseNear('0.1') * 800n / 10000n;
  assert.match(d.tax_vault, /^unregistered\.sm1110-zi-taxvault\.testnet$/, 'a valid id of a nonexistent subaccount that only our own tax-vault account could ever create');
  const pay = tx(id, 'pay: tx_status');
  assert.equal(pay.p.success, true, 'pay() itself succeeded');
  assert.equal(pay.p.returnValue, 'PAID');
  assert.equal(pay.p.downstreamFailures.length, 1);
  assert.match(JSON.stringify(pay.p.downstreamFailures[0]), /AccountDoesNotExist/);
  const failed = ev(pay.p, 'transfer_failed');
  assert.equal(failed.role, 'tax');
  assert.equal(failed.to, d.tax_vault);
  assert.equal(BigInt(failed.amount), tax);
  const bounced = after(id, 'after: view_account');
  assert.equal(bounced.kind === 'INITIALIZED' && bounced.amount, tax, 'the failed tax share bounced back to the invoice account');
  const sweep = tx(id, 'sweep: tx_status');
  assert.equal(sweep.p.returnValue, 'TAX_RESENT');
  const resent = ev(sweep.p, 'tax_resent');
  assert.equal(resent.to, d.tax_vault);
  assert.equal(BigInt(resent.amount), tax);
  assert.deepEqual(sweep.p.transfers.map((t) => t.to), [d.tax_vault], 'only the tax vault is paid by the sweep; the merchant gets nothing extra (v1: the merchant would get the bounced tax)');
  assert.equal(sweep.p.events.some((e) => e.event === 'extra_swept'), false);
});

// Appended to the same fixture later (2026-11-10): the one account that was missing, unregistered.sm1110-zi-taxvault.testnet, was created
// by its parent (scripts/create-v2-unregistered-vault.ts, tx FWBnYH6K5J2YzB7aLUNrzT8DNjRTeoqeJvuPaPFhot6x) and AUD2-V2 was swept again
// (tx HECqnmtEyo7nK7stnh9VoxPHLsmTJyJY3qX3ATUtpife): this time the owed tax really arrived.
test('contract-2 (re-sweep): once the vault account exists, the second sweep delivers the owed tax and nothing fails downstream', () => {
  const id = 'AUD2-V2'; const d = doc(id); const tax = parseNear('0.1') * 800n / 10000n;
  assert.equal(calls(id, 'sweep: tx_status').length, 2, 'the first sweep (vault missing, failed again) and the re-sweep');
  const first = tx(id, 'sweep: tx_status', 0);
  assert.equal(first.p.downstreamFailures.length, 1, 'the first sweep failed again: the account did not exist');
  const second = tx(id, 'sweep: tx_status', 1);
  assert.equal(second.p.success, true);
  assert.equal(second.p.returnValue, 'TAX_RESENT');
  assert.equal(second.p.downstreamFailures.length, 0, 'the transfer to the now existing vault succeeded');
  assert.equal(second.p.events.some((e) => e.event === 'transfer_failed'), false);
  assert.deepEqual(second.p.transfers.map((t) => [t.to, t.yocto]), [[d.tax_vault, tax]], 'exactly the owed tax, to the vault only');
  assert.equal(ev(second.p, 'tax_resent').to, d.tax_vault);
  const last = calls(id, 'sweep-after: view_account')[1];
  const end = accountStateFromResponse(last.response);
  assert.equal(end.kind === 'INITIALIZED' && end.amount, 0n, 'nothing is left on the invoice account: the tax is delivered');
});

function mutated(mutate: (fx: any) => void): string[] {
  const fx = load(); mutate(fx);
  const p = join(tempDir(), 'f.json'); writeFileSync(p, JSON.stringify(fx));
  return replayFixture(p, V2).filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
}
const callOf = (fx: any, id: string, label: string, n = 0) => fx.calls.filter((c: any) => c.invoice_id === id && c.label === label)[n];

test('replay catches a tampered recording of each scenario', () => {
  // contract-3: the refund recipient / amount must be the payer and the attached deposit
  assert.ok(mutated((fx) => { const r = callOf(fx, 'AUD3-V2', 'pay: tx_status').response.result; r.transaction.actions.find((a: any) => a.FunctionCall).FunctionCall.deposit = '1'; }).includes('refund-already-funded AUD3-V2'));
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'AUD3-V2', 'pay: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.map((l: string) => l.replace('already_funded', 'underpaid'));
  }).includes('refund-already-funded AUD3-V2'));
  // contract-2: a downstream failure without its transfer_failed event is not "recorded"
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'AUD2-V2', 'pay: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('transfer_failed'));
  }).includes('transfer-failures-recorded AUD2-V2'));
  // contract-1: the vault share must be exactly tax_bps of the amount
  assert.ok(mutated((fx) => {
    const r = callOf(fx, 'AUD1-V2', 'sweep: tx_status').response.result;
    for (const rc of r.receipts) for (const a of rc.receipt?.Action?.actions ?? []) if (a.Transfer && rc.receiver_id === doc('AUD1-V2').tax_vault) a.Transfer.deposit = '1';
  }).includes('split-vault AUD1-V2'));
  // the parked-funds precondition must be recorded for a pay on an already-funded invoice
  assert.ok(mutated((fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === 'AUD3-V2' && c.label === 'before: view_account')); }).includes('before-unknown-account AUD3-V2'));
});
