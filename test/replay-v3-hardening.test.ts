// Audit tests-2..tests-5, tests-9: the v3/v3.1 replay must catch tampering of the recordings, not only show all-PASS on honest ones.
// Every mutation below replayed all-PASS before the rules existed (found by the final audit); each must now FAIL the named check.
// Run: node --test test/replay-v3-hardening.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFixture, fixturePin } from '../src/replay.ts';
import { decodeViewResult } from '../src/rpc.ts';
import { DEPLOYED, tempDir } from './helpers.ts';

const N = 'fixtures/v31/demo-run.json';
const T = 'fixtures/v31/token-demo-run.json';
const TOK = 'fixtures/v31/tokens.json';
const LATE = 'fixtures/v31/late.json';
const FIXES = 'fixtures/v3/fixes.json';
const NEAR3 = 'fixtures/v3/near.json';
const TOK3 = 'fixtures/v3/tokens.json';

const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
/** Replays a mutated copy; returns the names of the FAILED checks as `name id`. */
function failing(file: string, mutate: (fx: any) => void): string[] {
  const fx = load(file); mutate(fx);
  const p = join(tempDir(), 'f.json'); writeFileSync(p, JSON.stringify(fx));
  return replayFixture(p, fixturePin(p, DEPLOYED)).filter((c) => !c.ok).map((c) => `${c.name} ${c.id}`);
}
const callOf = (fx: any, id: string, label: string, n = 0) => {
  const c = fx.calls.filter((x: any) => x.invoice_id === id && x.label === label)[n];
  assert.ok(c, `${id} ${label} #${n}`);
  return c;
};
const resultOf = (fx: any, id: string, label: string, n = 0) => callOf(fx, id, label, n).response.result;
const accountOf = (fx: any, id: string): string => fx.invoices.find((d: any) => d.invoice_id === id).account_id;
/** The receipts the invoice account itself sent (payouts and refunds). */
const sentBy = (fx: any, id: string, r: any) => r.receipts.filter((x: any) => x.predecessor_id === accountOf(fx, id));
const transfers = (rs: any[]) => rs.filter((x) => x.receipt.Action.actions.some((a: any) => a.Transfer));
const ftCalls = (rs: any[]) => rs.filter((x) => x.receipt.Action.actions.some((a: any) => a.FunctionCall?.method_name === 'ft_transfer'));
const setTransfer = (rc: any, yocto: bigint) => { rc.receipt.Action.actions[0].Transfer.deposit = yocto.toString(); };
const setFtAmount = (rc: any, amount: bigint) => {
  const fc = rc.receipt.Action.actions[0].FunctionCall;
  const args = JSON.parse(Buffer.from(fc.args, 'base64').toString()); args.amount = amount.toString();
  fc.args = Buffer.from(JSON.stringify(args)).toString('base64');
};
/** Rewrites every zeroinit EVENT_JSON log of the given event name in a tx result. */
function editEvent(r: any, event: string, edit: (d: any) => void): number {
  let n = 0;
  for (const ro of r.receipts_outcome) {
    ro.outcome.logs = ro.outcome.logs.map((l: string) => {
      if (!l.startsWith('EVENT_JSON:')) return l;
      const e = JSON.parse(l.slice('EVENT_JSON:'.length));
      if (e.event !== event) return l;
      edit(e.data[0]); n += 1;
      return 'EVENT_JSON:' + JSON.stringify(e);
    });
  }
  assert.ok(n > 0, `no ${event} event to edit`);
  return n;
}
const dropEvent = (r: any, event: string) => {
  for (const ro of r.receipts_outcome) ro.outcome.logs = ro.outcome.logs.filter((l: string) => !l.includes(`"event":"${event}"`));
};
const setView = (fx: any, id: string, label: string, edit: (v: any) => void, n = 0) => {
  const c = callOf(fx, id, label, n);
  const v = decodeViewResult(c.response); edit(v);
  c.response.result.result = [...Buffer.from(JSON.stringify(v))];
};
const has = (list: string[], name: string, id: string) => assert.ok(list.some((x) => x.startsWith(`${name} ${id}`)), `expected FAIL "${name} ${id}", got: ${list.join(' | ') || '(all PASS)'}`);

test('control: the honest recordings used below replay clean', () => {
  for (const f of [N, T, TOK, LATE, FIXES, NEAR3, TOK3]) assert.deepEqual(failing(f, () => {}), [], f);
});

// ---- tests-2: refunds ----

test('tests-2: a refund must reach the payer: deleting the Transfer, redirecting it, or deleting payment_refunded fails the replay', () => {
  const ID = 'INV-1111-V31-C';   // REFUNDED_UNDERPAID, 0.5 NEAR attached
  has(failing(N, (fx) => {
    const r = resultOf(fx, ID, 'pay: tx_status');
    const refund = transfers(sentBy(fx, ID, r))[0];
    r.receipts = r.receipts.filter((x: any) => x !== refund);
  }), 'refund-event', ID);
  has(failing(N, (fx) => {
    const r = resultOf(fx, ID, 'pay: tx_status');
    transfers(sentBy(fx, ID, r))[0].receiver_id = 'thief.testnet';
  }), 'refund-event', ID);
  has(failing(N, (fx) => dropEvent(resultOf(fx, ID, 'pay: tx_status'), 'payment_refunded')), 'refund-event', ID);
  // a refund of a smaller amount than the deposit is a partial refund
  has(failing(N, (fx) => setTransfer(transfers(sentBy(fx, ID, resultOf(fx, ID, 'pay: tx_status')))[0], 1n)), 'refund-event', ID);
  // the event names another reason than the return value
  has(failing(N, (fx) => editEvent(resultOf(fx, ID, 'pay: tx_status'), 'payment_refunded', (d) => { d.reason = 'expired'; })), 'refund-event', ID);
});

test('tests-2: the same holds for REFUNDED_EXPIRED, REFUNDED_NOT_OPEN and REFUNDED_WRONG_ASSET', () => {
  // v3 NEAR: D expired, E second pay not_open (the 2nd pay tx of E)
  has(failing(NEAR3, (fx) => {
    const r = resultOf(fx, 'INV-V3-D', 'pay: tx_status');
    r.receipts = r.receipts.filter((x: any) => !transfers(sentBy(fx, 'INV-V3-D', r)).includes(x));
  }), 'refund-event', 'INV-V3-D');
  has(failing(NEAR3, (fx) => { transfers(sentBy(fx, 'INV-V3-E', resultOf(fx, 'INV-V3-E', 'pay: tx_status', 1)))[0].receiver_id = 'thief.testnet'; }), 'refund-event', 'INV-V3-E');
  // v3 token invoice paid in NEAR (wrong_asset)
  const ID = 'TOK-V3-H';
  const label = 'wrong-asset: tx_status';
  has(failing(TOK3, (fx) => {
    const r = resultOf(fx, ID, label);
    r.receipts = r.receipts.filter((x: any) => !transfers(sentBy(fx, ID, r)).includes(x));
  }), 'refund-event', ID);
  has(failing(TOK3, (fx) => dropEvent(resultOf(fx, ID, label), 'payment_refunded')), 'refund-event', ID);
});

test('tests-2: an overpay returns exactly its excess to the signer (deposit = price + excess)', () => {
  const ID = 'INV-1111-V31-A';
  const overpay = (fx: any, refund: boolean) => {
    const r = resultOf(fx, ID, 'pay: tx_status');
    r.transaction.actions[1].FunctionCall.deposit = '1500000000000000000000000';
    editEvent(r, 'invoice_paid', (d) => { d.excess_refunded = '500000000000000000000000'; });
    if (refund) {
      const rc = JSON.parse(JSON.stringify(transfers(sentBy(fx, ID, r))[0]));
      rc.receipt_id = 'excess-refund'; rc.receiver_id = r.transaction.signer_id; setTransfer(rc, 500_000_000_000_000_000_000_000n);
      r.receipts.push(rc);
    }
  };
  assert.deepEqual(failing(N, (fx) => overpay(fx, true)), [], 'an honest overpay passes');
  has(failing(N, (fx) => overpay(fx, false)), 'pay-deposit-accounted', ID);
  // the excess goes to somebody else
  has(failing(N, (fx) => {
    overpay(fx, true);
    sentBy(fx, ID, resultOf(fx, ID, 'pay: tx_status')).find((x: any) => x.receipt_id === 'excess-refund').receiver_id = 'thief.testnet';
  }), 'pay-deposit-accounted', ID);
});

// ---- tests-3: the split is of the price, in the token, by the signer ----

test('tests-3: ft_transfer payouts to another token contract fail the replay', () => {
  const ID = 'TOK-1111-V31-A';
  has(failing(T, (fx) => {
    for (const rc of ftCalls(sentBy(fx, ID, resultOf(fx, ID, 'sweep: tx_status')))) rc.receiver_id = 'worthless-token.testnet';
  }), 'payout-token-is-invoice-token', ID);
});

test('tests-3: a settled amount below the price (100 yocto of a 1 NEAR invoice) fails, whether paid or swept', () => {
  const lowEvent = (r: any) => editEvent(r, 'invoice_paid', (d) => { d.amount = '100'; d.merchant_amount = '92'; d.tax_amount = '8'; });
  const lowPayouts = (rs: any[]) => { setTransfer(rs[0], 92n); setTransfer(rs[1], 8n); };
  const A = 'INV-1111-V31-A';
  has(failing(N, (fx) => { const r = resultOf(fx, A, 'pay: tx_status'); lowEvent(r); lowPayouts(transfers(sentBy(fx, A, r))); }), 'settled-covers-price', A);
  const B = 'INV-1111-V31-B';   // the sweep path at (nearly) no price
  has(failing(N, (fx) => {
    const r = resultOf(fx, B, 'sweep: tx_status');
    editEvent(r, 'invoice_paid', (d) => { d.amount = '500000000000000000000000'; d.merchant_amount = '460000000000000000000000'; d.tax_amount = '40000000000000000000000'; });
    const rs = transfers(sentBy(fx, B, r)); setTransfer(rs[0], 460_000_000_000_000_000_000_000n); setTransfer(rs[1], 40_000_000_000_000_000_000_000n);
  }), 'settled-covers-price', B);
  const TK = 'TOK-V31-B';   // a token pay of 100 units for a 1,000,000 unit invoice
  has(failing(TOK, (fx) => {
    const r = resultOf(fx, TK, 'pay: tx_status', 0);
    editEvent(r, 'invoice_paid', (d) => { d.amount = '100'; d.merchant_amount = '92'; d.tax_amount = '8'; });
    const rs = ftCalls(sentBy(fx, TK, r)); setFtAmount(rs[0], 92n); setFtAmount(rs[1], 8n);
  }), 'settled-covers-price', TK);
});

test('tests-3: the payer in invoice_paid and in the after-view is the signer', () => {
  const A = 'INV-1111-V31-A';
  // the event names a thief; the view agrees with it
  has(failing(N, (fx) => {
    editEvent(resultOf(fx, A, 'pay: tx_status'), 'invoice_paid', (d) => { d.payer = 'thief.testnet'; });
    setView(fx, A, 'after: get_invoice', (v) => { v.paid_by = 'thief.testnet'; v.paid_amount = '1'; });
  }), 'paid-by-signer', A);
  // only the view is changed: it no longer agrees with the event
  has(failing(N, (fx) => setView(fx, A, 'after: get_invoice', (v) => { v.paid_by = 'thief.testnet'; })), 'after-view-matches-paid-event', A);
  has(failing(N, (fx) => setView(fx, A, 'after: get_invoice', (v) => { v.paid_amount = '1'; })), 'after-view-matches-paid-event', A);
  has(failing(N, (fx) => setView(fx, A, 'after: get_invoice', (v) => { v.tax_amount = '1'; })), 'after-view-matches-paid-event', A);
  // a transfer-paid invoice has no payer
  const B = 'INV-1111-V31-B';
  has(failing(N, (fx) => editEvent(resultOf(fx, B, 'sweep: tx_status'), 'invoice_paid', (d) => { d.payer = 'thief.testnet'; })), 'paid-by-signer', B);
});

// ---- tests-4: state init and receiver ----

test('tests-4: the recorded UniversalStateInit must be the invoice document\'s, and the tx must be addressed to the invoice', () => {
  const A = 'INV-1111-V31-A';
  has(failing(N, (fx) => {
    resultOf(fx, A, 'pay: tx_status').transaction.actions[0].UniversalStateInit.state_init = Buffer.from('not the invoice state').toString('base64');
  }), 'state-init-matches-terms', A);
  has(failing(N, (fx) => { resultOf(fx, A, 'pay: tx_status').transaction.receiver_id = 'someone-else.testnet'; }), 'tx-receiver-is-invoice', A);
  // the sweep path's creating tx too
  const B = 'INV-1111-V31-B';
  has(failing(N, (fx) => { resultOf(fx, B, 'sweep: tx_status').transaction.actions[0].UniversalStateInit.state_init = Buffer.from('x').toString('base64'); }), 'state-init-matches-terms', B);
  has(failing(N, (fx) => { resultOf(fx, B, 'sweep: tx_status').transaction.receiver_id = 'someone-else.testnet'; }), 'tx-receiver-is-invoice', B);
  // a token ft_transfer_call goes to the token, naming the invoice as receiver
  const K = 'TOK-V31-B';
  has(failing(TOK, (fx) => { resultOf(fx, K, 'pay: tx_status', 0).transaction.receiver_id = 'worthless-token.testnet'; }), 'ft-call-args', K);
  has(failing(TOK, (fx) => {
    const fc = resultOf(fx, K, 'pay: tx_status', 0).transaction.actions[0].FunctionCall;
    const args = JSON.parse(Buffer.from(fc.args, 'base64').toString()); args.receiver_id = 'someone-else.testnet';
    fc.args = Buffer.from(JSON.stringify(args)).toString('base64');
  }), 'ft-call-args', K);
});

// ---- tests-5: extras, reclaim, owed ----

test('tests-5: extra_swept goes to the merchant and the vault, taxed at the invoice rate', () => {
  const ID = 'TAX-V3';
  // both payouts redirected to a thief
  const swept = (fx: any) => resultOf(fx, ID, 'sweep: tx_status');
  const f1 = failing(FIXES, (fx) => { for (const rc of transfers(sentBy(fx, ID, swept(fx)))) rc.receiver_id = 'thief.testnet'; });
  has(f1, 'extra-swept-payouts', ID); has(f1, 'payout-to-known-party', ID);
  // the vault payout is dropped and the whole extra goes untaxed to the merchant (the v2 "fix 3" bug)
  has(failing(FIXES, (fx) => {
    const r = swept(fx);
    const [m, v] = transfers(sentBy(fx, ID, r));
    r.receipts = r.receipts.filter((x: any) => x !== v); setTransfer(m, 50_000_000_000_000_000_000_000n);
    editEvent(r, 'extra_swept', (d) => { d.amount = '50000000000000000000000'; d.tax_amount = '0'; });
  }), 'extra-swept-tax', ID);
  // the event overstates what was paid
  has(failing(FIXES, (fx) => editEvent(swept(fx), 'extra_swept', (d) => { d.amount = '460000000000000000000000'; })), 'extra-swept-payouts', ID);
  has(failing(FIXES, (fx) => editEvent(swept(fx), 'extra_swept', (d) => { d.to = 'thief.testnet'; })), 'extra-swept-payouts', ID);
});

test('tests-5: a reclaim pays exactly what was owed, to paid_by', () => {
  const ID = 'REFUND-V3';
  const reclaim = (fx: any) => resultOf(fx, ID, 'refund-payer: tx_status', 1);
  has(failing(FIXES, (fx) => setTransfer(transfers(sentBy(fx, ID, reclaim(fx)))[0], 1n)), 'reclaim-matches-owed', ID);
  has(failing(FIXES, (fx) => editEvent(reclaim(fx), 'owed_reclaimed', (d) => { d.merchant_part = '1'; })), 'reclaim-matches-owed', ID);
  has(failing(FIXES, (fx) => transfers(sentBy(fx, ID, reclaim(fx)))[0].receiver_id = 'thief.testnet'), 'reclaim-matches-owed', ID);
});

test('tests-5: a retry never pays more than was owed, and the owed ledger afterwards is what is left', () => {
  const ID = 'LATE-V31';
  const owed = 92_000_000_000_000_000_000_000n;
  has(failing(LATE, (fx) => {
    const r = resultOf(fx, ID, 'sweep: tx_status');
    editEvent(r, 'owed_resent', (d) => { d.amount = (owed * 2n).toString(); });
    setTransfer(transfers(sentBy(fx, ID, r))[0], owed * 2n);
  }), 'owed-resent-within-owed', ID);
  // the chain still reports owed money after a full retry
  has(failing(LATE, (fx) => setView(fx, ID, 'sweep-after: get_invoice', (v) => { v.owed_merchant = '1'; })), 'owed-after-resend', ID);
});

test('tests-5: transfer_failed names the payout that really failed, with the role the document gives its recipient', () => {
  const ID = 'LATE-V31';
  // the failed merchant payout is relabelled as the tax share and the owed fields are swapped to match
  const f = failing(LATE, (fx) => {
    editEvent(resultOf(fx, ID, 'pay: tx_status'), 'transfer_failed', (d) => { d.role = 'tax'; });
    setView(fx, ID, 'after: get_invoice', (v) => { v.owed_tax = v.owed_merchant; v.owed_merchant = '0'; });
  });
  has(f, 'transfer-failed-matches-payout', ID);
  // an amount that no failed receipt had
  has(failing(LATE, (fx) => editEvent(resultOf(fx, ID, 'pay: tx_status'), 'transfer_failed', (d) => { d.amount = '1'; })), 'transfer-failed-matches-payout', ID);
  // a recipient that no failed receipt had
  has(failing(LATE, (fx) => editEvent(resultOf(fx, ID, 'pay: tx_status'), 'transfer_failed', (d) => { d.to = 'thief.testnet'; })), 'transfer-failed-matches-payout', ID);
});

test('tests-5: a settlement whose vault payout receipt is missing fails even when no invoice_paid followed', () => {
  const ID = 'LATE-V31';
  has(failing(LATE, (fx) => {
    const r = resultOf(fx, ID, 'pay: tx_status');
    const vault = transfers(sentBy(fx, ID, r)).find((x: any) => x.receiver_id === fx.invoices[0].tax_vault);
    assert.ok(vault);
    r.receipts = r.receipts.filter((x: any) => x !== vault);
  }), 'pay-split-from-terms', ID);
  has(failing(LATE, (fx) => setTransfer(transfers(sentBy(fx, ID, resultOf(fx, ID, 'pay: tx_status')))[1], 1n)), 'pay-split-from-terms', ID);
});

// ---- tests-9: no vacuous pass ----

test('tests-9: an invoice with no recorded transaction fails, and so does a duplicated invoice_paid', () => {
  const A = 'INV-1111-V31-A';
  has(failing(N, (fx) => { fx.calls = fx.calls.filter((c: any) => c.invoice_id !== A); }), 'no-recorded-tx', A);
  has(failing(N, (fx) => {
    const r = resultOf(fx, A, 'pay: tx_status');
    const ro = r.receipts_outcome.find((x: any) => x.outcome.logs.some((l: string) => l.includes('"event":"invoice_paid"')));
    ro.outcome.logs = [...ro.outcome.logs, ...ro.outcome.logs];
  }), 'single-invoice-paid', A);
  // a second invoice_paid in a LATER tx of the same invoice is just as wrong
  has(failing(N, (fx) => {
    const r = resultOf(fx, A, 'pay: tx_status');
    const ro = r.receipts_outcome.find((x: any) => x.outcome.logs.some((l: string) => l.includes('"event":"invoice_paid"')));
    const second = JSON.parse(JSON.stringify(callOf(fx, A, 'pay: tx_status')));
    second.seq = 10_000; fx.calls.push(second);
    assert.ok(ro);
  }), 'single-invoice-paid', A);
});

test('tests-9: the plain transfer that parked the funds is attributed to its invoice and checked', () => {
  const B = 'INV-1111-V31-B';
  const f = load(N);
  const plain = f.calls.find((c: any) => c.invoice_id == null && c.label === 'transfer: tx_status');
  assert.ok(plain && plain.response.result.transaction.receiver_id === accountOf(f, B));
  assert.ok(replayFixture(N, fixturePin(N, DEPLOYED)).some((c) => c.name === 'plain-transfer-tx' && c.id === B && c.ok));
  const f1 = failing(N, (fx) => { fx.calls.find((c: any) => c.invoice_id == null && c.label === 'transfer: tx_status').response.result.transaction.actions[0].Transfer.deposit = '0'; });
  has(f1, 'plain-transfer-tx', B);
  const f2 = failing(N, (fx) => { fx.calls.find((c: any) => c.invoice_id == null && c.label === 'transfer: tx_status').response.result.status = { Failure: { ActionError: { kind: 'X' } } }; });
  has(f2, 'plain-transfer-tx', B);
});
