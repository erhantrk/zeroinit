// Pure dashboard state functions used by web/index.html (T15 click path).
// Run: node --test test/dashboard-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_FIELDS, badgeLabel, formBody, invoiceRows, selection } from '../web/state.js';

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
  const values = { id: 'INV-WEB-1', merchant: 'm.testnet', tax_vault: 't.testnet', tax_bps: '800', amount_near: '1', expires_in_minutes: '120', ignored: 'x' };
  assert.deepEqual(formBody(values), Object.fromEntries(FORM_FIELDS.map((k) => [k, (values as Record<string, string>)[k]])));
  assert.deepEqual(Object.keys(formBody(values)), FORM_FIELDS);

  const rows = invoiceRows([{ invoice_id: 'INV-WEB-1', amount_near: '1', account_id: '0ua' }], [{ state: 'UNINITIALIZED' }]);
  assert.deepEqual(selection(rows, 'INV-WEB-1'), { id: 'INV-WEB-1', amountNear: '1', accountId: '0ua', label: 'UNINITIALIZED' });
  assert.equal(selection(rows, 'MISSING'), null);
});
