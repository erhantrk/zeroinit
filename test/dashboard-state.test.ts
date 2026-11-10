// Pure dashboard state functions used by web/index.html (T15 click path).
// Run: node --test test/dashboard-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_FIELDS, badgeLabel, formBody, invoiceRows, selection, amountLabel, formatRaw } from '../web/state.js';

test('badgeLabel turns the status API response into the badge text', () => {
  assert.equal(badgeLabel({ state: 'NONEXISTENT' }), 'NONEXISTENT');
  assert.equal(badgeLabel({ state: 'UNINITIALIZED', invoice: null }), 'UNINITIALIZED');
  assert.equal(badgeLabel({ state: 'INITIALIZED', invoice: { status: 'OPEN' } }), 'OPEN');
  assert.equal(badgeLabel({ state: 'INITIALIZED', invoice: { status: 'PAID' } }), 'PAID');
});

test('invoiceRows follows the T15 click path NONEXISTENT/UNINITIALIZED -> PAID', () => {
  const docs = [
    { invoice_id: 'INV-WEB-1', amount_near: '1', account_id: '0ua' },
    { invoice_id: 'INV-WEB-2', amount_near: '1', account_id: '0ub' },
  ];
  const created = invoiceRows(docs, [{ state: 'NONEXISTENT' }, { state: 'UNINITIALIZED', invoice: null }]);
  assert.deepEqual(created.map((r) => r.label), ['NONEXISTENT', 'UNINITIALIZED']);

  const paid = invoiceRows(docs, [
    { state: 'INITIALIZED', invoice: { status: 'PAID' } },
    { state: 'INITIALIZED', invoice: { status: 'PAID' } },
  ]);
  assert.deepEqual(paid.map((r) => r.label), ['PAID', 'PAID']);
  assert.equal(paid[1].doc.account_id, '0ub');
});

test('formBody and selection feed the create/pay paths', () => {
  const values = { id: 'INV-WEB-1', merchant: 'm.testnet', tax_vault: 't.testnet', tax_bps: '800', asset: 'near', amount: '1', expires_in_minutes: '120', payout_grace_ms: '', ignored: 'x' };
  assert.deepEqual(formBody(values), Object.fromEntries(FORM_FIELDS.map((k) => [k, (values as Record<string, string>)[k]])));
  assert.deepEqual(Object.keys(formBody(values)), FORM_FIELDS);

  const rows = invoiceRows([{ invoice_id: 'INV-WEB-1', amount_display: '1', unit: 'NEAR', account_id: '0ua' }], [{ state: 'UNINITIALIZED' }]);
  assert.deepEqual(selection(rows, 'INV-WEB-1'), { id: 'INV-WEB-1', amountDisplay: '1', unit: 'NEAR', amountLabel: '1 NEAR', accountId: '0ua', label: 'UNINITIALIZED' });
  assert.equal(selection(rows, 'MISSING'), null);
});

test('token rows show the display amount and the parked token balance', () => {
  assert.equal(formatRaw('1500000', 6), '1.5');
  assert.equal(formatRaw('1', 6), '0.000001');
  const doc = { invoice_id: 'INV-T', amount_display: '1.5', unit: 'tUSDC', account_id: '0ua' };
  assert.equal(amountLabel(doc, { state: 'NONEXISTENT', token_balance_raw: '1500000', token_decimals: 6, token_symbol: 'tUSDC' }), '1.5 tUSDC (1.5 tUSDC parked)');
  assert.equal(amountLabel(doc, { state: 'INITIALIZED' }), '1.5 tUSDC');
  const rows = invoiceRows([doc], [{ state: 'INITIALIZED', invoice: { status: 'SETTLING' } }]);
  assert.deepEqual(rows.map((r) => r.label), ['SETTLING']);
});

test('badgeLabel: a status not fetched yet is LOADING, an error response is ERROR (never "undefined")', () => {
  assert.equal(badgeLabel(undefined), 'LOADING');
  assert.equal(badgeLabel({ error: 'RPC HTTP 429' }), 'ERROR');
  const rows = invoiceRows([{ invoice_id: 'A' }, { invoice_id: 'B' }], [{ state: 'NONEXISTENT' }]);
  assert.deepEqual(rows.map((r) => r.label), ['NONEXISTENT', 'LOADING']);
});
