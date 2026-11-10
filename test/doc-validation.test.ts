// Audit fixes protocol-1/3/4/5, cli-server-secrets-4: u64 range checks, account-id validation, pinned code hash, display fields.
// Run: node --test test/doc-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { u64 } from '../src/bytes.ts';
import { invoiceStateBytes } from '../src/stateinit.ts';
import { checkDoc, assertDocTrusted, rawFromTerms, createInvoiceDoc } from '../src/invoice.ts';
import { trustedCodeHash, DEPLOYED_CODE_HASH } from '../src/config.ts';
import { DEPLOYED, FOREIGN, terms, makeDoc } from './helpers.ts';

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

test('checkDoc FAILs a doc built on a foreign contract when the trusted hash is pinned', () => {
  const doc = makeDoc(FOREIGN);
  assert.equal(checkDoc(doc).idFromTerms, true, 'self-consistent against its own hash (the old, unsafe check)');
  const c = checkDoc(doc, DEPLOYED);
  assert.equal(c.codeHashTrusted, false);
  assert.equal(c.idFromTerms, false, 'the id is re-derived from the pinned hash');
  assert.throws(() => assertDocTrusted(doc, DEPLOYED), /not the trusted hash/);
  assert.doesNotThrow(() => assertDocTrusted(makeDoc(DEPLOYED), DEPLOYED));
});

test('trustedCodeHash: ZI_CODE_HASH when set, else the frozen deployed hash', () => {
  assert.equal(DEPLOYED_CODE_HASH, DEPLOYED);
  assert.equal(trustedCodeHash({ codeHashB58: null }), DEPLOYED);
  assert.equal(trustedCodeHash({ codeHashB58: FOREIGN }), FOREIGN);
});

test('rawFromTerms ignores a tampered raw_state_init_hex in the file', () => {
  const doc = makeDoc();
  const honest = rawFromTerms(doc, DEPLOYED);
  const tampered = { ...doc, raw_state_init_hex: 'ab'.repeat(honest.length) };
  assert.deepEqual(rawFromTerms(tampered, DEPLOYED), honest);
  assert.throws(() => assertDocTrusted(tampered, DEPLOYED), /raw_state_init_hex/);
});

test('checkDoc FAILs when display fields disagree with the terms (amount_near, expires_at_iso, state_hex)', () => {
  const doc = makeDoc();
  assert.equal(checkDoc(doc, DEPLOYED).fieldsConsistent, true);
  assert.equal(checkDoc({ ...doc, amount_near: '0.1' }, DEPLOYED).fieldsConsistent, false);
  assert.equal(checkDoc({ ...doc, expires_at_iso: '1999-01-01T00:00:00.000Z' }, DEPLOYED).fieldsConsistent, false);
  assert.equal(checkDoc({ ...doc, state_hex: '00' }, DEPLOYED).fieldsConsistent, false);
  assert.throws(() => assertDocTrusted({ ...doc, amount_near: '0.1' }, DEPLOYED), /display fields/);
});

test('checkDoc never throws on a malformed doc and rejects hand-made merchant ids and non-canonical numbers', () => {
  const doc = makeDoc();
  for (const bad of [{ merchant: 'Shop..X' }, { salt: '0x10' }, { amount_yocto: ' 1' }, { expires_at_ms: '-1000' }, { salt: String((1n << 64n) + 7n) }, { scheme: 'zz' }]) {
    const c = checkDoc({ ...doc, ...bad } as any, DEPLOYED);
    assert.equal(c.idFromTerms && c.rawFromTerms && c.fieldsConsistent, false, JSON.stringify(bad));
  }
});

test('createInvoiceDoc still produces a doc that checks out', () => {
  const doc = createInvoiceDoc('0u', DEPLOYED, terms());
  const c = checkDoc(doc, DEPLOYED);
  assert.ok(c.codeHashTrusted && c.idFromTerms && c.rawFromTerms && c.fieldsConsistent);
});
