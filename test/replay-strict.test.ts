// Audit fix protocol-2: replay must FAIL (not silently skip) when a recorded precondition/after call is missing or wrong.
// Run: node --test test/replay-strict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture } from '../src/replay.ts';
import { DEPLOYED, FOREIGN, tempDir } from './helpers.ts';

const load = (name: string) => JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8'));
function replayMutated(name: string, mutate: (f: any) => void, trusted?: string) {
  const f = load(name); mutate(f);
  const p = join(tempDir(), 'fixture.json'); writeFileSync(p, JSON.stringify(f));
  return replayFixture(p, trusted);
}
const callOf = (f: any, id: string, label: string) => f.calls.find((c: any) => c.invoice_id === id && c.label === label);
const failed = (checks: any[]) => checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);

test('unmodified recorded fixtures replay clean, also with the pinned deployed hash', () => {
  for (const n of ['demo-run', 'refund-cases']) {
    assert.deepEqual(failed(replayFixture(`fixtures/${n}.json`, DEPLOYED)), [], n);
    assert.deepEqual(failed(replayFixture(`fixtures/${n}.json`)), [], n);
  }
});

test('pinning a different code hash fails the replay', () => {
  const f = failed(replayFixture('fixtures/demo-run.json', FOREIGN));
  assert.ok(f.includes('code-hash-trusted INV-1111-A'), f.join(', '));
});

test('pay tx without UniversalStateInit (two-tx flow) fails', () => {
  const f = failed(replayMutated('demo-run', (fx) => {
    const r = callOf(fx, 'INV-1111-A', 'pay: tx_status').response.result;
    r.transaction.actions = r.transaction.actions.filter((a: any) => !a.UniversalStateInit);
  }));
  assert.ok(f.includes('pay-carries-state-init INV-1111-A'), f.join(', '));
});

test('missing "before: view_account" (account may have pre-existed) fails', () => {
  const f = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === 'INV-1111-A' && c.label === 'before: view_account')); }));
  assert.ok(f.includes('before-unknown-account INV-1111-A'), f.join(', '));
});

test('missing "transfer-path" snapshot before a sweep fails', () => {
  const f = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === 'INV-1111-B' && c.label.startsWith('transfer-path'))); }));
  assert.ok(f.includes('transfer-path-uninitialized INV-1111-B'), f.join(', '));
});

test('after view_account with another global_contract_hash fails; a missing one fails', () => {
  const wrong = failed(replayMutated('demo-run', (fx) => { callOf(fx, 'INV-1111-A', 'after: view_account').response.result.global_contract_hash = FOREIGN; }));
  assert.ok(wrong.includes('after-code-hash INV-1111-A'), wrong.join(', '));
  const missing = failed(replayMutated('demo-run', (fx) => { fx.calls = fx.calls.filter((c: any) => !(c.invoice_id === 'INV-1111-A' && c.label === 'after: view_account')); }));
  assert.ok(missing.includes('after-code-hash INV-1111-A'), missing.join(', '));
});

test('after a reverted underpaid sweep the funds must still be parked (same balance, UNINITIALIZED)', () => {
  const changed = failed(replayMutated('refund-cases', (fx) => { callOf(fx, 'REF-SWEEPLOW', 'sweep-after: view_account').response.result.amount = '1'; }));
  assert.ok(changed.includes('sweep-underpaid-funds-parked REF-SWEEPLOW'), changed.join(', '));
  const missing = failed(replayMutated('refund-cases', (fx) => { fx.calls = fx.calls.filter((c: any) => c.label !== 'sweep-after: view_account'); }));
  assert.ok(missing.includes('sweep-underpaid-funds-parked REF-SWEEPLOW'), missing.join(', '));
});
