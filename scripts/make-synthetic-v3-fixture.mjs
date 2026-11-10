// SYNTHETIC v3 fixture for the replay-v3 unit tests. It is not a recording: no v3 contract is deployed,
// so no live v3 run exists. The receipt JSON is shaped like EXPERIMENTAL_tx_status. Never present it as real.
// Run: node scripts/make-synthetic-v3-fixture.mjs
import { writeFileSync } from 'node:fs';
import { createInvoiceDoc } from '../src/invoice.ts';
import { V3_CODE_HASH } from '../src/config.ts';

const TOKEN = 'tusdc.example.testnet';
const MERCHANT = 'zi-merchant.testnet';
const VAULT = 'zi-taxvault.testnet';
const PAYER = 'payer.testnet';
const HASH = 'SyntheticTxHash1111111111111111111111111111111';
const now = new Date('2026-11-10T00:00:00.000Z');
const doc = (id, over = {}) => createInvoiceDoc('0u', V3_CODE_HASH, {
  invoice_id: id, merchant: MERCHANT, tax_vault: VAULT, tax_bps: 800, amount: 1_000_000n,
  expires_at_ms: BigInt(now.getTime() + 3_600_000), salt: 1n, layout: 3, grace_ms: 120_000n,
  token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6, ...over,
}, now);

const docs = [
  doc('INV-V3-TOK'),
  doc('INV-V3-FAIL'),
  doc('INV-V3-REJECT'),
  doc('INV-V3-REFUND'),
];
const byId = Object.fromEntries(docs.map((d) => [d.invoice_id, d]));

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64');
const reply = (result) => ({ jsonrpc: '2.0', id: 'zi', result });
const err = (cause, message) => ({ jsonrpc: '2.0', id: 'zi', error: { name: 'HANDLER_ERROR', cause: { name: cause, info: {} }, message } });
const unknown = () => err('UNKNOWN_ACCOUNT', 'unknown');
const view = (o) => reply({ result: [...Buffer.from(JSON.stringify(o))], logs: [], block_height: 1, block_hash: 'x' });
const account = (hash) => reply({ amount: '1000000000000000000000', storage_usage: 500, global_contract_hash: hash });
const action = (a) => ({ Action: { actions: [a] } });
const ftTransfer = (to, amount) => ({ FunctionCall: { method_name: 'ft_transfer', args: b64({ receiver_id: to, amount: String(amount) }), deposit: '1', gas: 15_000_000_000_000 } });
const onSettled = () => ({ FunctionCall: { method_name: 'on_settled', args: b64({ synthetic: true }), deposit: '0', gas: 20_000_000_000_000 } });
const receipt = (id, pred, recv, a) => ({ receipt_id: id, predecessor_id: pred, receiver_id: recv, receipt: action(a) });
const outcome = (id, exec, { ok = true, logs = [] } = {}) => ({ id, outcome: { executor_id: exec, logs, status: ok ? { SuccessValue: '' } : { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: exec } } } } } } });
const event = (name, data) => 'EVENT_JSON:' + JSON.stringify({ standard: 'zeroinit', version: '3.0.0', event: name, data: [data] });
const invoiceView = (d, over = {}) => ({
  v: 3, account_id: d.account_id, invoice_id: d.invoice_id, merchant: d.merchant, tax_vault: d.tax_vault, tax_bps: d.tax_bps,
  amount: d.amount_raw, expires_at_ms: d.expires_at_ms, salt: d.salt, grace_ms: d.payout_grace_ms, token: TOKEN,
  status: 'OPEN', paid_by: null, paid_at_ms: '0', paid_amount: '0', tax_amount: '0',
  owed_merchant: '0', owed_tax: '0', owed_payer: '0', refund_to: null, busy_until_ms: '0', ...over,
});
const stateInitAction = (d) => ({ UniversalStateInit: { state_init: Buffer.from(d.raw_state_init_hex, 'hex').toString('base64'), deposit: '0' } });
const sweepAction = { FunctionCall: { method_name: 'sweep', args: b64('{}'), deposit: '0', gas: 200_000_000_000_000 } };
const fundAction = { FunctionCall: { method_name: 'fund', args: b64('{}'), deposit: '1000', gas: 10_000_000_000_000 } };
const ftCallAction = (d, amount) => ({ FunctionCall: { method_name: 'ft_transfer_call',
  args: b64({ receiver_id: d.account_id, amount: String(amount), msg: JSON.stringify({ action: 'pay', invoice_id: d.invoice_id }) }), deposit: '1', gas: 200_000_000_000_000 } });
const refundAction = { FunctionCall: { method_name: 'refund_payer', args: b64('{}'), deposit: '0', gas: 200_000_000_000_000 } };
const tx = (d, signer, receiver, actions) => ({ hash: HASH, signer_id: signer, receiver_id: receiver, actions });
const result = (d, signer, receiver, actions, returnValue, receipts, receiptsOutcome) => ({
  status: { SuccessValue: b64(JSON.stringify(returnValue)) },
  transaction: tx(d, signer, receiver, actions),
  receipts, receipts_outcome: receiptsOutcome,
});

const calls = [];
let seq = 0;
const call = (invoice_id, label, response) => calls.push({ seq: seq++, invoice_id, label, method: 'query', params: {}, response });

// INV-V3-TOK: a plain ft_transfer parked tokens; anyone sweeps (state init + fund + sweep), payouts succeed.
{
  const d = byId['INV-V3-TOK'];
  call(d.invoice_id, 'before: view_account', unknown());
  call(d.invoice_id, 'ft: ft_balance_of ' + d.account_id, view('1000000'));
  call(d.invoice_id, 'transfer-path: view_account (uninitialized)', unknown());
  const paid = event('invoice_paid', { invoice_id: d.invoice_id, account_id: d.account_id, via: 'transfer', payer: null,
    amount: '1000000', merchant_amount: '920000', tax_amount: '80000', excess_refunded: '0', late: false, retried: false, token: TOKEN });
  call(d.invoice_id, 'sweep: tx_status', reply(result(d, PAYER, d.account_id,
    [stateInitAction(d), fundAction, sweepAction], 'PAID',
    [receipt('r1', d.account_id, TOKEN, ftTransfer(MERCHANT, 920000)),
     receipt('r2', d.account_id, TOKEN, ftTransfer(VAULT, 80000)),
     receipt('r3', d.account_id, d.account_id, onSettled())],
    [outcome('r1', TOKEN), outcome('r2', TOKEN), outcome('r3', d.account_id, { logs: [paid] })])));
  call(d.invoice_id, 'sweep-after: view_account', account(V3_CODE_HASH));
  call(d.invoice_id, 'sweep-after: get_invoice', view(invoiceView(d, { status: 'PAID', paid_by: null, paid_amount: '1000000', tax_amount: '80000' })));
  call(d.invoice_id, 'ft: ft_balance_of ' + d.account_id, view('0'));
}

// INV-V3-FAIL: ft_transfer_call accepted, the merchant is unregistered (payout fails, no invoice_paid, owed recorded),
// then a sweep re-sends it to the merchant and the invoice becomes PAID (retried: true).
{
  const d = byId['INV-V3-FAIL'];
  call(d.invoice_id, 'before: view_account', unknown());
  call(d.invoice_id, 'init: tx_status', reply(result(d, PAYER, d.account_id, [stateInitAction(d), fundAction], null, [], [])));
  const failed = event('transfer_failed', { invoice_id: d.invoice_id, account_id: d.account_id, role: 'merchant', to: MERCHANT, amount: '920000', token: TOKEN });
  call(d.invoice_id, 'pay: tx_status', reply(result(d, PAYER, TOKEN, [ftCallAction(d, 1_000_000)], '0',
    [receipt('p1', d.account_id, TOKEN, ftTransfer(MERCHANT, 920000)),
     receipt('p2', d.account_id, TOKEN, ftTransfer(VAULT, 80000)),
     receipt('p3', d.account_id, d.account_id, onSettled())],
    [outcome('p1', TOKEN, { ok: false }), outcome('p2', TOKEN), outcome('p3', d.account_id, { logs: [failed] })])));
  call(d.invoice_id, 'after: view_account', account(V3_CODE_HASH));
  call(d.invoice_id, 'after: get_invoice', view(invoiceView(d, { status: 'SETTLING', paid_by: PAYER, paid_amount: '1000000', tax_amount: '80000', owed_merchant: '920000' })));
  const paid = event('invoice_paid', { invoice_id: d.invoice_id, account_id: d.account_id, via: 'pay', payer: PAYER,
    amount: '1000000', merchant_amount: '920000', tax_amount: '80000', excess_refunded: '0', late: false, retried: true, token: TOKEN });
  const resent = event('owed_resent', { invoice_id: d.invoice_id, account_id: d.account_id, amount: '920000', to: MERCHANT, token: TOKEN });
  call(d.invoice_id, 'sweep: tx_status', reply(result(d, PAYER, d.account_id, [sweepAction], 'PAID',
    [receipt('q1', d.account_id, TOKEN, ftTransfer(MERCHANT, 920000)),
     receipt('q2', d.account_id, d.account_id, onSettled())],
    [outcome('q1', TOKEN), outcome('q2', d.account_id, { logs: [resent, paid] })])));
  call(d.invoice_id, 'sweep-after: view_account', account(V3_CODE_HASH));
  call(d.invoice_id, 'sweep-after: get_invoice', view(invoiceView(d, { status: 'PAID', paid_by: PAYER, paid_amount: '1000000', tax_amount: '80000' })));
}

// INV-V3-REJECT: an underpaid ft_transfer_call is returned whole (payment_rejected underpaid, status stays OPEN).
{
  const d = byId['INV-V3-REJECT'];
  call(d.invoice_id, 'before: view_account', unknown());
  call(d.invoice_id, 'init: tx_status', reply(result(d, PAYER, d.account_id, [stateInitAction(d), fundAction], null, [], [])));
  const rejected = event('payment_rejected', { invoice_id: d.invoice_id, account_id: d.account_id, sender: PAYER, amount: '500000', reason: 'underpaid', predecessor: TOKEN, token: TOKEN });
  call(d.invoice_id, 'pay: tx_status', reply(result(d, PAYER, TOKEN, [ftCallAction(d, 500_000)], '500000',
    [receipt('x1', d.account_id, d.account_id, onSettled())],
    [outcome('x1', d.account_id, { logs: [rejected] })])));
  call(d.invoice_id, 'after: view_account', unknown());
  call(d.invoice_id, 'after: get_invoice', view(invoiceView(d, { status: 'OPEN' })));
}

// INV-V3-REFUND: a failed merchant share is reclaimed by the payer after the grace period (REFUNDED).
{
  const d = byId['INV-V3-REFUND'];
  call(d.invoice_id, 'before: get_invoice', view(invoiceView(d, { status: 'SETTLING', paid_by: PAYER, paid_at_ms: String(now.getTime()),
    paid_amount: '1000000', tax_amount: '80000', owed_merchant: '920000' })));
  const reclaimed = event('owed_reclaimed', { invoice_id: d.invoice_id, account_id: d.account_id, payer: PAYER,
    amount: '920000', merchant_part: '920000', tax_part: '0', token: TOKEN });
  call(d.invoice_id, 'refund-payer: tx_status', reply(result(d, PAYER, d.account_id, [refundAction], 'REFUNDED',
    [receipt('z1', d.account_id, TOKEN, ftTransfer(PAYER, 920000)),
     receipt('z2', d.account_id, d.account_id, onSettled())],
    [outcome('z1', TOKEN), outcome('z2', d.account_id, { logs: [reclaimed] })])));
  call(d.invoice_id, 'after: view_account', account(V3_CODE_HASH));
  call(d.invoice_id, 'after: get_invoice', view(invoiceView(d, { status: 'REFUNDED', paid_by: PAYER, paid_amount: '1000000', tax_amount: '80000' })));
}

const fixture = { format: 'zeroinit-fixture/1', synthetic: true,
  note: 'SYNTHETIC v3 fixture for the replay-v3 unit tests. Not a recording; v3 is not deployed.',
  recorded_at_iso: now.toISOString(), rpc_url: 'synthetic', invoices: docs, calls };
writeFileSync('fixtures/v3-synthetic-token.json', JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote fixtures/v3-synthetic-token.json (${calls.length} calls, ${docs.length} invoices)`);
