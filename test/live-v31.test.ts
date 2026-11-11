// The live v3.1 recordings (2026-11-10, NEAR testnet, global contract 2prMzXHZ…DaYX, tUSDC mock sm1110-tusdc.testnet).
// v3.1 = v3 plus the final-review F1 fix: a token sweep racing an in-flight ft_transfer_call plans nothing (CONCURRENT_PAYMENT).
// Every fixture under fixtures/v31/ must replay clean offline; the tests pin what each run proved and mutate the recordings to check the
// replay catches tampering. Run: node --test test/live-v31.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture, fixturePin } from '../src/replay.ts';
import { parseTxStatus, type ParsedTx } from '../src/outcome.ts';
import { decodeViewResult } from '../src/rpc.ts';
import { checkDoc } from '../src/invoice.ts';
import { V31_CODE_HASH } from '../src/config.ts';
import { DEPLOYED, V3, tempDir } from './helpers.ts';

const FILES = ['demo-run', 'token-demo-run', 'tokens', 'race', 'late'].map((n) => `fixtures/v31/${n}.json`);
const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const checks = (file: string) => replayFixture(file, DEPLOYED).map((c) => `${c.name} ${c.id}${c.detail ? ' ' + c.detail : ''}`);
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
  return replayFixture(p, DEPLOYED).filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
}
const callOf = (fx: any, id: string, label: string, n = 0) => fx.calls.filter((c: any) => c.invoice_id === id && c.label === label)[n];

test('v3.1 is the deployment the new recordings were made on: hash, format, and every fixture replays clean', () => {
  assert.equal(V31_CODE_HASH, DEPLOYED);
  for (const file of FILES) {
    assert.ok(existsSync(file), `${file} is missing`);
    const f = load(file);
    assert.notEqual(f.synthetic, true, `${file} must be a recording`);
    assert.ok(f.invoices.length > 0);
    for (const d of f.invoices) { assert.equal(d.code_hash, V31_CODE_HASH); assert.equal(d.format, 'zeroinit-invoice/2'); }
    const out = replayFixture(file, DEPLOYED);
    assert.ok(out.length > 0, file);
    for (const c of out) assert.ok(c.ok, `${file}: FAIL ${c.name} ${c.id} ${c.detail}`);
  }
});

// Not vacuous: each invoice of each v3.1 recording runs EXACTLY this set of rules (a removed call, a skipped rule or a new rule shows up here).
// To refresh after a deliberate rule change: node -e on replayFixture, one sorted name list per invoice (see git log of this file).
test('the replay runs the pinned set of checks for every invoice of every v3.1 recording', () => {
  const pinned = JSON.parse(readFileSync('test/v31-check-names.json', 'utf8'));
  for (const file of FILES) {
    const name = file.replace('fixtures/v31/', '').replace('.json', '');
    const got: Record<string, string[]> = {};
    for (const c of replayFixture(file, DEPLOYED)) (got[c.id] ??= []).push(c.name);
    const norm = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, [...new Set(v)].sort()]));
    assert.deepEqual(norm, pinned[name], `${file}: the set of checks per invoice changed`);
  }
});

test('every invoice document in invoices/v31/ re-derives its address and is v3.1', () => {
  const files = readdirSync('invoices/v31').filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 8, `${files.length} documents`);
  for (const f of files) {
    const d = JSON.parse(readFileSync(join('invoices/v31', f), 'utf8'));
    assert.equal(d.code_hash, V31_CODE_HASH, f);
    const c = checkDoc(d, DEPLOYED);
    assert.ok(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && c.codeHashTrusted && c.formatMatchesDeployment, `${f} does not verify offline`);
  }
});

test('v3 recordings stay replayable and verifiable under their own hash while v3.1 is the trusted one', () => {
  for (const n of ['near', 'fixes', 'tokens', 'failures', 'demo-run', 'token-demo-run', 'late-resweep']) {
    const file = `fixtures/v3/${n}.json`;
    const out = replayFixture(file, fixturePin(file, DEPLOYED));   // trusted = v3.1; `zi replay` pins a fixture of historical documents to their own hash
    assert.ok(out.length > 0);
    for (const c of out) assert.ok(c.ok, `fixtures/v3/${n}.json under the v3.1 pin: FAIL ${c.name} ${c.id} ${c.detail}`);
    assert.ok(out.some((c) => c.name === 'code-hash-trusted' && c.detail === V3), `${n}: documents are checked against the v3 hash`);
  }
});

test('the v3.1 demos: NEAR (INV-1111-V31-*) and tUSDC plain transfer then sweep (TOK-1111-V31-A)', () => {
  const N = 'fixtures/v31/demo-run.json';
  for (const w of ['before-unknown-account INV-1111-V31-A', 'pay-tx-success INV-1111-V31-A', 'split-merchant INV-1111-V31-A 0.92', 'split-vault INV-1111-V31-A 0.08',
    'invoice-paid-after-callback INV-1111-V31-A', 'transfer-path-uninitialized INV-1111-V31-B 1', 'sweep-tx-result INV-1111-V31-B', 'after-status-OPEN INV-1111-V31-C']) has(N, w);
  assert.equal(tx(N, 'INV-1111-V31-A', 'pay').returnValue, 'PAID');
  assert.equal(ev(tx(N, 'INV-1111-V31-B', 'sweep'), 'invoice_paid').via, 'transfer');
  assert.equal(tx(N, 'INV-1111-V31-C', 'pay').returnValue, 'REFUNDED_UNDERPAID');
  const T = 'fixtures/v31/token-demo-run.json';
  for (const w of ['ft-parked-balance TOK-1111-V31-A 1', 'after-nonexistent TOK-1111-V31-A', 'sweep-tx-result TOK-1111-V31-A', 'ft-split-merchant TOK-1111-V31-A 0.92',
    'ft-split-vault TOK-1111-V31-A 0.08', 'after-status-PAID TOK-1111-V31-A']) has(T, w);
  const sweep = tx(T, 'TOK-1111-V31-A', 'sweep');
  assert.equal(sweep.returnValue, 'PAID');
  assert.equal(ev(sweep, 'invoice_paid').via, 'transfer');
  assert.ok(sweep.stateInitBase64, 'one transaction: state init + fund + sweep');
});

test('L7 on v3.1: init, then one ft_transfer_call settles; a second call is returned (not_open)', () => {
  const F = 'fixtures/v31/tokens.json';
  for (const w of ['init-tx-success TOK-V31-B', 'ft-call-args TOK-V31-B', 'ft-split-merchant TOK-V31-B 0.92', 'ft-split-vault TOK-V31-B 0.08', 'ft-excess-refunded TOK-V31-B', 'ft-rejected-not_open TOK-V31-B']) has(F, w);
  const first = tx(F, 'TOK-V31-B', 'pay', 0);
  assert.equal(first.returnValue, '1000000', 'the final value of ft_transfer_call is the amount USED');
  assert.equal(ev(first, 'invoice_paid').via, 'pay');
  assert.equal(ev(first, 'invoice_paid').payer, 'sm1110-zi3-payer.testnet');
  const second = tx(F, 'TOK-V31-B', 'pay', 1);
  assert.equal(second.returnValue, '0');
  assert.equal(ev(second, 'payment_rejected').reason, 'not_open');
  assert.equal(finalStatus(F, 'TOK-V31-B'), 'PAID');
});

test('F1 on v3.1: a sweep racing an in-flight ft_transfer_call returns CONCURRENT_PAYMENT, plans nothing, the call is returned (busy), the invoice stays OPEN and a retry is accepted', () => {
  const F = 'fixtures/v31/race.json';
  for (const w of ['concurrent-payment-plans-nothing RACE-V31-4', 'concurrent-payment-nothing-owed RACE-V31-4', 'ft-rejected-busy RACE-V31-4', 'ft-call-accounting RACE-V31-4', 'ft-split-merchant RACE-V31-4 0.92',
    'invoice-paid-after-callback RACE-V31-4', 'after-status-PAID RACE-V31-4']) has(F, w);
  const sweep = tx(F, 'RACE-V31-4', 'sweep');
  assert.equal(sweep.success, true);
  assert.equal(sweep.returnValue, 'CONCURRENT_PAYMENT');
  assert.deepEqual(sweep.events, [], 'the sweep paid and recorded nothing');
  assert.deepEqual(sweep.transfers, []);
  assert.deepEqual(sweep.ftTransfers, []);
  assert.deepEqual(sweep.downstreamFailures, []);
  const raced = tx(F, 'RACE-V31-4', 'pay', 0);
  assert.equal(raced.returnValue, '0', 'nothing was used');
  assert.equal(ev(raced, 'payment_rejected').reason, 'busy');
  assert.equal(raced.events.some((e) => e.event === 'invoice_paid'), false);
  const refund = raced.nep141Events.map((e: any) => e.data[0]).find((d: any) => d.memo === 'refund');
  assert.equal(refund?.amount, '1000000');
  assert.equal(refund?.new_owner_id, 'sm1110-zi3-payer.testnet');
  const f = load(F);
  // between the race and the retry the invoice is OPEN with nothing owed and nobody recorded as the payer
  const mid = f.calls.filter((c: any) => c.label === 'after: get_invoice').map((c: any) => decodeViewResult(c.response));
  assert.equal(mid.length, 3, 'after init, after the race, after the retry');
  for (const m of [mid[0], mid[1]]) {
    assert.equal(m.status, 'OPEN');
    for (const k of ['owed_merchant', 'owed_tax', 'owed_payer', 'paid_amount', 'busy_until_ms']) assert.equal(m[k], '0', k);
    assert.equal(m.paid_by, null);
  }
  assert.equal(mid[2].status, 'PAID');
  const retry = tx(F, 'RACE-V31-4', 'pay', 1);
  assert.equal(retry.returnValue, '1000000');
  assert.equal(ev(retry, 'invoice_paid').via, 'pay');
  assert.equal(finalStatus(F, 'RACE-V31-4'), 'PAID');
});

test('replay catches a tampered F1 race recording', () => {
  const F = 'fixtures/v31/race.json';
  // the sweep paid something although it said CONCURRENT_PAYMENT
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, 'RACE-V31-4', 'sweep: tx_status').response.result;
    r.receipts_outcome[0].outcome.logs.push('EVENT_JSON:{"standard":"zeroinit","version":"3.0.0","event":"extra_swept","data":[{"invoice_id":"RACE-V31-4"}]}');
  }).includes('concurrent-payment-plans-nothing RACE-V31-4'));
  // a payout receipt from the invoice after the sweep said CONCURRENT_PAYMENT
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, 'RACE-V31-4', 'sweep: tx_status').response.result;
    r.receipts.push({ predecessor_id: r.transaction.receiver_id, receiver_id: 'sm1110-zi3-taxvault.testnet', receipt_id: 'x', receipt: { Action: { actions: [{ Transfer: { deposit: '1' } }] } } });
  }).includes('concurrent-payment-plans-nothing RACE-V31-4'));
  // the state afterwards owes something
  assert.ok(mutated(F, (fx) => {
    const c = callOf(fx, 'RACE-V31-4', 'sweep-after: get_invoice');
    const inv = decodeViewResult(c.response); inv.owed_merchant = '920000';
    c.response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).includes('concurrent-payment-nothing-owed RACE-V31-4'));
  // the state afterwards says somebody paid
  assert.ok(mutated(F, (fx) => {
    const c = callOf(fx, 'RACE-V31-4', 'sweep-after: get_invoice');
    const inv = decodeViewResult(c.response); inv.status = 'SETTLING'; inv.paid_by = 'sm1110-zi3-payer.testnet';
    c.response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).some((x) => x.startsWith('concurrent-payment-nothing-owed') || x.startsWith('after-status-OPEN')));
  // the rejected call's refund went to somebody else
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, 'RACE-V31-4', 'pay: tx_status', 0).response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.map((l: string) => (l.includes('"memo":"refund"') ? l.replace('"new_owner_id":"sm1110-zi3-payer.testnet"', '"new_owner_id":"thief.testnet"') : l));
  }).includes('ft-rejected-busy RACE-V31-4'));
});

test('L2 + L3 on v3.1: a missing merchant gives PAYOUT_PENDING / SETTLING (no invoice_paid); once late.… exists, one sweep delivers the owed 0.092 NEAR', () => {
  const F = 'fixtures/v31/late.json';
  for (const w of ['owed-after-failure LATE-V31', 'transfer-failed-unregistered LATE-V31', 'sweep-tx-result LATE-V31', 'owed-resent LATE-V31 late.sm1110-zi3-merchant.testnet 92000000000000000000000',
    'invoice-paid-after-callback LATE-V31', 'after-status-SETTLING LATE-V31', 'after-status-PAID LATE-V31']) has(F, w);
  const pay = tx(F, 'LATE-V31', 'pay');
  assert.equal(pay.returnValue, 'PAYOUT_PENDING');
  assert.equal(pay.events.some((e) => e.event === 'invoice_paid'), false);
  assert.equal(ev(pay, 'transfer_failed').role, 'merchant');
  const sweep = tx(F, 'LATE-V31', 'sweep');
  assert.equal(sweep.returnValue, 'PAID');
  assert.equal(ev(sweep, 'owed_resent').to, 'late.sm1110-zi3-merchant.testnet');
  assert.equal(ev(sweep, 'invoice_paid').retried, true);
  assert.equal(sweep.transfers.length, 1, 'only the owed share is sent');
  assert.equal(sweep.transfers[0].yocto, 92_000_000_000_000_000_000_000n);
  assert.equal(finalStatus(F, 'LATE-V31'), 'PAID');
  // the retry must go to the merchant of the invoice and nobody else
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, 'LATE-V31', 'sweep: tx_status').response.result;
    for (const rc of r.receipts) for (const a of rc.receipt?.Action?.actions ?? []) if (a.Transfer) rc.receiver_id = 'thief.testnet';
  }).some((x) => x.startsWith('owed-resent LATE-V31')));
});

test('S-F4: the UniversalStateInit deposit is NOT credited to the new account, the system refunds it to the signer', () => {
  const e = JSON.parse(readFileSync('fixtures/v31/sf4.json', 'utf8'));
  assert.equal(e.deposit_near, '0.02');
  assert.equal(e.account_after.kind, 'INITIALIZED');
  assert.equal(e.account_after.amount_near, '0', 'the new account holds nothing');
  const refund = e.receipts.find((r: any) => r.receiver === e.signer && r.predecessor === 'system' && r.actions.includes('Transfer 0.02'));
  assert.ok(refund, 'the deposit came back as a system Transfer to the signer');
  assert.equal(e.signer_delta_near, e.tokens_burnt_near, 'the signer lost only the gas');
});

test('scripts/mark-resumed.mjs adds the invoice document and the `resumed` marker, idempotently', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = tempDir();
  const fx = join(dir, 'f.json');
  writeFileSync(fx, JSON.stringify({ format: 'zeroinit-fixture/1', invoices: [], calls: [] }));
  for (let i = 0; i < 2; i++) execFileSync('node', ['scripts/mark-resumed.mjs', fx, 'invoices/v3/LATE-V3.json']);
  const f = load(fx);
  assert.deepEqual(f.resumed, ['LATE-V3']);
  assert.equal(f.invoices.length, 1);
  assert.equal(f.invoices[0].invoice_id, 'LATE-V3');
  assert.equal(f.invoices[0].code_hash, V3);
});
