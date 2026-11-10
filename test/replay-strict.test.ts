// Audit fix protocol-2: replay must FAIL (not silently skip) when a recorded precondition/after call is missing or wrong.
// Runs against the v1 history fixtures (fixtures/v1/) and the v2 re-recording (fixtures/).
// Run: node --test test/replay-strict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture, fixturePin } from '../src/replay.ts';
import { DEPLOYED, V1, V2, FOREIGN, tempDir } from './helpers.ts';

const RUNS = [
  { v: 'v1', dir: 'fixtures/v1', hash: V1, mid: '1111', sfx: '' },
  { v: 'v2', dir: 'fixtures/v2', hash: V2, mid: '1111-V2', sfx: '-V2' },
];
const failed = (checks: any[]) => checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
const callOf = (f: any, id: string, label: string) => f.calls.find((c: any) => c.invoice_id === id && c.label === label);

for (const { v, dir, hash, mid, sfx } of RUNS) {
  const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));
  function replayMutated(name: string, mutate: (f: any) => void, trusted?: string) {
    const f = load(name); mutate(f);
    const p = join(tempDir(), 'fixture.json'); writeFileSync(p, JSON.stringify(f));
    return replayFixture(p, trusted);
  }
  const A = `INV-${mid}-A`; const B = `INV-${mid}-B`; const SWEEPLOW = `REF-SWEEPLOW${sfx}`;

  test(`${v}: unmodified recorded fixtures replay clean, also with their pinned deployed hash`, () => {
    for (const n of ['demo-run', 'refund-cases']) {
      assert.deepEqual(failed(replayFixture(`${dir}/${n}.json`, hash)), [], n);
      assert.deepEqual(failed(replayFixture(`${dir}/${n}.json`)), [], n);
    }
  });

  test(`${v}: pinning a different code hash fails the replay`, () => {
    const f = failed(replayFixture(`${dir}/demo-run.json`, FOREIGN));
    assert.ok(f.includes(`code-hash-trusted ${A}`), f.join(', '));
    // the other deployment is not this fixture's hash either
    const other = failed(replayFixture(`${dir}/demo-run.json`, v === 'v1' ? DEPLOYED : V1));
    assert.ok(other.includes(`code-hash-trusted ${A}`), other.join(', '));
  });

  test(`${v}: pay tx without UniversalStateInit (two-tx flow) fails`, () => {
    const f = failed(replayMutated('demo-run', (fx) => {
      const r = callOf(fx, A, 'pay: tx_status').response.result;
      r.transaction.actions = r.transaction.actions.filter((a: any) => !a.UniversalStateInit);
    }));
    assert.ok(f.includes(`pay-carries-state-init ${A}`), f.join(', '));
  });

  test(`${v}: missing "before: view_account" (account may have pre-existed) fails`, () => {
    const f = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === A && c.label === 'before: view_account')); }));
    assert.ok(f.includes(`before-unknown-account ${A}`), f.join(', '));
  });

  test(`${v}: missing "transfer-path" snapshot before a sweep fails`, () => {
    const f = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === B && c.label.startsWith('transfer-path'))); }));
    assert.ok(f.includes(`transfer-path-uninitialized ${B}`), f.join(', '));
  });

  test(`${v}: after view_account with another global_contract_hash fails; a missing one fails`, () => {
    const wrong = failed(replayMutated('demo-run', (fx) => { callOf(fx, A, 'after: view_account').response.result.global_contract_hash = FOREIGN; }));
    assert.ok(wrong.includes(`after-code-hash ${A}`), wrong.join(', '));
    const missing = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === A && c.label === 'after: view_account')); }));
    assert.ok(missing.includes(`after-code-hash ${A}`), missing.join(', '));
  });

  test(`${v}: after a reverted underpaid sweep the funds must still be parked (same balance, UNINITIALIZED)`, () => {
    const changed = failed(replayMutated('refund-cases', (fx) => { callOf(fx, SWEEPLOW, 'sweep-after: view_account').response.result.amount = '1'; }));
    assert.ok(changed.includes(`sweep-underpaid-funds-parked ${SWEEPLOW}`), changed.join(', '));
    const missing = failed(replayMutated('refund-cases', (fx) => { fx.calls = fx.calls.filter((c: any) => c.label !== 'sweep-after: view_account'); }));
    assert.ok(missing.includes(`sweep-underpaid-funds-parked ${SWEEPLOW}`), missing.join(', '));
  });

  test(`${v}: fixturePin: a historical fixture keeps its own hash whatever the trusted pin is`, () => {
    assert.equal(fixturePin(`${dir}/demo-run.json`, DEPLOYED), hash);
    assert.equal(fixturePin(`${dir}/demo-run.json`, FOREIGN), hash);
  });
}
