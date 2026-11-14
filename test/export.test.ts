// `zi export`: the CSV a bookkeeper opens. Rows are built from what the chain says (ChainView), never from the local file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportRow, toCsv, csvField, taxOf, EXPORT_COLUMNS, type ChainView } from '../src/export.ts';

const near = JSON.parse(readFileSync('invoices/v33/INV-1111-V33-A.json', 'utf8'));
const tok = JSON.parse(readFileSync('invoices/v33/TOK-V33-B.json', 'utf8'));
const before = Number(near.expires_at_ms) - 1000;
const after = Number(near.expires_at_ms) + 1000;
const tokAfter = Number(tok.expires_at_ms) + 1000;
const paidInv = (over: Record<string, unknown> = {}) => ({ status: 'PAID', paid_by: 'zeroinit-payer.testnet', paid_at_ms: '1794559734501',
  paid_amount: '1000000000000000000000000', tax_amount: '80000000000000000000000', owed_merchant: '0', owed_tax: '0', owed_payer: '0', ...over });
const view = (inv: any, parked = 0n): ChainView => ({ kind: 'invoice', inv, parked });

test('export: taxOf is the contract formula, floor(x * bps / 10000)', () => {
  for (const x of [0n, 1n, 9999n, 10_001n, 10n ** 24n, 123_456_789n]) assert.equal(taxOf(x, 800), (x * 800n) / 10_000n);
});

test('export: a paid NEAR invoice gives the split, payer and payment time from the chain', () => {
  const r = exportRow(near, view(paidInv()), 'testnet', after);
  assert.equal(r.status, 'PAID');
  assert.deepEqual([r.currency, r.amount, r.merchant_share, r.tax_share, r.tax_rate_percent, r.paid_amount], ['NEAR', '1', '0.92', '0.08', '8', '1']);
  assert.equal(r.paid_by, 'zeroinit-payer.testnet');
  assert.equal(r.paid_at_utc, '2026-11-13T08:48:54.501Z');
  assert.equal(r.due_utc, near.expires_at_iso);
  assert.equal(r.check_code, 'MVNC');
  assert.equal(r.explorer_link, `https://testnet.nearblocks.io/address/${near.account_id}`);
  assert.equal(r.note, '');
});

test('export: a token invoice uses token decimals and names the token contract', () => {
  const r = exportRow(tok, view(paidInv({ paid_amount: '1000000', tax_amount: '80000' })), 'testnet', after);
  assert.deepEqual([r.currency, r.paid_amount, r.merchant_share, r.tax_share, r.token_contract], ['tUSDC', '1', '0.92', '0.08', 'zeroinit-tusdc.testnet']);
});

test('export: no account yet is OPEN before the due date and EXPIRED after it; parked funds are noted', () => {
  assert.equal(exportRow(near, { kind: 'no-account', parked: 0n }, 'testnet', before).status, 'OPEN');
  const late = exportRow(near, { kind: 'no-account', parked: 0n }, 'testnet', after);
  assert.equal(late.status, 'EXPIRED');
  assert.equal(late.paid_amount, '');
  const parked = exportRow(tok, { kind: 'no-account', parked: 300000n }, 'testnet', before);
  assert.match(parked.note, /^0\.3 tUSDC sent by plain transfer, not settled yet/);
});

test('export: an OPEN invoice past its due date reads EXPIRED; an underpaid plain transfer is noted', () => {
  const r = exportRow(tok, view(paidInv({ status: 'OPEN', paid_by: null, paid_amount: '0', tax_amount: '0' }), 300000n), 'testnet', tokAfter);
  assert.equal(r.status, 'EXPIRED');
  assert.equal(r.paid_amount, '');
  assert.match(r.note, /0\.3 tUSDC received by plain transfer, less than the price; not settled/);
  assert.match(r.note, /past the due date and never paid/);
});

test('export: settled without a payer, owed shares and a refund are spelled out', () => {
  assert.match(exportRow(near, view(paidInv({ paid_by: null })), 'testnet', after).note, /no single payer is recorded/);
  const owed = exportRow(near, view(paidInv({ owed_merchant: '920000000000000000000000' })), 'testnet', after);
  assert.equal(owed.owed_not_yet_sent, '0.92');
  assert.match(owed.note, /zi sweep resends it/);
  const ref = exportRow(near, view(paidInv({ status: 'REFUNDED', paid_amount: '0', tax_amount: '0' })), 'testnet', after);
  assert.equal(ref.status, 'REFUNDED');
  assert.equal(ref.paid_amount, '');
  assert.match(ref.note, /returned/);
});

test('export: a document that fails its own checks is exported as UNVERIFIED, not counted', () => {
  const r = exportRow(near, { kind: 'unverified', reason: 'account_id does not match the terms' }, 'testnet', after);
  assert.equal(r.status, 'UNVERIFIED');
  assert.equal(r.paid_amount, '');
  assert.match(r.note, /^not counted: /);
});

test('export: CSV has the header, CRLF lines, quoting and no spreadsheet formulas', () => {
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('-1'), "'-1");
  const csv = toCsv([exportRow(near, view(paidInv()), 'testnet', after)]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], EXPORT_COLUMNS.join(','));
  assert.equal(lines.length, 3);
  assert.equal(lines[2], '');
  assert.ok(lines[1].startsWith('INV-1111-V33-A,PAID,NEAR,1,0.92,0.08,8,1,'));
});
