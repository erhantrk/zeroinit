// Pins T14's acceptance: the recorded fixture must contain these exact passing checks.
// Run: node --test test/demo-run.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { replayFixture } from '../src/replay.ts';

const REQUIRED = [
  'before-unknown-account INV-1111-A',
  'pay-tx-success INV-1111-A',
  'split-merchant INV-1111-A 0.92',
  'split-vault INV-1111-A 0.08',
  'transfer-path-uninitialized INV-1111-B 1',
  'sweep-tx-success INV-1111-B',
  'refund-event INV-1111-C REFUNDED_UNDERPAID',
];

test('fixtures/demo-run.json contains the T14 acceptance checks', () => {
  assert.ok(existsSync('fixtures/demo-run.json'), 'fixtures/demo-run.json is missing: T14 would silently replay nothing');
  const checks = replayFixture('fixtures/demo-run.json');
  const emitted = checks.map((c) => `${c.name} ${c.id} ${c.detail}`.trim());
  for (const want of REQUIRED) {
    const found = emitted.some((s) => s === want || s.startsWith(`${want} `));
    assert.ok(found, `missing PASS check "${want}"\nemitted:\n${emitted.join('\n')}`);
  }
  for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
});
