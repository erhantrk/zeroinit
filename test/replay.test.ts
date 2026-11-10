// Run: node --test test/replay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { replayFixture } from '../src/replay.ts';

for (const f of ['fixtures/v2/synthetic-demo.json', 'fixtures/v1/demo-run.json', 'fixtures/v1/refund-cases.json', 'fixtures/v2/demo-run.json', 'fixtures/v2/refund-cases.json', 'fixtures/v2/audit-scenarios.json']) {
  test(`replay ${f}`, { skip: !existsSync(f) && 'not recorded yet' }, () => {
    const checks = replayFixture(f);
    assert.ok(checks.length > 0);
    for (const c of checks) assert.ok(c.ok, `FAIL ${c.name} ${c.id} ${c.detail}`);
  });
}
