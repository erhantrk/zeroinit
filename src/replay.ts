// Offline verification over a recorded fixture (INTERFACES.md §6.3). No network, no keys.
import { readFileSync } from 'node:fs';
import { base64 } from '@scure/base';
import { formatNear, toHex } from './bytes.ts';
import { checkDoc, type InvoiceDoc } from './invoice.ts';
import { accountStateFromResponse, decodeViewResult } from './rpc.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';

export interface Check { ok: boolean; name: string; id: string; detail: string }

// INTERFACES.md §5.1: the refund reason the contract must emit for each return value.
const REFUND_REASON: Record<string, string> = {
  REFUNDED_UNDERPAID: 'underpaid',
  REFUNDED_EXPIRED: 'expired',
  REFUNDED_NOT_OPEN: 'not_open',
};

/** Deposit attached to the recorded FunctionCall (the amount the contract must refund on failure). */
function attachedDeposit(result: any): bigint | null {
  for (const a of result?.transaction?.actions ?? []) {
    if (a && typeof a === 'object' && a.FunctionCall) return BigInt(a.FunctionCall.deposit);
  }
  return null;
}

/** Expected get_invoice().status after a tx, given the status observed before it (§5.1). */
function statusAfter(returnValue: unknown, before: string | null): string | null {
  switch (returnValue) {
    case 'PAID': return 'PAID';
    case 'REFUNDED_EXPIRED': return 'EXPIRED';
    case 'REFUNDED_UNDERPAID': return before ?? 'OPEN';
    case 'REFUNDED_NOT_OPEN': return before ?? 'NOT_OPEN';
    default: return before;
  }
}

/** A refund is proven by: right reason, right amount (= attached deposit), right recipient (= payer), and the transfer. */
function checkRefund(p: ParsedTx, result: any, doc: InvoiceDoc): { ok: boolean; detail: string } {
  const ret = String(p.returnValue);
  const reason = REFUND_REASON[ret];
  const ev = p.events.find((e) => e.event === 'payment_refunded');
  const data = ev?.data?.[0] as Record<string, unknown> | undefined;
  const deposit = attachedDeposit(result);
  const signer = result?.transaction?.signer_id;
  const payer = typeof data?.payer === 'string' ? data.payer : null;
  const eventAmount = data?.amount != null ? BigInt(String(data.amount)) : null;
  const backToPayer = p.transfers.filter((t) => t.to === payer).reduce((s, t) => s + t.yocto, 0n);
  const ok = p.success
    && reason !== undefined
    && data?.reason === reason
    && data?.invoice_id === doc.invoice_id
    && data?.account_id === doc.account_id
    && payer !== null && payer === signer
    && deposit !== null && deposit > 0n
    && eventAmount !== null && eventAmount === deposit
    && backToPayer === eventAmount;
  if (ok) return { ok, detail: ret };
  return { ok, detail: `${ret} expected reason=${reason ?? '?'} refund=${deposit ?? '?'} to=${String(signer)};` +
    ` got reason=${String(data?.reason)} amount=${String(data?.amount)} payer=${String(data?.payer)} refunded=${backToPayer}` };
}

export function replayFixture(path: string): Check[] {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  if (f.format !== 'zeroinit-fixture/1') throw new Error('not a zeroinit-fixture/1 file');
  const checks: Check[] = [];
  const add = (ok: boolean, name: string, id: string, detail = '') => checks.push({ ok, name, id, detail });
  for (const doc of f.invoices as InvoiceDoc[]) {
    const id = doc.invoice_id;
    const calls = (f.calls as any[])
      .filter((c) => c.invoice_id === id)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const c = checkDoc(doc);
    add(c.idFromTerms && c.rawFromTerms, 'id-from-terms', id, doc.account_id);
    let expectedStatus: string | null = null;
    let sawBefore = false;
    let sawTransferPath = false;
    for (const call of calls) {
      if (call.label === 'before: view_account') {
        // Only the FIRST "before" snapshot must be NONEXISTENT (a second pay on the same invoice sees it initialized).
        if (sawBefore) continue;
        sawBefore = true;
        add(call.params.account_id === doc.account_id && accountStateFromResponse(call.response).kind === 'NONEXISTENT', 'before-unknown-account', id);
      } else if (call.label === 'before: get_invoice') {
        if (expectedStatus === null) expectedStatus = decodeViewResult(call.response).status;
      } else if (call.label === 'transfer-path: view_account (uninitialized)') {
        // Funds parked by a plain transfer: account exists, uninitialized, balance > 0 (amount may be short; sweep decides).
        if (sawTransferPath) continue;
        sawTransferPath = true;
        const s = accountStateFromResponse(call.response);
        add(s.kind === 'UNINITIALIZED' && s.amount > 0n, 'transfer-path-uninitialized', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
      } else if (call.label === 'init: tx_status') {
        const p = parseTxStatus(call.response.result, doc.account_id);
        if (p.success) expectedStatus = 'OPEN';
      } else if (call.label === 'pay: tx_status' || call.label === 'sweep: tx_status') {
        const prefix = call.label.split(':')[0];
        const result = call.response?.result;
        if (!result) { add(false, `${prefix}-tx-success`, id, 'recorded call has no result'); continue; }
        const p = parseTxStatus(result, doc.account_id);
        if (!p.success && prefix === 'sweep' && JSON.stringify(p.failures).includes('UNDERPAID')) {
          // Expected failure: sweep with too little parked balance reverts the whole receipt; funds stay parked.
          add(true, 'sweep-underpaid-reverted', id, p.txHash);
          continue;
        }
        const rawOk = p.stateInitBase64 === null || toHex(base64.decode(p.stateInitBase64)) === doc.raw_state_init_hex;
        add(p.success && p.receiverId === doc.account_id && rawOk, `${prefix}-tx-success`, id, `${p.txHash} result=${String(p.returnValue)}`);
        if (p.returnValue === 'PAID') {
          const amount = BigInt(doc.amount_yocto); const tax = amount * BigInt(doc.tax_bps) / 10000n;
          const sum = (to: string) => p.transfers.filter((x) => x.to === to).reduce((s, x) => s + x.yocto, 0n);
          const merchantOk = prefix === 'pay' ? sum(doc.merchant) === amount - tax : sum(doc.merchant) >= amount - tax;
          add(merchantOk, `split-merchant`, id, formatNear(sum(doc.merchant)));
          add(sum(doc.tax_vault) === tax, `split-vault`, id, formatNear(sum(doc.tax_vault)));
        } else if (typeof p.returnValue === 'string' && p.returnValue.startsWith('REFUNDED')) {
          const r = checkRefund(p, result, doc);
          add(r.ok, `refund-event`, id, r.detail);
        }
        expectedStatus = statusAfter(p.returnValue, expectedStatus);
      } else if (call.label === 'after: get_invoice' || call.label === 'sweep-after: get_invoice') {
        const v = decodeViewResult(call.response);
        add(v.account_id === doc.account_id && v.invoice_id === id, `after-terms-match`, id);
        const expected = expectedStatus ?? 'UNKNOWN';
        const ok = expected !== 'UNKNOWN' && (expected === 'NOT_OPEN' ? v.status !== 'OPEN' : v.status === expected);
        add(ok, `after-status-${expected}`, id, ok ? '' : `expected ${expected}, got ${v.status}`);
      }
    }
  }
  return checks;
}
