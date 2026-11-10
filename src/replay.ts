// Offline verification over a recorded fixture (INTERFACES.md §6.3). No network, no keys.
import { readFileSync } from 'node:fs';
import { base64 } from '@scure/base';
import { formatNear, toHex } from './bytes.ts';
import { checkDoc, rawFromTerms, type InvoiceDoc } from './invoice.ts';
import { pinForVerification } from './config.ts';
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
    && deposit !== null && (deposit > 0n || ret === 'REFUNDED_EXPIRED')   // a zero-deposit pay after expiry is the contract-1 scenario: refund 0, status EXPIRED
    && eventAmount !== null && eventAmount === deposit
    && backToPayer === eventAmount;
  if (ok) return { ok, detail: ret };
  return { ok, detail: `${ret} expected reason=${reason ?? '?'} refund=${deposit ?? '?'} to=${String(signer)};` +
    ` got reason=${String(data?.reason)} amount=${String(data?.amount)} payer=${String(data?.payer)} refunded=${backToPayer}` };
}

/**
 * contract-3 (v2): a pay() whose invoice already holds the parked amount returns PAID, settles the PARKED funds and refunds the whole attached
 * deposit. Proven by: reason already_funded, amount = attached deposit, recipient = payer = signer, and that exact amount transferred back.
 */
function checkAlreadyFunded(p: ParsedTx, result: any, doc: InvoiceDoc): { ok: boolean; detail: string } {
  const ev = p.events.find((e) => e.event === 'payment_refunded');
  const data = ev?.data?.[0] as Record<string, unknown> | undefined;
  const deposit = attachedDeposit(result);
  const signer = result?.transaction?.signer_id;
  const backToPayer = p.transfers.filter((t) => t.to === signer).reduce((s, t) => s + t.yocto, 0n);
  const paidEv = p.events.find((e) => e.event === 'invoice_paid')?.data?.[0] as Record<string, unknown> | undefined;
  const ok = p.success && data?.reason === 'already_funded' && data?.invoice_id === doc.invoice_id && data?.account_id === doc.account_id
    && data?.payer === signer && deposit !== null && deposit > 0n && String(data?.amount) === deposit.toString() && backToPayer === deposit
    && paidEv?.via === 'transfer' && paidEv?.payer === null;
  return { ok, detail: ok ? `refunded ${formatNear(deposit!)} to ${String(signer)}` : `already_funded expected refund=${deposit ?? '?'} to=${String(signer)}; got reason=${String(data?.reason)} amount=${String(data?.amount)} refunded=${backToPayer} via=${String(paidEv?.via)}` };
}

/**
 * The hash a fixture is replayed against: the trusted hash, unless every invoice in it was issued under the same
 * historical known deployment (v1), which is accepted for replaying the recorded history. A fixture with a foreign
 * hash, or a mix, is pinned to `trusted` and FAILs.
 */
export function fixturePin(path: string, trusted: string): string {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  const pins = new Set((f.invoices as InvoiceDoc[] ?? []).map((d) => pinForVerification(trusted, d.code_hash)));
  return pins.size === 1 ? [...pins][0] : trusted;
}

/**
 * Replays a recorded fixture. Every expected call must be present: a missing recorded call is a FAIL, not a skipped check.
 * `trusted` (the pinned deployed code hash) additionally pins every doc's code_hash and the on-chain global_contract_hash.
 */
export function replayFixture(path: string, trusted?: string): Check[] {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  if (f.format !== 'zeroinit-fixture/1') throw new Error('not a zeroinit-fixture/1 file');
  const checks: Check[] = [];
  const add = (ok: boolean, name: string, id: string, detail = '') => checks.push({ ok, name, id, detail });
  for (const doc of f.invoices as InvoiceDoc[]) {
    const id = doc.invoice_id;
    const calls = (f.calls as any[])
      .filter((c) => c.invoice_id === id)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const c = checkDoc(doc, trusted);
    if (trusted !== undefined) add(c.codeHashTrusted, 'code-hash-trusted', id, doc.code_hash);
    add(c.idFromTerms && c.rawFromTerms, 'id-from-terms', id, doc.account_id);
    add(c.fieldsConsistent, 'doc-fields-from-terms', id);
    const codeHash = trusted ?? doc.code_hash;
    let expectedStatus: string | null = null;
    let sawBefore = false;
    let sawTransferPath = false;
    let parked: bigint | null = null;        // balance parked by the plain transfer, before the first sweep
    let awaitParked: bigint | null = null;   // a reverted sweep must leave exactly this balance, still UNINITIALIZED
    let firstTx = true;
    let pending: { view: boolean; get: boolean } | null = null;   // "after" calls owed by the last successful tx
    const flushPending = () => {
      if (pending?.view) add(false, 'after-code-hash', id, 'no recorded after view_account');
      if (pending?.get) add(false, 'after-terms-match', id, 'no recorded after get_invoice');
      pending = null;
    };
    for (const call of calls) {
      if (call.label === 'before: view_account') {
        // Only the FIRST "before" snapshot must be NONEXISTENT (a second pay on the same invoice sees it initialized).
        if (sawBefore) continue;
        sawBefore = true;
        const b = accountStateFromResponse(call.response);
        if (b.kind === 'UNINITIALIZED') {
          // A pay on an invoice whose funds are already parked by a plain transfer (audit contract-1 / contract-3 scenarios).
          parked = b.amount;
          add(call.params.account_id === doc.account_id && b.amount > 0n, 'before-parked-account', id, formatNear(b.amount));
        } else add(call.params.account_id === doc.account_id && b.kind === 'NONEXISTENT', 'before-unknown-account', id);
      } else if (call.label === 'before: get_invoice') {
        if (expectedStatus === null) expectedStatus = decodeViewResult(call.response).status;
      } else if (call.label === 'transfer-path: view_account (uninitialized)') {
        // Funds parked by a plain transfer: account exists, uninitialized, balance > 0 (amount may be short; sweep decides).
        // `zi sweep` records this snapshot on every call; once a tx has materialized the account it is only informational.
        if (sawTransferPath || !firstTx) continue;
        sawTransferPath = true;
        const s = accountStateFromResponse(call.response);
        if (s.kind === 'UNINITIALIZED') parked = s.amount;
        add(s.kind === 'UNINITIALIZED' && s.amount > 0n, 'transfer-path-uninitialized', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
      } else if (call.label === 'init: tx_status') {
        flushPending();
        const p = parseTxStatus(call.response.result, doc.account_id);
        if (p.success) expectedStatus = 'OPEN';
      } else if (call.label === 'pay: tx_status' || call.label === 'sweep: tx_status') {
        flushPending();
        const prefix = call.label.split(':')[0];
        const result = call.response?.result;
        if (!result) { add(false, `${prefix}-tx-success`, id, 'recorded call has no result'); continue; }
        const p = parseTxStatus(result, doc.account_id);
        // The FIRST tx on an invoice must be the one that creates the account (a state init in that very tx), starting from the
        // recorded pre-state: NONEXISTENT for pay, UNINITIALIZED (plain transfer parked funds) for sweep.
        const isFirst = firstTx;
        firstTx = false;
        if (isFirst) {
          if (prefix === 'pay' && !sawBefore) add(false, 'before-unknown-account', id, 'no recorded "before: view_account" call');
          if (prefix === 'sweep' && !sawTransferPath) add(false, 'transfer-path-uninitialized', id, 'no recorded "transfer-path: view_account" call');
        }
        const stateInitOk = p.stateInitBase64 === null ? !isFirst : toHex(base64.decode(p.stateInitBase64)) === toHex(rawFromTerms(doc, codeHash));
        if (isFirst) add(p.stateInitBase64 !== null && stateInitOk, `${prefix}-carries-state-init`, id, p.stateInitBase64 === null ? 'first tx has no UniversalStateInit' : '');
        if (!p.success && prefix === 'sweep' && JSON.stringify(p.failures).includes('UNDERPAID')) {
          // Expected failure: sweep with too little parked balance reverts the whole receipt; funds stay parked.
          add(true, 'sweep-underpaid-reverted', id, p.txHash);
          awaitParked = parked ?? -1n;
          continue;
        }
        add(p.success && p.receiverId === doc.account_id && stateInitOk, `${prefix}-tx-success`, id, `${p.txHash} result=${String(p.returnValue)}`);
        if (p.success) pending = { view: true, get: true };
        if (p.returnValue === 'PAID') {
          const amount = BigInt(doc.amount_yocto); const tax = amount * BigInt(doc.tax_bps) / 10000n;
          const sum = (to: string) => p.transfers.filter((x) => x.to === to).reduce((s, x) => s + x.yocto, 0n);
          const merchantOk = prefix === 'pay' ? sum(doc.merchant) === amount - tax : sum(doc.merchant) >= amount - tax;
          add(merchantOk, `split-merchant`, id, formatNear(sum(doc.merchant)));
          add(sum(doc.tax_vault) === tax, `split-vault`, id, formatNear(sum(doc.tax_vault)));
          if (p.events.some((e) => e.event === 'payment_refunded')) {
            const r = checkAlreadyFunded(p, result, doc);
            add(r.ok, 'refund-already-funded', id, r.detail);
          }
        } else if (typeof p.returnValue === 'string' && p.returnValue.startsWith('REFUNDED')) {
          const r = checkRefund(p, result, doc);
          add(r.ok, `refund-event`, id, r.detail);
        }
        // v2 (contract-2): every transfer that failed downstream must be recorded on chain by the on_transfer callback as a transfer_failed event.
        const failedEvents = p.events.filter((e) => e.event === 'transfer_failed').length;
        if (p.downstreamFailures.length > 0 || failedEvents > 0) {
          add(failedEvents === p.downstreamFailures.length, 'transfer-failures-recorded', id, `${p.downstreamFailures.length} failed, ${failedEvents} transfer_failed events`);
        }
        expectedStatus = statusAfter(p.returnValue, expectedStatus);
      } else if (call.label === 'after: view_account' || call.label === 'sweep-after: view_account') {
        const s = accountStateFromResponse(call.response);
        if (awaitParked !== null) {
          add(s.kind === 'UNINITIALIZED' && s.amount === awaitParked, 'sweep-underpaid-funds-parked', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
          awaitParked = null;
          continue;
        }
        if (pending) pending.view = false;
        add(s.kind === 'INITIALIZED' && s.globalContractHash === codeHash, 'after-code-hash', id, s.kind === 'INITIALIZED' ? String(s.globalContractHash) : s.kind);
      } else if (call.label === 'after: get_invoice' || call.label === 'sweep-after: get_invoice') {
        if (pending) pending.get = false;
        const v = decodeViewResult(call.response);
        add(v.account_id === doc.account_id && v.invoice_id === id, `after-terms-match`, id);
        const expected = expectedStatus ?? 'UNKNOWN';
        const ok = expected !== 'UNKNOWN' && (expected === 'NOT_OPEN' ? v.status !== 'OPEN' : v.status === expected);
        add(ok, `after-status-${expected}`, id, ok ? '' : `expected ${expected}, got ${v.status}`);
      }
    }
    flushPending();
    if (awaitParked !== null) add(false, 'sweep-underpaid-funds-parked', id, 'no recorded sweep-after view_account');
  }
  return checks;
}
