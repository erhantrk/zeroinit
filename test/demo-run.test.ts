// Pins T14's acceptance: the recorded fixture must contain these exact passing checks.
// Run: node --test test/demo-run.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { replayFixture } from '../src/replay.ts';

// v1 history (fixtures/v1/, ids INV-1111-A/B/C) and the v2 re-recording (fixtures/, ids INV-1111-V2-A/B/C).
const RUNS = [
  { name: 'v1', file: 'fixtures/v1/demo-run.json', mid: '1111' },
  { name: 'v2', file: 'fixtures/demo-run.json', mid: '1111-V2' },
];

for (const { name, file, mid } of RUNS) {
  const REQUIRED = [
    `before-unknown-account INV-${mid}-A`,
    `pay-tx-success INV-${mid}-A`,
    `split-merchant INV-${mid}-A 0.92`,
    `split-vault INV-${mid}-A 0.08`,
    `transfer-path-uninitialized INV-${mid}-B 1`,
    `sweep-tx-success INV-${mid}-B`,
    `refund-event INV-${mid}-C REFUNDED_UNDERPAID`,
  ];
  test(`${file} (${name}) contains the T14 acceptance checks`, () => {
    assert.ok(existsSync(file), `${file} is missing: T14 would silently replay nothing`);
    const checks = replayFixture(file);
    const emitted = checks.map((c) => `${c.name} ${c.id} ${c.detail}`.trim());
    for (const want of REQUIRED) {
      const found = emitted.some((s) => s === want || s.startsWith(`${want} `));
      assert.ok(found, `missing PASS check "${want}"\nemitted:\n${emitted.join('\n')}`);
    }
    for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
  });
}
