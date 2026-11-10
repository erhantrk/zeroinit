// The live v3 recordings (2026-11-10, NEAR testnet, global contract Ut7EQhLD…reWa, tUSDC mock sm1110-tusdc.testnet). v3 is history since v3.1
// (test/live-v31.test.ts): these recordings replay and verify under their own hash.
// Every fixture under fixtures/v3/ must replay clean offline; the tests below pin what each run proved and mutate the recordings
// to check the replay catches tampering. Run: node --test test/live-v3.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture } from '../src/replay.ts';
import { parseTxStatus, type ParsedTx } from '../src/outcome.ts';
import { accountStateFromResponse, decodeViewResult } from '../src/rpc.ts';
import { V3, tempDir } from './helpers.ts';

const FILES = ['near', 'fixes', 'tokens', 'failures', 'demo-run', 'token-demo-run', 'late-resweep'].map((n) => `fixtures/v3/${n}.json`);
const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const checks = (file: string) => replayFixture(file, V3).map((c) => `${c.name} ${c.id}${c.detail ? ' ' + c.detail : ''}`);
const has = (file: string, want: string) => assert.ok(checks(file).some((s) => s === want || s.startsWith(`${want} `)), `missing check "${want}" in ${file}`);
const tx = (file: string, id: string, label: string, n = 0): ParsedTx => {
  const f = load(file);
  const c = f.calls.filter((x: any) => x.invoice_id === id && x.label === `${label}: tx_status`)[n];
  assert.ok(c, `${file}: ${id} ${label} #${n} missing`);
  return parseTxStatus(c.response.result, f.invoices.find((d: any) => d.invoice_id === id).account_id);
};
const ev = (p: ParsedTx, name: string): any => { const e = p.events.find((x) => x.event === name); assert.ok(e, `missing event ${name}`); return e.data[0]; };
const finalStatus = (file: string, id: string): string => {
  const f = load(file);
  const c = f.calls.filter((x: any) => x.invoice_id === id && /(^|-)after: get_invoice$/.test(x.label)).pop();
  assert.ok(c, `${id}: no after get_invoice`);
  return decodeViewResult(c.response).status;
};
function mutated(file: string, mutate: (fx: any) => void): string[] {
  const fx = load(file); mutate(fx);
  const p = join(tempDir(), 'f.json'); writeFileSync(p, JSON.stringify(fx));
  return replayFixture(p, V3).filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
}
const callOf = (fx: any, id: string, label: string, n = 0) => fx.calls.filter((c: any) => c.invoice_id === id && c.label === label)[n];

test('every live v3 fixture exists, was made on the v3 hash and replays clean', () => {
  for (const file of FILES) {
    assert.ok(existsSync(file), `${file} is missing`);
    const f = load(file);
    assert.notEqual(f.synthetic, true, `${file} must be a recording`);
    assert.ok(f.invoices.length > 0);
    for (const d of f.invoices) { assert.equal(d.code_hash, V3); assert.equal(d.format, 'zeroinit-invoice/2'); }
    const out = replayFixture(file, V3);
    assert.ok(out.length > 0, file);
    for (const c of out) assert.ok(c.ok, `${file}: FAIL ${c.name} ${c.id} ${c.detail}`);
  }
});

test('L1 (NEAR parity): pay, plain transfer + sweep, underpay, expired, double pay', () => {
  const F = 'fixtures/v3/near.json';
  for (const w of ['split-merchant INV-V3-A 0.092', 'split-vault INV-V3-A 0.008', 'split-matches-terms INV-V3-A', 'invoice-paid-after-callback INV-V3-A',
    'transfer-path-uninitialized INV-V3-B', 'split-merchant INV-V3-B 0.092', 'after-status-PAID INV-V3-B', 'after-status-OPEN INV-V3-C', 'after-status-EXPIRED INV-V3-D',
    'after-status-PAID INV-V3-E']) has(F, w);
  assert.equal(tx(F, 'INV-V3-A', 'pay').returnValue, 'PAID');
  assert.equal(tx(F, 'INV-V3-B', 'sweep').returnValue, 'PAID');
  assert.equal(ev(tx(F, 'INV-V3-B', 'sweep'), 'invoice_paid').via, 'transfer');
  assert.equal(tx(F, 'INV-V3-C', 'pay').returnValue, 'REFUNDED_UNDERPAID');
  assert.equal(tx(F, 'INV-V3-D', 'pay').returnValue, 'REFUNDED_EXPIRED');
  assert.equal(tx(F, 'INV-V3-E', 'pay', 1).returnValue, 'REFUNDED_NOT_OPEN');
  assert.equal(finalStatus(F, 'INV-V3-D'), 'EXPIRED');
});

test('L2 + L4 (fix 1 and 2): a missing merchant gives PAYOUT_PENDING and SETTLING, never invoice_paid; refund_payer waits for the grace period', () => {
  const F = 'fixtures/v3/fixes.json';
  const late = tx(F, 'LATE-V3', 'pay');
  assert.equal(late.returnValue, 'PAYOUT_PENDING');
  assert.equal(late.events.some((e) => e.event === 'invoice_paid'), false, 'no invoice_paid before every payout was delivered');
  assert.equal(ev(late, 'transfer_failed').role, 'merchant');
  assert.equal(finalStatus(F, 'LATE-V3'), 'SETTLING');
  const early = tx(F, 'REFUND-V3', 'refund-payer', 0);
  assert.equal(early.success, false);
  assert.match(JSON.stringify(early.failures), /NOT_YET: refundable after/);
  const late2 = tx(F, 'REFUND-V3', 'refund-payer', 1);
  assert.equal(late2.returnValue, 'REFUNDED');
  const reclaimed = ev(late2, 'owed_reclaimed');
  assert.equal(reclaimed.payer, 'sm1110-zi3-payer.testnet');
  assert.equal(reclaimed.amount, '92000000000000000000000');
  assert.equal(reclaimed.tax_part, '0');
  assert.equal(finalStatus(F, 'REFUND-V3'), 'REFUNDED');
  has(F, 'refund-payer-to-paid-by REFUND-V3');
});

test('L5 (fix 3): a parked part is taxed too: vault 0.008 + 0.004', () => {
  const F = 'fixtures/v3/fixes.json';
  assert.equal(ev(tx(F, 'TAX-V3', 'pay'), 'invoice_paid').tax_amount, '8000000000000000000000');
  const extra = ev(tx(F, 'TAX-V3', 'sweep'), 'extra_swept');
  assert.equal(extra.amount, '46000000000000000000000');
  assert.equal(extra.tax_amount, '4000000000000000000000');
  assert.equal(tx(F, 'TAX-V3', 'sweep').returnValue, 'EXTRA_SWEPT');
});

test('L6, L7, L8, L15: the tUSDC paths, the plain transfer, the one-step call, the overpay and the double claims', () => {
  const F = 'fixtures/v3/tokens.json';
  for (const w of ['ft-parked-balance TOK-V3-A 1', 'ft-split-merchant TOK-V3-A 0.92', 'ft-split-vault TOK-V3-A 0.08', 'ft-excess-refunded TOK-V3-C',
    'ft-rejected-not_open TOK-V3-B', 'ft-rejected-underpaid TOK-V3-D', 'ft-rejected-expired TOK-V3-F', 'after-status-EXPIRED TOK-V3-F']) has(F, w);
  const sweep = tx(F, 'TOK-V3-A', 'sweep', 0);
  assert.equal(ev(sweep, 'invoice_paid').via, 'transfer');
  assert.equal(ev(sweep, 'invoice_paid').payer, null);
  assert.equal(tx(F, 'TOK-V3-A', 'sweep', 1).returnValue, 'NOTHING_TO_SWEEP');
  // ft_transfer_call answers with the USED amount (1 tUSDC), the token refunds the 0.5 excess itself
  const over = tx(F, 'TOK-V3-C', 'pay');
  assert.equal(over.returnValue, '1000000');
  assert.equal(ev(over, 'invoice_paid').excess_refunded, '500000');
  assert.ok(over.nep141Events.some((e: any) => e.data[0].memo === 'refund' && e.data[0].amount === '500000'));
  assert.equal(tx(F, 'TOK-V3-E', 'sweep').returnValue, 'UNDERPAID');
  assert.equal(finalStatus(F, 'TOK-V3-D'), 'OPEN');
});

test('L14 + L16: a token refund_payer after the grace period, and NEAR attached to a token invoice', () => {
  const F = 'fixtures/v3/tokens.json';
  const pay = tx(F, 'TOK-V3-G', 'pay');
  assert.equal(ev(pay, 'transfer_failed').to, 'sm1110-zi3-unreg2.testnet');
  assert.equal(pay.events.some((e) => e.event === 'invoice_paid'), false);
  const refund = tx(F, 'TOK-V3-G', 'refund-payer');
  assert.equal(refund.returnValue, 'REFUNDED');
  assert.deepEqual(refund.ftTransfers.map((t) => [t.to, t.amount]), [['sm1110-zi3-payer.testnet', 920000n]]);
  assert.equal(finalStatus(F, 'TOK-V3-G'), 'REFUNDED');
  assert.equal(tx(F, 'TOK-V3-H', 'wrong-asset').returnValue, 'REFUNDED_WRONG_ASSET');
  assert.equal(ev(tx(F, 'TOK-V3-H', 'wrong-asset'), 'payment_refunded').reason, 'wrong_asset');
  assert.equal(finalStatus(F, 'TOK-V3-H'), 'OPEN');
});

test('L13, L11, L12, L19: an unregistered merchant is retried to success; a wrong token, a wrong msg and little gas are returned whole', () => {
  const F = 'fixtures/v3/failures.json';
  const pay = tx(F, 'UNREG-V3', 'pay');
  assert.equal(ev(pay, 'transfer_failed').to, 'sm1110-zi3-unreg.testnet');
  assert.equal(pay.events.some((e) => e.event === 'invoice_paid'), false);
  const sweep = tx(F, 'UNREG-V3', 'sweep');
  assert.equal(ev(sweep, 'owed_resent').to, 'sm1110-zi3-unreg.testnet');
  assert.equal(ev(sweep, 'invoice_paid').retried, true);
  assert.deepEqual(sweep.ftTransfers.map((t) => t.to), ['sm1110-zi3-unreg.testnet'], 'only the owed share is re-sent, to its own recipient');
  assert.equal(finalStatus(F, 'UNREG-V3'), 'PAID');
  const cases: Array<[string, string, string]> = [['WRONGTOK-V3', 'wrong-token', 'wrong_token'], ['BADMSG-V3', 'bad-msg-empty', 'bad_msg'], ['BADMSG-V3', 'bad-msg-action', 'bad_msg'], ['LOWGAS-V3', 'low-gas', 'low_gas']];
  for (const [id, label, reason] of cases) {
    const p = tx(F, id, label);
    assert.equal(ev(p, 'payment_rejected').reason, reason, label);
    assert.equal(p.returnValue, '0', `${label}: nothing was used`);
    assert.equal(finalStatus(F, id), 'OPEN', label);
    has(F, `ft-rejected-${reason} ${id}`);
  }
  assert.equal(ev(tx(F, 'WRONGTOK-V3', 'wrong-token'), 'payment_rejected').predecessor, 'fake.sm1110-zi3-taxvault.testnet');
  const lowGas = load(F).calls.find((c: any) => c.invoice_id === 'LOWGAS-V3' && c.label === 'low-gas: tx_status').response.result.transaction.actions[0].FunctionCall;
  assert.equal(BigInt(lowGas.gas), 40_000_000_000_000n);
});

test('L9b: after expiry only a late call sets EXPIRED; then sweep releases the parked part pro rata, taxed (0.46 / 0.04)', () => {
  const F = 'fixtures/v3/tokens.json';
  // an expired invoice that nobody touched is still OPEN: a plain underpay cannot be swept even after the expiry time
  assert.equal(tx(F, 'TOK-V3-I', 'sweep', 0).returnValue, 'UNDERPAID');
  const late = tx(F, 'TOK-V3-I', 'pay');
  assert.equal(ev(late, 'payment_rejected').reason, 'expired');
  const release = tx(F, 'TOK-V3-I', 'sweep', 1);
  assert.equal(release.returnValue, 'EXTRA_SWEPT');
  assert.equal(ev(release, 'extra_swept').amount, '460000');
  assert.equal(ev(release, 'extra_swept').tax_amount, '40000');
  assert.deepEqual(release.ftTransfers.map((t) => [t.to, t.amount]), [['sm1110-zi3-sweeper.testnet', 460000n], ['sm1110-zi3-taxvault.testnet', 40000n]]);
  assert.equal(finalStatus(F, 'TOK-V3-I'), 'EXPIRED');
});

test('S-F2: ft_transfer_call to an invoice id that was never initialized fails on NEAR and the token refunds everything', () => {
  const F = 'fixtures/v3/failures.json';
  const p = tx(F, 'NOINIT-V3', 'uninitialized-call');
  assert.equal(p.success, false);
  assert.match(JSON.stringify(p.failures), /AccountDoesNotExist/);
  assert.equal(p.returnValue, '0', 'the token resolves with 0 used');
  const refund = p.nep141Events.map((e: any) => e.data[0]).find((d: any) => d.memo === 'refund');
  assert.equal(refund?.amount, '1000000');
  assert.equal(refund?.new_owner_id, 'sm1110-zi3-payer.testnet');
  const f = load(F);
  const last = f.calls.filter((c: any) => c.invoice_id === 'NOINIT-V3' && c.label === 'after: view_account').pop();
  assert.equal(accountStateFromResponse(last.response).kind, 'NONEXISTENT');
  has(F, 'uninitialized-call-fails NOINIT-V3');
  has(F, 'ft-call-accounting NOINIT-V3');
});

test('the v3 demos: NEAR (INV-1111-V3-*) and tUSDC plain transfer then sweep (TOK-1111-V3-A)', () => {
  const N = 'fixtures/v3/demo-run.json';
  for (const w of ['before-unknown-account INV-1111-V3-A', 'pay-tx-success INV-1111-V3-A', 'split-merchant INV-1111-V3-A 0.92', 'split-vault INV-1111-V3-A 0.08',
    'transfer-path-uninitialized INV-1111-V3-B 1', 'sweep-tx-result INV-1111-V3-B', 'after-status-OPEN INV-1111-V3-C']) has(N, w);
  assert.equal(tx(N, 'INV-1111-V3-C', 'pay').returnValue, 'REFUNDED_UNDERPAID');
  const T = 'fixtures/v3/token-demo-run.json';
  for (const w of ['ft-parked-balance TOK-1111-V3-A 1', 'after-nonexistent TOK-1111-V3-A', 'sweep-tx-result TOK-1111-V3-A', 'ft-split-merchant TOK-1111-V3-A 0.92', 'ft-split-vault TOK-1111-V3-A 0.08',
    'after-status-PAID TOK-1111-V3-A']) has(T, w);
  const sweep = tx(T, 'TOK-1111-V3-A', 'sweep');
  assert.equal(sweep.returnValue, 'PAID');
  assert.equal(ev(sweep, 'invoice_paid').via, 'transfer');
  assert.ok(sweep.stateInitBase64, 'one transaction: state init + fund + sweep');
});

test('replay catches a tampered live recording', () => {
  // NEAR: the merchant transfer is not the event's amount
  assert.ok(mutated('fixtures/v3/near.json', (fx) => {
    const r = callOf(fx, 'INV-V3-A', 'pay: tx_status').response.result;
    for (const rc of r.receipts) for (const a of rc.receipt?.Action?.actions ?? []) if (a.Transfer && rc.receiver_id === 'sm1110-zi3-sweeper.testnet') a.Transfer.deposit = '1';
  }).includes('split-merchant INV-V3-A'));
  // NEAR: an event whose split is not the invoice's own tax rule
  assert.ok(mutated('fixtures/v3/near.json', (fx) => {
    const r = callOf(fx, 'INV-V3-A', 'pay: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.map((l: string) => l.replace('"tax_amount":"8000000000000000000000"', '"tax_amount":"9000000000000000000000"'));
  }).includes('split-matches-terms INV-V3-A'));
  // token: the vault payout of the sweep is changed
  assert.ok(mutated('fixtures/v3/tokens.json', (fx) => {
    const r = callOf(fx, 'TOK-V3-A', 'sweep: tx_status').response.result;
    for (const rc of r.receipts) for (const a of rc.receipt?.Action?.actions ?? []) {
      if (a.FunctionCall?.method_name === 'ft_transfer') {
        const args = JSON.parse(Buffer.from(a.FunctionCall.args, 'base64').toString());
        if (args.receiver_id === 'sm1110-zi3-taxvault.testnet') { args.amount = '1'; a.FunctionCall.args = Buffer.from(JSON.stringify(args)).toString('base64'); }
      }
    }
  }).includes('ft-split-vault TOK-V3-A'));
  // token: an overpay whose refund event is missing
  assert.ok(mutated('fixtures/v3/tokens.json', (fx) => {
    const r = callOf(fx, 'TOK-V3-C', 'pay: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('"memo":"refund"'));
  }).includes('ft-excess-refunded TOK-V3-C'));
  // a rejected wrong-token payment whose refund went to somebody else
  assert.ok(mutated('fixtures/v3/failures.json', (fx) => {
    const r = callOf(fx, 'WRONGTOK-V3', 'wrong-token: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.map((l: string) => (l.includes('"memo":"refund"') ? l.replace('"new_owner_id":"sm1110-zi3-payer.testnet"', '"new_owner_id":"thief.testnet"') : l));
  }).includes('ft-rejected-wrong_token WRONGTOK-V3'));
  // S-F2: the refund event of the token is the proof that nothing was lost
  assert.ok(mutated('fixtures/v3/failures.json', (fx) => {
    const r = callOf(fx, 'NOINIT-V3', 'uninitialized-call: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('"memo":"refund"'));
  }).includes('ft-call-accounting NOINIT-V3'));
  // an invoice_paid after a failed payout is the v2 bug
  assert.ok(mutated('fixtures/v3/failures.json', (fx) => {
    const r = callOf(fx, 'UNREG-V3', 'pay: tx_status').response.result;
    r.receipts_outcome[0].outcome.logs.push('EVENT_JSON:{"standard":"zeroinit","version":"3.0.0","event":"invoice_paid","data":[{"invoice_id":"UNREG-V3"}]}');
  }).some((x) => x.startsWith('no-invoice-paid-on-failure') || x.startsWith('invoice-paid-after-callback')));
  // the state after a failed payout must say what is owed
  assert.ok(mutated('fixtures/v3/failures.json', (fx) => {
    const c = callOf(fx, 'UNREG-V3', 'after: get_invoice', 1);   // #0 is the one after `zi init`, #1 follows the pay that failed
    const inv = decodeViewResult(c.response); inv.owed_merchant = '0';
    c.response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).includes('owed-after-failure UNREG-V3'));
  // the first snapshot of a demo invoice must be an account that does not exist yet
  assert.ok(mutated('fixtures/v3/demo-run.json', (fx) => {
    const c = callOf(fx, 'INV-1111-V3-A', 'before: view_account');
    c.response = { jsonrpc: '2.0', id: 'zi', result: { amount: '1', storage_usage: 1, global_contract_hash: V3 } };
  }).includes('before-unknown-account INV-1111-V3-A'));
  assert.equal(accountStateFromResponse(callOf(load('fixtures/v3/demo-run.json'), 'INV-1111-V3-A', 'before: view_account').response).kind, 'NONEXISTENT');
});

test('L3 (v3 history): the late merchant exists now, a sweep of LATE-V3 delivers the owed 0.092 NEAR (resumed recording)', () => {
  const F = 'fixtures/v3/late-resweep.json';
  for (const w of ['resumed-initialized LATE-V3', 'sweep-tx-result LATE-V3', 'invoice-paid-after-callback LATE-V3', 'owed-resent LATE-V3 late.sm1110-zi3-merchant.testnet 92000000000000000000000',
    'after-status-PAID LATE-V3']) has(F, w);
  const p = tx(F, 'LATE-V3', 'sweep');
  assert.equal(p.returnValue, 'PAID');
  assert.equal(ev(p, 'owed_resent').to, 'late.sm1110-zi3-merchant.testnet');
  assert.equal(ev(p, 'invoice_paid').retried, true);
  assert.equal(p.transfers.length, 1);
  assert.equal(p.transfers[0].to, 'late.sm1110-zi3-merchant.testnet');
  assert.equal(p.transfers[0].yocto, 92_000_000_000_000_000_000_000n);
  assert.equal(finalStatus(F, 'LATE-V3'), 'PAID');
  // without the `resumed` marker the replay expects a first transaction that carries the state init: it must FAIL
  assert.ok(mutated(F, (fx) => { delete fx.resumed; }).some((x) => x.startsWith('tx-carries-state-init') || x.startsWith('transfer-path-uninitialized')));
  // the account at the start must be initialized on the v3 code
  assert.ok(mutated(F, (fx) => {
    const c = callOf(fx, 'LATE-V3', 'transfer-path: view_account (uninitialized)');
    c.response = { jsonrpc: '2.0', id: 'zi', result: { amount: '1', storage_usage: 1, global_contract_hash: V3.replace(/.$/, 'x') } };
  }).includes('resumed-initialized LATE-V3'));
  // a delivered share without its event is a FAIL
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, 'LATE-V3', 'sweep: tx_status').response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes('owed_resent'));
  }).some((x) => x.startsWith('owed-resent LATE-V3')));
});
