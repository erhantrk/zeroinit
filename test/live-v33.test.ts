// The v3.3 live recordings of 2026-11-13 (docs/SPIKES.md "Contract v3.3 live"): every fixture replays clean under the default pin, and the
// cases v3.3 changes are visible in the replay: payments on top of parked funds, the one-step token payment, the private callback and
// two payments at the same moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture } from '../src/replay.ts';
import { checkDoc } from '../src/invoice.ts';
import { V33_CODE_HASH, DEPLOYED_CODE_HASH } from '../src/config.ts';

const F = (n: string) => `fixtures/v33/${n}.json`;
const lines = (n: string) => replayFixture(F(n), V33_CODE_HASH).map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.id}${c.detail ? ' ' + c.detail : ''}`);
const has = (n: string, want: string) => assert.ok(lines(n).some((l) => l.startsWith(`PASS ${want}`)), `${n}: missing PASS ${want}`);

test('v3.3 is the current deployment and every v3.3 recording replays clean', () => {
  assert.equal(DEPLOYED_CODE_HASH, V33_CODE_HASH);
  for (const n of ['demo-run', 'token-demo-run', 'parked', 'tokens', 'race', 'two-payments']) {
    const l = lines(n);
    assert.ok(l.length > 10, `${n}: ${l.length} checks`);
    assert.deepEqual(l.filter((x) => x.startsWith('FAIL')), [], n);
  }
});

test('every invoice document in invoices/v33/ re-derives its address under the v3.3 hash', () => {
  const files = readdirSync('invoices/v33').filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 11, `${files.length} documents`);
  for (const f of files) {
    const d = JSON.parse(readFileSync(join('invoices/v33', f), 'utf8'));
    assert.equal(d.code_hash, V33_CODE_HASH, f);
    const c = checkDoc(d, V33_CODE_HASH);
    assert.ok(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && c.codeHashTrusted && c.formatMatchesDeployment, `${f} does not verify offline`);
  }
});

test('parked funds count toward the price: NEAR and tUSDC, part and whole, and a short top-up', () => {
  has('parked', 'pay-parked-applied PARK-V33-N deposit 1 + parked 0.3');
  has('parked', 'ft-parked-applied PARK-V33-T used 600000 + parked 400000 = amount 1000000');
  has('parked', 'ft-call-accounting PARK-V33-F sent 1000000 = used 0 + refunded 1000000');
  has('parked', 'ft-rejected-underpaid PARK-V33-U');
});

test('the one-step token payment, the second call, and the private callback', () => {
  has('tokens', 'ft-call-accounting TOK-V33-B sent 1000000 = used 1000000 + refunded 0');
  has('tokens', 'ft-rejected-not_open TOK-V33-B');
  has('tokens', 'private-callback-refused TOK-V33-B');
});

test('two payments at the same moment are both returned in full, then one retry pays', () => {
  const l = lines('two-payments').filter((x) => x.includes('ft-rejected-busy TWO-V33-2'));
  assert.equal(l.length, 2, l.join('\n'));
  has('two-payments', 'ft-call-accounting TWO-V33-2 sent 1000000 = used 1000000 + refunded 0');
});
