// Exact NEP-141 amount conversion (docs/STABLECOIN.md §7.2). No floating point.
// Run: node --test test/units.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, formatUnits } from '../src/ft.ts';

test('parseUnits / formatUnits round trip at 6 decimals', () => {
  for (const [text, raw] of [['1', 1_000_000n], ['1.5', 1_500_000n], ['0.000001', 1n], ['1.50', 1_500_000n], ['123.456789', 123_456_789n]] as const) {
    assert.equal(parseUnits(text, 6), raw, text);
    assert.equal(parseUnits(formatUnits(raw, 6), 6), raw, formatUnits(raw, 6));
  }
  assert.equal(formatUnits(1_500_000n, 6), '1.5');
  assert.equal(formatUnits(0n, 6), '0');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(1_000_000n, 0), '1000000');
});

test('parseUnits rejects non-canonical or too-precise amounts (never rounds)', () => {
  for (const bad of ['1.0000001', '-1', '1e3', '0x10', '', '.5', '1.', ' 1', '1 ', '0', '00', '1,5', '1.2.3']) {
    assert.throws(() => parseUnits(bad, 6), undefined, JSON.stringify(bad));
  }
  assert.throws(() => parseUnits('0.0000001', 6), /more than 6 decimals/);
  assert.throws(() => parseUnits('0.000000', 6), /must be > 0/);
  assert.throws(() => parseUnits(((1n << 128n) - 1n).toString(), 0), /too large/);
});

test('formatUnits never emits a negative or out-of-range amount', () => {
  assert.throws(() => formatUnits(-1n, 6), /out of u128 range/);
  assert.throws(() => formatUnits(1n << 128n, 6), /out of u128 range/);
});
