// The live v3.2r recordings (2026-11-11, NEAR testnet; HISTORY since v3.2r, which is the same source built reproducibly, see test/live-v32r.test.ts; global contract 6YtW5oJ8…vMCNHJ, tUSDC mock sm1110-tusdc.testnet).
// v3.2r = v3.1 plus the audit fixes: the sweep/ft_transfer_call race is closed on EVERY rejection path (here: bad_msg), contract-2/3/4.
// Every fixture under fixtures/v32r/ must replay clean offline; the tests pin what each run proved and mutate the recordings to check the
// replay catches tampering. Run: node --test test/live-v32.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture, fixturePin } from '../src/replay.ts';
import { parseTxStatus, type ParsedTx } from '../src/outcome.ts';
import { decodeViewResult } from '../src/rpc.ts';
import { checkDoc } from '../src/invoice.ts';
import { V32R_CODE_HASH, V32_CODE_HASH, V31_CODE_HASH } from '../src/config.ts';
import { DEPLOYED, tempDir } from './helpers.ts';

const FILES = ['demo-run', 'token-demo-run', 'tokens', 'race'].map((n) => `fixtures/v32r/${n}.json`);
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
function mutated(file: string, mutate: (fx: any) => void): string[] {
  const fx = load(file); mutate(fx);
  const p = join(tempDir(), 'f.json'); writeFileSync(p, JSON.stringify(fx));
  return replayFixture(p, DEPLOYED).filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
}
const callOf = (fx: any, id: string, label: string, n = 0) => fx.calls.filter((c: any) => c.invoice_id === id && c.label === label)[n];

test('v3.2r is the deployment the new recordings were made on: hash, format, and every fixture replays clean under the default pin', () => {
  assert.equal(V32R_CODE_HASH, DEPLOYED);
  assert.equal(fixturePin(FILES[0], DEPLOYED), V32R_CODE_HASH, 'a v3.2r recording is not history: it replays under the trusted hash');
  assert.notEqual(V32R_CODE_HASH, V31_CODE_HASH);
  assert.notEqual(V32R_CODE_HASH, V32_CODE_HASH);
  for (const file of FILES) {
    assert.ok(existsSync(file), `${file} is missing`);
    const f = load(file);
    assert.notEqual(f.synthetic, true, `${file} must be a recording`);
    assert.ok(f.invoices.length > 0);
    for (const d of f.invoices) { assert.equal(d.code_hash, V32R_CODE_HASH); assert.equal(d.format, 'zeroinit-invoice/2'); }
    const out = replayFixture(file, DEPLOYED);
    assert.ok(out.length > 0, file);
    for (const c of out) assert.ok(c.ok, `${file}: FAIL ${c.name} ${c.id} ${c.detail}`);
    assert.ok(out.some((c) => c.name === 'code-hash-trusted' && c.detail === V32R_CODE_HASH), `${file}: documents are checked against the v3.2r hash`);
  }
});

// Not vacuous: each invoice of each v3.2r recording runs EXACTLY this set of rules (a removed call, a skipped rule or a new rule shows up here).
test('the replay runs the pinned set of checks for every invoice of every v3.2r recording', () => {
  const pinned = JSON.parse(readFileSync('test/v32r-check-names.json', 'utf8'));
  for (const file of FILES) {
    const name = file.replace('fixtures/v32r/', '').replace('.json', '');
    const got: Record<string, string[]> = {};
    for (const c of replayFixture(file, DEPLOYED)) (got[c.id] ??= []).push(c.name);
    const norm = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, [...new Set(v)].sort()]));
    assert.deepEqual(norm, pinned[name], `${file}: the set of checks per invoice changed`);
  }
});

test('every invoice document in invoices/v32r/ re-derives its address and is v3.2', () => {
  const files = readdirSync('invoices/v32r').filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 6, `${files.length} documents`);
  for (const f of files) {
    const d = JSON.parse(readFileSync(join('invoices/v32r', f), 'utf8'));
    assert.equal(d.code_hash, V32R_CODE_HASH, f);
    assert.match(d.invoice_id, /V32/, f);
    const c = checkDoc(d, DEPLOYED);
    assert.ok(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && c.codeHashTrusted && c.formatMatchesDeployment, `${f} does not verify offline`);
  }
});

test('the v3.2r demos: NEAR pay, plain transfer then sweep, underpay (INV-1111-V32R-*) and tUSDC plain transfer then sweep (TOK-1111-V32R-A)', () => {
  const N = 'fixtures/v32r/demo-run.json';
  for (const w of ['before-unknown-account INV-1111-V32R-A', 'pay-tx-success INV-1111-V32R-A', 'split-merchant INV-1111-V32R-A 0.92', 'split-vault INV-1111-V32R-A 0.08',
    'invoice-paid-after-callback INV-1111-V32R-A', 'transfer-path-uninitialized INV-1111-V32R-B 1', 'sweep-tx-result INV-1111-V32R-B', 'after-status-OPEN INV-1111-V32R-C']) has(N, w);
  assert.equal(tx(N, 'INV-1111-V32R-A', 'pay').returnValue, 'PAID');
  assert.equal(ev(tx(N, 'INV-1111-V32R-B', 'sweep'), 'invoice_paid').via, 'transfer');
  assert.equal(tx(N, 'INV-1111-V32R-C', 'pay').returnValue, 'REFUNDED_UNDERPAID');
  const T = 'fixtures/v32r/token-demo-run.json';
  for (const w of ['ft-parked-balance TOK-1111-V32R-A 1', 'after-nonexistent TOK-1111-V32R-A', 'sweep-tx-result TOK-1111-V32R-A', 'ft-split-merchant TOK-1111-V32R-A 0.92',
    'ft-split-vault TOK-1111-V32R-A 0.08', 'after-status-PAID TOK-1111-V32R-A']) has(T, w);
  const sweep = tx(T, 'TOK-1111-V32R-A', 'sweep');
  assert.equal(sweep.returnValue, 'PAID');
  assert.equal(ev(sweep, 'invoice_paid').via, 'transfer');
  assert.ok(sweep.stateInitBase64, 'one transaction: state init + fund + sweep');
});

test('L7 on v3.2r: init, then one ft_transfer_call settles; a second call is returned (not_open)', () => {
  const F = 'fixtures/v32r/tokens.json';
  for (const w of ['init-tx-success TOK-V32R-B', 'ft-call-args TOK-V32R-B', 'ft-split-merchant TOK-V32R-B 0.92', 'ft-split-vault TOK-V32R-B 0.08', 'ft-excess-refunded TOK-V32R-B', 'ft-rejected-not_open TOK-V32R-B']) has(F, w);
  const first = tx(F, 'TOK-V32R-B', 'pay', 0);
  assert.equal(first.returnValue, '1000000', 'the final value of ft_transfer_call is the amount USED');
  assert.equal(ev(first, 'invoice_paid').via, 'pay');
  assert.equal(ev(first, 'invoice_paid').payer, 'sm1110-zi3-payer.testnet');
  const second = tx(F, 'TOK-V32R-B', 'pay', 1);
  assert.equal(second.returnValue, '0');
  assert.equal(ev(second, 'payment_rejected').reason, 'not_open');
});

test('contract-1 on v3.2r: a sweep racing an in-flight ft_transfer_call with a WRONG msg returns CONCURRENT_PAYMENT, plans nothing, the call is returned (bad_msg), the invoice stays OPEN and a retry is accepted', () => {
  const F = 'fixtures/v32r/race.json';
  const ID = 'RACE-V32R-1';
  for (const w of [`concurrent-payment-plans-nothing ${ID}`, `concurrent-payment-nothing-owed ${ID}`, `ft-rejected-bad_msg ${ID}`, `ft-call-accounting ${ID}`, `ft-split-merchant ${ID} 0.92`,
    `invoice-paid-after-callback ${ID}`, `after-status-PAID ${ID}`]) has(F, w);
  const sweep = tx(F, ID, 'sweep');
  assert.equal(sweep.success, true);
  assert.equal(sweep.returnValue, 'CONCURRENT_PAYMENT');
  assert.deepEqual(sweep.events, [], 'the sweep paid and recorded nothing');
  assert.deepEqual(sweep.transfers, []);
  assert.deepEqual(sweep.ftTransfers, []);
  assert.deepEqual(sweep.downstreamFailures, []);
  const raced = tx(F, ID, 'pay', 0);
  assert.equal(raced.returnValue, '0', 'nothing was used');
  assert.equal(ev(raced, 'payment_rejected').reason, 'bad_msg', 'the rejection path v3.1 did not protect');
  assert.equal(raced.events.some((e) => e.event === 'invoice_paid'), false);
  const sent = JSON.parse(Buffer.from(callOf(load(F), ID, 'pay: tx_status', 0).response.result.transaction.actions[0].FunctionCall.args, 'base64').toString('utf8'));
  assert.equal(sent.msg, '{"action":"x"}', 'the msg is the wrong one');
  const refund = raced.nep141Events.map((e: any) => e.data[0]).find((d: any) => d.memo === 'refund');
  assert.equal(refund?.amount, '1000000');
  assert.equal(refund?.new_owner_id, 'sm1110-zi3-payer.testnet');
  const f = load(F);
  const mid = f.calls.filter((c: any) => c.label === 'after: get_invoice').map((c: any) => decodeViewResult(c.response));
  assert.equal(mid.length, 3, 'after init, after the race, after the retry');
  for (const m of [mid[0], mid[1]]) {
    assert.equal(m.status, 'OPEN');
    for (const k of ['owed_merchant', 'owed_tax', 'owed_payer', 'paid_amount', 'busy_until_ms']) assert.equal(m[k], '0', k);
    assert.equal(m.paid_by, null);
  }
  assert.equal(mid[2].status, 'PAID');
  const retry = tx(F, ID, 'pay', 1);
  assert.equal(retry.returnValue, '1000000');
  assert.equal(ev(retry, 'invoice_paid').via, 'pay');
});

test('replay catches a tampered v3.2r bad_msg race recording', () => {
  const F = 'fixtures/v32r/race.json';
  const ID = 'RACE-V32R-1';
  // the sweep paid something although it said CONCURRENT_PAYMENT
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, ID, 'sweep: tx_status').response.result;
    r.receipts_outcome[0].outcome.logs.push(`EVENT_JSON:{"standard":"zeroinit","version":"3.0.0","event":"extra_swept","data":[{"invoice_id":"${ID}"}]}`);
  }).includes(`concurrent-payment-plans-nothing ${ID}`));
  // the state afterwards owes something
  assert.ok(mutated(F, (fx) => {
    const c = callOf(fx, ID, 'sweep-after: get_invoice');
    const inv = decodeViewResult(c.response); inv.owed_merchant = '920000';
    c.response.result.result = [...Buffer.from(JSON.stringify(inv))];
  }).includes(`concurrent-payment-nothing-owed ${ID}`));
  // the rejected call's refund went to somebody else
  assert.ok(mutated(F, (fx) => {
    const r = callOf(fx, ID, 'pay: tx_status', 0).response.result;
    for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.map((l: string) => (l.includes('"memo":"refund"') ? l.replace('"new_owner_id":"sm1110-zi3-payer.testnet"', '"new_owner_id":"thief.testnet"') : l));
  }).length > 0);
  // the recorded code hash is not the v3.2r hash
  assert.ok(mutated(F, (fx) => { fx.invoices[0].code_hash = V31_CODE_HASH; }).length > 0);
});
