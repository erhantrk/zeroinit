// v3 replay rules (docs/STABLECOIN.md §11.2 "replay-v3"). A v3 fixture is one whose documents are
// zeroinit-invoice/2; v1/v2 fixtures keep the old rules in replay.ts untouched.
import { formatNear } from './bytes.ts';
import { formatUnits } from './ft.ts';
import { accountStateFromResponse, decodeViewResult } from './rpc.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';
import { checkDoc, docDecimals, docToken, termsMatchOnchain, type InvoiceDoc } from './invoice.ts';

type Add = (ok: boolean, name: string, id: string, detail?: string) => void;

interface Payout { receiptId: string; to: string; amount: bigint; via: 'near' | 'ft'; token?: string }

function payoutsOf(result: any, invoice: string): Payout[] {
  const out: Payout[] = [];
  for (const r of result.receipts ?? []) {
    if (r.predecessor_id !== invoice) continue;
    for (const a of r.receipt?.Action?.actions ?? []) {
      if (a.Transfer) out.push({ receiptId: r.receipt_id, to: r.receiver_id, amount: BigInt(a.Transfer.deposit), via: 'near' });
      const fc = a.FunctionCall;
      if (fc?.method_name === 'ft_transfer') {
        try {
          const args = JSON.parse(Buffer.from(String(fc.args), 'base64').toString('utf8'));
          if (typeof args.receiver_id === 'string' && typeof args.amount === 'string') {
            out.push({ receiptId: r.receipt_id, to: args.receiver_id, amount: BigInt(args.amount), via: 'ft', token: r.receiver_id });
          }
        } catch { /* malformed args are caught by the split checks below */ }
      }
    }
  }
  return out;
}

/** A canonical decimal string as bigint, or null (a malformed recording is a FAIL, never a crash). */
function decimal(v: unknown): bigint | null {
  return typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) ? BigInt(v) : null;
}

function failedReceiptIds(result: any): Set<string> {
  const out = new Set<string>();
  for (const ro of result.receipts_outcome ?? []) {
    const st = ro.outcome?.status;
    if (st && typeof st === 'object' && 'Failure' in st) out.add(ro.id);
  }
  return out;
}

function receiptById(result: any): Map<string, any> {
  return new Map((result.receipts ?? []).map((r: any) => [r.receipt_id, r]));
}

/** The `invoice_paid` log must sit in an on_settled callback receipt, after every payout of the tx succeeded. */
function paidAfterCallback(result: any, invoice: string, p: ParsedTx, add: Add, id: string): number {
  const payouts = payoutsOf(result, invoice);
  const failed = failedReceiptIds(result);
  const badPayouts = payouts.filter((x) => failed.has(x.receiptId));
  const receipts = receiptById(result);
  let paidReceipts = 0;
  for (const ro of result.receipts_outcome ?? []) {
    const logs: string[] = ro.outcome?.logs ?? [];
    if (!logs.some((l) => l.includes('"event":"invoice_paid"'))) continue;
    paidReceipts += 1;
    const r = receipts.get(ro.id);
    const isCallback = !!r && (r.receipt?.Action?.actions ?? []).some((a: any) => a.FunctionCall?.method_name === 'on_settled');
    add(isCallback && badPayouts.length === 0, 'invoice-paid-after-callback', id,
      isCallback ? (badPayouts.length ? `payout ${badPayouts[0].receiptId} failed` : '') : 'invoice_paid outside on_settled');
  }
  if (badPayouts.length > 0 || paidReceipts > 0) {
    add(!(badPayouts.length > 0 && paidReceipts > 0), 'no-invoice-paid-on-failure', id, `${badPayouts.length} failed payout(s), ${paidReceipts} invoice_paid`);
  }
  if (p.returnValue === 'PAID' && paidReceipts === 0) add(false, 'invoice-paid-after-callback', id, 'PAID without an invoice_paid event');
  return paidReceipts;
}

/** The token transfer call the payer makes: 1 yocto, 200 Tgas, the invoice as receiver, a positive amount. */
function checkFtCall(result: any, doc: InvoiceDoc, add: Add): void {
  const token = docToken(doc);
  if (token === null) return;
  const actions = result.transaction?.actions ?? [];
  const call = actions.find((a: any) => a?.FunctionCall?.method_name === 'ft_transfer_call');
  if (!call) return; // plain ft_transfer path
  const fc = call.FunctionCall;
  let args: any = null;
  try { args = JSON.parse(Buffer.from(String(fc.args), 'base64').toString('utf8')); } catch { /* checked below */ }
  const ok = !!args && args.receiver_id === doc.account_id && typeof args.amount === 'string' && BigInt(args.amount) > 0n
    && BigInt(fc.deposit) === 1n && BigInt(fc.gas) === 200_000_000_000_000n;
  add(ok, 'ft-call-args', doc.invoice_id, ok ? '' : JSON.stringify({ args, deposit: fc.deposit, gas: fc.gas }));
}


/**
 * ft_transfer_call returns the amount the receiver USED (NEP-141: `ft_resolve_transfer` returns sent minus refunded), not the unused part.
 * What the token returned to the sender is proven by its own `ft_transfer` events with memo "refund" from the invoice account.
 * Rules: used + refunded == sent; a rejected payment used nothing and got everything back; an accepted payment's excess is refunded.
 */
function checkFtCallAccounting(result: any, doc: InvoiceDoc, p: ParsedTx, rejected: { data: Array<Record<string, unknown>> } | undefined, add: Add): void {
  const fc = (result.transaction?.actions ?? []).find((a: any) => a?.FunctionCall?.method_name === 'ft_transfer_call');
  const id = doc.invoice_id;
  if (!fc) {
    if (rejected) add(false, `ft-rejected-${String((rejected.data[0] as Record<string, unknown>)?.reason)}`, id, 'payment_rejected without an ft_transfer_call');
    return;
  }
  let sent: bigint | null = null;
  try { sent = BigInt(JSON.parse(Buffer.from(String(fc.FunctionCall.args), 'base64').toString('utf8')).amount); } catch { /* malformed */ }
  const used = typeof p.returnValue === 'string' && /^\d+$/.test(p.returnValue) ? BigInt(p.returnValue) : null;
  const sender = result.transaction?.signer_id;
  const refunded = p.nep141Events
    .filter((e) => e.event === 'ft_transfer')
    .flatMap((e) => (e.data as Array<Record<string, unknown>>) ?? [])
    .filter((d) => d.memo === 'refund' && d.old_owner_id === doc.account_id && d.new_owner_id === sender)
    .reduce((s, d) => s + BigInt(String(d.amount)), 0n);
  if (sent === null || used === null) { add(false, 'ft-call-accounting', id, `sent ${String(sent)}, returned ${String(p.returnValue)}`); return; }
  add(used + refunded === sent, 'ft-call-accounting', id, `sent ${sent} = used ${used} + refunded ${refunded}`);
  if (rejected) {
    const reason = String((rejected.data[0] as Record<string, unknown>)?.reason);
    add(used === 0n && refunded === sent, `ft-rejected-${reason}`, id, `used ${used}, ${refunded} of ${sent} returned to ${String(sender)}`);
  }
  const paid = p.events.find((e) => e.event === 'invoice_paid')?.data[0] as Record<string, unknown> | undefined;
  if (paid && paid.via === 'pay') {
    add(refunded === decimal(paid.excess_refunded) && used === decimal(paid.amount), 'ft-excess-refunded', id,
      `used ${used} = amount ${String(paid.amount)}, refunded ${refunded} = excess ${String(paid.excess_refunded)}`);
  }
}

/** All payouts of one tx (a settlement, a retry or a reclaim) and the events that describe them. */
function checkResendAndSplit(result: any, doc: InvoiceDoc, p: ParsedTx, add: Add, beforeStatus: string | null, paidBy: string | null, prefix: string): void {
  const id = doc.invoice_id;
  const payouts = payoutsOf(result, doc.account_id);
  const resent = p.events.filter((e) => e.event === 'tax_resent' || e.event === 'owed_resent');
  if (resent.length > 0) {
    for (const e of resent) {
      const d = e.data[0] as Record<string, unknown>;
      const amount = BigInt(String(d.amount));
      const found = payouts.some((x) => x.to === d.to && x.amount === amount);
      add(found, 'owed-resent', id, `${String(d.to)} ${amount}${found ? '' : ' has no matching payout'}`);
    }
    // and no owed payout may go unrecorded
    const owedPayouts = payouts.filter((x) => x.to === doc.merchant || x.to === doc.tax_vault);
    add(owedPayouts.every((x) => resent.some((e) => { const d = e.data[0] as Record<string, unknown>; return d.to === x.to && BigInt(String(d.amount)) === x.amount; })),
      'owed-resent', id, 'a resent payout has no event');
  } else if (prefix === 'sweep' && beforeStatus === 'SETTLING'
    && payouts.some((x) => x.to === doc.merchant || x.to === doc.tax_vault)) {
    add(false, 'owed-resent', id, 'a SETTLING sweep paid the merchant/vault without a tax_resent/owed_resent event');
  }
  if (p.returnValue === 'REFUNDED' && paidBy !== null) {
    add(payouts.length > 0 && payouts.every((x) => x.to === paidBy), 'refund-payer-to-paid-by', id, payouts.map((x) => x.to).join(','));
  }
  const paid = p.events.find((e) => e.event === 'invoice_paid');
  if (paid) {
    const d = paid.data[0] as Record<string, unknown>;
    if (d.retried !== true) {
      const token = docToken(doc) !== null;
      const dec = docDecimals(doc);
      const sum = (to: string) => payouts.filter((x) => x.to === to && x.via === (token ? 'ft' : 'near')).reduce((s, x) => s + x.amount, 0n);
      const show = (v: bigint) => (token ? formatUnits(v, dec) : formatNear(v));
      const merchantAmount = decimal(d.merchant_amount);
      const taxAmount = decimal(d.tax_amount);
      const settled = decimal(d.amount);
      if (merchantAmount === null || taxAmount === null || settled === null) {
        add(false, 'split-matches-terms', id, 'the invoice_paid event has no valid amount / merchant_amount / tax_amount');
        return;
      }
      // The payouts must be what the event says (NEAR: `split-*`, token: `ft-split-*`) ...
      add(sum(doc.merchant) === merchantAmount, token ? 'ft-split-merchant' : 'split-merchant', id, show(sum(doc.merchant)));
      add(sum(doc.tax_vault) === taxAmount, token ? 'ft-split-vault' : 'split-vault', id, show(sum(doc.tax_vault)));
      // ... and the event must be the invoice's own rule: tax = floor(settled amount x tax_bps / 10000), merchant = the rest.
      const tax = settled * BigInt(doc.tax_bps) / 10_000n;
      add(taxAmount === tax && merchantAmount === settled - tax, 'split-matches-terms', id,
        `${show(settled)} -> merchant ${show(settled - tax)}, tax ${show(tax)}`);
    }
  }
}

/** Replay one zeroinit-invoice/2 invoice. */
export function replayV3Invoice(f: any, doc: InvoiceDoc, trusted: string | undefined, add: Add): void {
  const id = doc.invoice_id;
  const calls = (f.calls as any[]).filter((c) => c.invoice_id === id).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const c = checkDoc(doc, trusted);
  if (trusted !== undefined) add(c.codeHashTrusted, 'code-hash-trusted', id, doc.code_hash);
  add(c.formatMatchesDeployment, 'format-matches-deployment', id, doc.format);
  add(c.idFromTerms && c.rawFromTerms, 'id-from-terms', id, doc.account_id);
  add(c.fieldsConsistent, 'doc-fields-from-terms', id);
  const codeHash = trusted ?? doc.code_hash;
  let expectedStatus: string = 'OPEN';
  let beforeStatus: string | null = null;
  let paidBy: string | null = null;
  let pendingFailure: { merchant: bigint; tax: bigint; payer: bigint } | null = null;
  let pendingView = false;
  let pendingGet = false;
  let checkedInit = false;
  let sawBefore = false;
  let txSeen = false;
  const flush = () => {
    if (pendingView) add(false, 'after-code-hash', id, 'no recorded after view_account');
    if (pendingGet) add(false, 'after-status', id, 'no recorded after get_invoice');
    pendingView = false; pendingGet = false;
  };
  for (const call of calls) {
    const label: string = call.label ?? '';
    if (label === 'before: view_account') {
      // Only the FIRST "before" snapshot must show an account that is not initialized (a second pay on the same invoice sees it initialized).
      if (sawBefore) continue;
      sawBefore = true;
      const s = accountStateFromResponse(call.response);
      add(s.kind === 'NONEXISTENT' || s.kind === 'UNINITIALIZED', 'before-unknown-account', id, s.kind);
    } else if (label === 'transfer-path: view_account (uninitialized)') {
      // `zi sweep` records this snapshot on every call; only the one before the first transaction must show a not-yet-initialized account.
      if (txSeen) continue;
      const s = accountStateFromResponse(call.response);
      if (docToken(doc) === null) {
        // NEAR: the plain transfer parked funds in an account that exists but has no code yet.
        add(s.kind === 'UNINITIALIZED' && s.amount > 0n, 'transfer-path-uninitialized', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
      } else add(s.kind === 'NONEXISTENT' || s.kind === 'UNINITIALIZED', 'transfer-path-uninitialized', id, s.kind);
    } else if (label.startsWith('ft: ft_balance_of')) {
      // The recorded token balance (parked funds while NEAR still says UNKNOWN_ACCOUNT, or what is left after a settle).
      const v = decodeViewResult(call.response);
      add(v !== null && v !== undefined && /^\d+$/.test(String(v)), 'ft-parked-balance', id, formatUnits(BigInt(String(v)), docDecimals(doc)));
    } else if (label === 'before: get_invoice') {
      const v = decodeViewResult(call.response);
      beforeStatus = v.status;
      paidBy = v.paid_by ?? null;
      expectedStatus = v.status;
    } else if (label === 'after: view_account' || label === 'sweep-after: view_account') {
      const s = accountStateFromResponse(call.response);
      if (s.kind === 'NONEXISTENT') pendingGet = false;   // no account, so there is no get_invoice to record
      if (s.kind === 'NONEXISTENT') add(true, 'after-nonexistent', id, 'the account is still not initialized (a rejected or plain token payment does not create it)');
      else add(s.kind === 'INITIALIZED' && s.globalContractHash === codeHash, 'after-code-hash', id, s.kind === 'INITIALIZED' ? String(s.globalContractHash) : s.kind);
      pendingView = false;
    } else if (label === 'after: get_invoice' || label === 'sweep-after: get_invoice') {
      const v = decodeViewResult(call.response);
      add(v.account_id === doc.account_id && v.invoice_id === id && termsMatchOnchain(doc, v), 'after-terms-match', id);
      if (pendingFailure) {
        const owedM = BigInt(String(v.owed_merchant ?? '0'));
        const owedT = BigInt(String(v.owed_tax ?? '0'));
        add(owedM === pendingFailure.merchant && owedT === pendingFailure.tax, 'owed-after-failure', id, `owed ${owedM}/${owedT}, failed ${pendingFailure.merchant}/${pendingFailure.tax}`);
        pendingFailure = null;
      }
      const expected = expectedStatus;
      add(expected !== 'UNKNOWN' && v.status === expected, `after-status-${expected}`, id, expected === v.status ? '' : `expected ${expected}, got ${v.status}`);
      beforeStatus = v.status;
      paidBy = v.paid_by ?? null;
      pendingGet = false;
    } else if (label.endsWith(': tx_status')) {
      flush();
      txSeen = true;
      const prefix = label.split(':')[0];
      const result = call.response?.result;
      if (!result) { add(false, `${prefix}-tx-recorded`, id, 'recorded call has no result'); continue; }
      const p = parseTxStatus(result, doc.account_id);
      if (prefix === 'uninitialized-call') {
        // S-F2: ft_transfer_call to an invoice id that was never initialized. The receipt on the nonexistent account fails; the token
        // refunds everything (proved by the accounting check below). The invoice stays NONEXISTENT.
        add(!p.success && p.failures.length > 0 && p.failures.every((f) => JSON.stringify(f).includes('AccountDoesNotExist')), 'uninitialized-call-fails', id, `${p.txHash} ${p.failures.length} failure(s)`);
      } else if (prefix === 'init' || prefix === 'pay' || prefix === 'plain-transfer' || prefix === 'register' || prefix === 'token-register') {
        add(p.success, `${prefix}-tx-success`, id, `${p.txHash} ${JSON.stringify(p.failures)}`);
      } else {
        // sweep/refund may legitimately fail with a business panic; record what the chain said.
        add(p.success || /UNDERPAID|NOTHING_TO_SWEEP|NEEDS_YOCTO|BALANCE_UNAVAILABLE|CONCURRENT_PAYMENT|NOT_YET/.test(JSON.stringify(p.failures)), `${prefix}-tx-result`, id, `${p.txHash} result=${String(p.returnValue)}`);
      }
      // The first account-creating tx must carry the state init. A token `pay` is an ft_transfer_call, never
      // the init tx (tokens need a separate [UniversalStateInit, fund]), so it is not checked here.
      if (!checkedInit && (prefix === 'init' || prefix === 'sweep' || (prefix === 'pay' && docToken(doc) === null))) {
        checkedInit = true;
        add(p.stateInitBase64 !== null, 'tx-carries-state-init', id, p.stateInitBase64 === null ? 'first tx has no UniversalStateInit' : '');
      }
      if (prefix === 'pay') checkFtCall(result, doc, add);
      const paidReceipts = paidAfterCallback(result, doc.account_id, p, add, id);
      checkResendAndSplit(result, doc, p, add, beforeStatus, paidBy, prefix);
      const failedEvents = p.events.filter((e) => e.event === 'transfer_failed');
      if (p.downstreamFailures.length > 0 || failedEvents.length > 0) {
        add(failedEvents.length === p.downstreamFailures.length, 'transfer-failed-unregistered', id, `${p.downstreamFailures.length} failed, ${failedEvents.length} transfer_failed events`);
      }
      const rejected = p.events.find((e) => e.event === 'payment_rejected');
      checkFtCallAccounting(result, doc, p, rejected, add);
      // what the after get_invoice must say
      let next = expectedStatus;
      if (p.returnValue === 'PAID') next = 'PAID';
      else if (p.returnValue === 'REFUNDED') next = 'REFUNDED';
      else if (p.returnValue === 'PAYOUT_PENDING' || p.returnValue === 'SETTLING') next = 'SETTLING';
      else if (docToken(doc) !== null && prefix === 'pay' && p.success && paidReceipts === 0 && !rejected) next = 'SETTLING';
      else if (p.returnValue === 'REFUNDED_EXPIRED') next = 'EXPIRED';
      else if (rejected) next = String((rejected.data[0] as Record<string, unknown>)?.reason) === 'expired' ? 'EXPIRED' : (beforeStatus ?? expectedStatus);
      else if (paidReceipts > 0) next = 'PAID';
      expectedStatus = next;
      const failedM = failedEvents.filter((e) => (e.data[0] as any)?.role === 'merchant').reduce((s, e) => s + BigInt(String((e.data[0] as any).amount)), 0n);
      const failedT = failedEvents.filter((e) => (e.data[0] as any)?.role === 'tax').reduce((s, e) => s + BigInt(String((e.data[0] as any).amount)), 0n);
      const failedP = failedEvents.filter((e) => (e.data[0] as any)?.role === 'payer').reduce((s, e) => s + BigInt(String((e.data[0] as any).amount)), 0n);
      if (failedM + failedT + failedP > 0) pendingFailure = { merchant: failedM, tax: failedT, payer: failedP };
      // Setup txs of the token pay flow (init, registration, plain transfer) have no after snapshots; a settlement does.
      const setup = ['init', 'register', 'token-register', 'plain-transfer', 'ft-transfer'].includes(prefix);
      pendingView = !setup && p.success;
      pendingGet = !setup && p.success;
    }
  }
  flush();
}

