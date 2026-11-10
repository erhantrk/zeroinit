// Issuance rejects malformed merchant / tax_vault account ids (they would make STATE undeserializable).
// Run: node --test test/issuance-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceDoc, isValidNearAccountId } from '../src/invoice.ts';
import { parseNear } from '../src/bytes.ts';

const CODE_HASH = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';
const terms = (merchant: string, tax_vault: string) => ({ invoice_id: 'INV-V-1', merchant, tax_vault, tax_bps: 800,
  amount: parseNear('1'), expires_at_ms: 1794700800000n, salt: 1n });

test('valid NEAR account ids are accepted', () => {
  for (const id of ['zi-merchant.testnet', 'sm1110-zi-taxvault.testnet', 'a.b.c', 'ab', 'a_b-c.near', '0'.repeat(64)]) assert.ok(isValidNearAccountId(id), id);
  assert.equal(createInvoiceDoc('0u', CODE_HASH, terms('zi-merchant.testnet', 'zi-taxvault.testnet')).account_id.startsWith('0u'), true);
});

test('invalid NEAR account ids are rejected', () => {
  for (const id of ['Not A Valid!!', 'ALSO..BAD', 'a', '', 'x'.repeat(65), 'a..b', '.a', 'a.', '-a', 'a-', 'a--b', 'a b', 'UPPER.testnet']) assert.equal(isValidNearAccountId(id), false, id);
  assert.throws(() => createInvoiceDoc('0u', CODE_HASH, terms('Not A Valid!!', 'zi-taxvault.testnet')), /merchant .* not a valid NEAR account id/);
  assert.throws(() => createInvoiceDoc('0u', CODE_HASH, terms('zi-merchant.testnet', 'ALSO..BAD')), /tax_vault .* not a valid NEAR account id/);
});
