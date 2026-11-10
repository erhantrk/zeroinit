// Document validation for /1 (v1/v2) and /2 (v3) docs (docs/STABLECOIN.md §9-10).
// Run: node --test test/doc-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { u64 } from '../src/bytes.ts';
import { invoiceStateBytes } from '../src/stateinit.ts';
import { checkDoc, assertDocTrusted, rawFromTerms, createInvoiceDoc, isV3Doc, docAmountRaw, docToken, docGraceMs } from '../src/invoice.ts';
import { DEPLOYED_CODE_HASH } from '../src/config.ts';
import { DEPLOYED, V1, V2, FOREIGN, terms, makeDoc, makeTokenDoc } from './helpers.ts';

const TOKEN_ENTRY = { symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.example.testnet' };

test('u64 throws instead of wrapping modulo 2^64', () => {
  assert.equal(u64(0n).length, 8);
  assert.equal(u64((1n << 64n) - 1n).length, 8);
  assert.throws(() => u64(-1n), /u64 out of range/);
  assert.throws(() => u64(1n << 64n), /u64 out of range/);
});

test('invoiceStateBytes rejects salt / expires_at_ms outside u64 (no two terms map to one id)', () => {
  assert.throws(() => invoiceStateBytes(terms({ salt: (1n << 64n) + 42n })), /salt out of u64 range/);
  assert.throws(() => invoiceStateBytes(terms({ salt: -1n })), /salt out of u64 range/);
  assert.throws(() => invoiceStateBytes(terms({ expires_at_ms: -1000n })), /expires_at_ms out of u64 range/);
  assert.throws(() => invoiceStateBytes(terms({ expires_at_ms: (1n << 64n) - 1000n + (1n << 64n) })), /expires_at_ms out of u64 range/);
});

test('invoiceStateBytes rejects invalid merchant / tax_vault account ids, so no id is derivable for them', () => {
  assert.throws(() => invoiceStateBytes(terms({ merchant: 'Shop.testnet' })), /merchant .* not a valid NEAR account id/);
  assert.throws(() => invoiceStateBytes(terms({ tax_vault: 'a..b' })), /tax_vault .* not a valid NEAR account id/);
});

test('createInvoiceDoc writes /2 (v3 layout) for the v3 deployment and /1 for v2/v1', () => {
  const v3 = makeDoc();
  assert.equal(v3.format, 'zeroinit-invoice/2');
  assert.equal(isV3Doc(v3), true);
  assert.equal(docAmountRaw(v3), terms().amount);
  assert.equal(docToken(v3), null);
  assert.equal(docGraceMs(v3), 604_800_000n);
  assert.equal(makeDoc(V2).format, 'zeroinit-invoice/1');
  assert.equal(makeDoc(V1).format, 'zeroinit-invoice/1');
  // a /1 document on the v3 hash would initialize an account with bytes the v3 contract cannot read: refused at creation
  assert.throws(() => createInvoiceDoc('0u', DEPLOYED, terms({ layout: 1 })), /v3 deployment needs the v3 state layout/);
});

test('a v3 /2 document checks out; every tampered field fails', () => {
  const doc = makeDoc();
  const base = checkDoc(doc, DEPLOYED);
  assert.ok(base.codeHashTrusted && base.formatMatchesDeployment && base.idFromTerms && base.rawFromTerms && base.fieldsConsistent);
  const bad = [
    { amount_display: '0.5' }, { amount_raw: '0' }, { amount_raw: ' 1' }, { payout_grace_ms: '60000' }, { payout_grace_ms: '59999' },
    { payout_grace_ms: '31536000001' }, { state_hex: '00' }, { expires_at_iso: '1999-01-01T00:00:00.000Z' },
    { asset: { kind: 'ft', contract: 'tusdc.example.testnet', symbol: 'tUSDC', decimals: 6 } }, { format: 'zeroinit-invoice/1' } as any,
  ];
  for (const over of bad) {
    const c = checkDoc({ ...doc, ...over } as any, DEPLOYED);
    assert.equal(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && c.formatMatchesDeployment, false, JSON.stringify(over));
  }
});

test('token documents: fields, allow-list and the deployment format', () => {
  const doc = makeTokenDoc();
  assert.equal(isV3Doc(doc), true);
  assert.equal(docToken(doc), TOKEN_ENTRY.accountId);
  assert.ok(checkDoc(doc, DEPLOYED, [TOKEN_ENTRY]).fieldsConsistent);
  assert.ok(checkDoc(doc, DEPLOYED).fieldsConsistent, 'without an allow-list the doc is checked structurally');
  assert.equal(checkDoc(doc, DEPLOYED, []).fieldsConsistent, false, 'an empty allow-list refuses every token');
  assert.equal(checkDoc(doc, DEPLOYED, [{ ...TOKEN_ENTRY, decimals: 8 }]).fieldsConsistent, false);
  assert.equal(checkDoc(doc, DEPLOYED, [{ ...TOKEN_ENTRY, symbol: 'USDC' }]).fieldsConsistent, false);
  assert.equal(checkDoc(doc, DEPLOYED, [{ ...TOKEN_ENTRY, accountId: 'other.testnet' }]).fieldsConsistent, false);
  if (isV3Doc(doc) && doc.asset.kind === 'ft') {
    for (const asset of [{ ...doc.asset, symbol: '' }, { ...doc.asset, decimals: 39 }, { ...doc.asset, contract: 'Bad..Token' }, { ...doc.asset, kind: 'IBMP' }]) {
      const c = checkDoc({ ...doc, asset } as any, DEPLOYED);
      assert.equal(c.fieldsConsistent && c.rawFromTerms && c.idFromTerms, false, JSON.stringify(asset));
    }
  }
});

test('0s tokens are refused (untested) and grace is checked on /2 docs', () => {
  assert.throws(() => createInvoiceDoc('0s', DEPLOYED, terms({ token: TOKEN_ENTRY.accountId, token_symbol: 'tUSDC', token_decimals: 6 })), /only issued for 0u/);
  assert.equal(checkDoc(makeDoc(DEPLOYED, { grace_ms: 60_000n }), DEPLOYED).fieldsConsistent, true, 'the lower bound is inclusive');
  assert.equal(checkDoc(makeDoc(DEPLOYED, { grace_ms: 59_999n }), DEPLOYED).fieldsConsistent, false);
  assert.equal(checkDoc(makeDoc(DEPLOYED, { grace_ms: 31_536_000_000n }), DEPLOYED).fieldsConsistent, true, 'the upper bound is inclusive');
  assert.equal(checkDoc(makeDoc(DEPLOYED, { grace_ms: 31_536_000_001n }), DEPLOYED).fieldsConsistent, false);
});

test('checkDoc FAILs a /1 doc on the v3 hash, and a v3 doc on a v2 hash', () => {
  const v2 = makeDoc(V2);
  assert.equal(checkDoc(v2, V2).formatMatchesDeployment, true);
  assert.equal(checkDoc(v2, V2).fieldsConsistent, true);
  const wrong = checkDoc(v2, DEPLOYED);
  assert.equal(wrong.formatMatchesDeployment, false);
  assert.equal(wrong.fieldsConsistent, false);
  assert.throws(() => assertDocTrusted(v2, DEPLOYED), /not the trusted hash|format/);
  const v3 = makeDoc();
  assert.throws(() => assertDocTrusted(v3, V2), /not the trusted hash|format/);
  assert.doesNotThrow(() => assertDocTrusted(v3, DEPLOYED));
});

test('checkDoc FAILs a doc built on a foreign contract when the trusted hash is pinned', () => {
  const doc = makeDoc(FOREIGN, { layout: 3 });
  assert.equal(checkDoc(doc).idFromTerms, true, 'self-consistent against its own hash');
  const c = checkDoc(doc, DEPLOYED);
  assert.equal(c.codeHashTrusted, false);
  assert.equal(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent, false);
  assert.throws(() => assertDocTrusted(doc, DEPLOYED), /not the trusted hash/);
});

test('rawFromTerms ignores a tampered raw_state_init_hex in the file', () => {
  const doc = makeDoc();
  const honest = rawFromTerms(doc, DEPLOYED);
  const tampered = { ...doc, raw_state_init_hex: 'ab'.repeat(honest.length) };
  assert.deepEqual(rawFromTerms(tampered, DEPLOYED), honest);
  assert.throws(() => assertDocTrusted(tampered, DEPLOYED), /raw_state_init_hex/);
});

test('checkDoc never throws on a malformed doc and rejects non-canonical numbers and bad display fields', () => {
  const doc = makeDoc();
  for (const bad of [{ merchant: 'Shop..X' }, { salt: '0x10' }, { amount_raw: ' 1' }, { expires_at_ms: '-1000' }, { salt: String((1n << 64n) + 7n) }, { scheme: 'zz' }]) {
    const c = checkDoc({ ...doc, ...bad } as any, DEPLOYED);
    assert.equal(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent, false, JSON.stringify(bad));
  }
  assert.equal(checkDoc({ ...doc, amount_display: '0.1' } as any, DEPLOYED).fieldsConsistent, false);
  assert.equal(checkDoc({ ...doc, state_hex: '00' } as any, DEPLOYED).fieldsConsistent, false);
});

test('a v1 document is not accepted for signing against the current pin, but checks out against its own deployment', () => {
  const doc = makeDoc(V1);
  assert.throws(() => assertDocTrusted(doc, DEPLOYED), /not the trusted hash .*v1 deployment: history, verify and replay only/);
  assert.doesNotThrow(() => assertDocTrusted(doc, V1));
  assert.notEqual(makeDoc(V1).account_id, makeDoc(V2).account_id, 'the same terms derive a different address per deployment');
  assert.equal(DEPLOYED_CODE_HASH, DEPLOYED);
});
