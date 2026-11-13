// v3 replay rules (docs/STABLECOIN.md §11.2 "replay-v3"). A v3 fixture is one whose documents are
// zeroinit-invoice/2; v1/v2 fixtures keep the old rules in replay.ts untouched.
import { base64 } from '@scure/base';
import { formatNear, toHex } from './bytes.ts';
import { formatUnits } from './ft.ts';
import { accountStateFromResponse, decodeViewResult } from './rpc.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';
import { checkDoc, docAmountRaw, docDecimals, docToken, rawFromTerms, termsMatchOnchain, type InvoiceDoc } from './invoice.ts';

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
    && BigInt(fc.deposit) === 1n && BigInt(fc.gas) === 200_000_000_000_000n && result.transaction?.receiver_id === token;
  add(ok, 'ft-call-args', doc.invoice_id, ok ? '' : JSON.stringify({ args, deposit: fc.deposit, gas: fc.gas, receiver: result.transaction?.receiver_id }));
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
  // v3.3: a payment on top of parked tokens settles the price once; the event names the parked part and who sent the rest.
  const parkedApplied = paid ? decimal(paid.parked_applied ?? '0') : null;
  if (paid && paid.via === 'transfer' && parkedApplied !== null && parkedApplied > 0n) {
    add(paid.topped_up_by === sender && used + parkedApplied === decimal(paid.amount) && refunded === decimal(paid.excess_refunded), 'ft-parked-applied', id,
      `used ${used} + parked ${parkedApplied} = amount ${String(paid.amount)}, refunded ${refunded} = excess ${String(paid.excess_refunded)}, topped up by ${String(paid.topped_up_by)}`);
  }
}


/** The deposit attached to the tx's `pay` call (what the contract must refund or settle), or null. */
function payDeposit(result: any): bigint | null {
  for (const a of result?.transaction?.actions ?? []) {
    if (a?.FunctionCall?.method_name === 'pay') return BigInt(a.FunctionCall.deposit);
  }
  return null;
}

const REFUND_REASON: Record<string, string> = {
  REFUNDED_UNDERPAID: 'underpaid',
  REFUNDED_EXPIRED: 'expired',
  REFUNDED_NOT_OPEN: 'not_open',
  REFUNDED_WRONG_ASSET: 'wrong_asset',
  REFUNDED_BUSY: 'busy',
};

/**
 * A NEAR `pay` is accounted for to the yocto. A refund (REFUNDED_*): right reason, amount == attached deposit, recipient == signer == the event's
 * payer, and exactly that Transfer. A settlement: deposit == price + excess, the excess goes back to the signer. An `already_funded` pay (parked funds
 * covered the price): the whole deposit goes back to the signer.
 */
function checkNearPay(result: any, doc: InvoiceDoc, p: ParsedTx, add: Add): void {
  const id = doc.invoice_id;
  const deposit = payDeposit(result);
  if (deposit === null) return;   // not a call of `pay` (an ft_transfer_call is accounted for by checkFtCallAccounting)
  const signer = result?.transaction?.signer_id;
  const ret = String(p.returnValue);
  const toSigner = p.transfers.filter((t) => t.to === signer).reduce((s, t) => s + t.yocto, 0n);
  const refund = p.events.find((e) => e.event === 'payment_refunded')?.data?.[0] as Record<string, unknown> | undefined;
  const paid = p.events.find((e) => e.event === 'invoice_paid')?.data?.[0] as Record<string, unknown> | undefined;
  if (ret.startsWith('REFUNDED_')) {
    const reason = REFUND_REASON[ret];
    const amount = decimal(refund?.amount);
    const ok = p.success && reason !== undefined && refund?.reason === reason && refund?.invoice_id === id && refund?.account_id === doc.account_id
      && typeof refund?.payer === 'string' && refund.payer === signer && amount !== null && amount === deposit && toSigner === deposit
      && !paid;
    add(ok, 'refund-event', id, ok ? ret : `${ret}: expected reason=${reason ?? '?'} refund=${deposit} to=${String(signer)}; got reason=${String(refund?.reason)} amount=${String(refund?.amount)} payer=${String(refund?.payer)} refunded=${toSigner}`);
    return;
  }
  if (ret === 'PAID' && refund) {
    const amount = decimal(refund.amount);
    const ok = p.success && refund.reason === 'already_funded' && refund.invoice_id === id && refund.account_id === doc.account_id && refund.payer === signer
      && deposit > 0n && amount === deposit && toSigner === deposit && paid?.via === 'transfer' && paid?.payer === null;
    add(ok, 'refund-already-funded', id, ok ? `refunded ${formatNear(deposit)} to ${String(signer)}` : `already_funded expected refund=${deposit} to=${String(signer)}; got reason=${String(refund.reason)} amount=${String(refund.amount)} refunded=${toSigner} via=${String(paid?.via)}`);
    return;
  }
  if (ret === 'PAID' && paid && paid.via === 'pay') {
    const settled = decimal(paid.amount);
    const excess = decimal(paid.excess_refunded);
    const ok = settled !== null && excess !== null && deposit === settled + excess && toSigner === excess;
    add(ok, 'pay-deposit-accounted', id, `deposit ${formatNear(deposit)} = settled ${String(paid.amount)} + excess ${String(paid.excess_refunded)}; ${formatNear(toSigner)} back to the signer`);
  }
  // v3.3: pay() on top of parked NEAR: deposit + parked = price + excess, no payer recorded, the signer named as the one who topped up.
  const parkedApplied = paid ? decimal(paid.parked_applied ?? '0') : null;
  if (ret === 'PAID' && paid && paid.via === 'transfer' && !refund && parkedApplied !== null && parkedApplied > 0n) {
    const settled = decimal(paid.amount);
    const excess = decimal(paid.excess_refunded);
    const ok = settled !== null && excess !== null && deposit + parkedApplied === settled + excess && toSigner === excess
      && paid.payer === null && paid.topped_up_by === signer;
    add(ok, 'pay-parked-applied', id, `deposit ${formatNear(deposit)} + parked ${formatNear(parkedApplied)} = settled ${String(paid.amount)} + excess ${String(paid.excess_refunded)}; ${formatNear(toSigner)} back to ${String(signer)}`);
  }
}

/** Every transfer / ft_transfer the invoice sends goes to the merchant, the vault or a payer; a token invoice pays out only its own token. */
function checkPayoutRecipients(payouts: Payout[], doc: InvoiceDoc, signer: string | undefined, isPayCall: boolean, payers: Set<string>, add: Add): void {
  const id = doc.invoice_id;
  const token = docToken(doc);
  const wrongToken = payouts.filter((x) => x.via === 'ft' && x.token !== token);
  if (payouts.some((x) => x.via === 'ft')) {
    add(wrongToken.length === 0, 'payout-token-is-invoice-token', id, wrongToken.length ? `${wrongToken[0].token} paid instead of ${String(token)}` : String(token));
  }
  const allowed = new Set<string>([doc.merchant, doc.tax_vault, ...payers]);
  if (isPayCall && signer) allowed.add(signer);   // a `pay` may refund its own deposit or excess to its signer
  const stray = payouts.filter((x) => !allowed.has(x.to));
  if (payouts.length > 0) add(stray.length === 0, 'payout-to-known-party', id, stray.length ? `${stray[0].to} is not the merchant, the tax vault or a payer` : '');
}

/** The settlement payouts of a payer's `pay` are the invoice's own split of the price, whether or not invoice_paid followed. */
function checkPaySplitFromTerms(payouts: Payout[], doc: InvoiceDoc, add: Add): void {
  const id = doc.invoice_id;
  const token = docToken(doc) !== null;
  const price = docAmountRaw(doc);
  const tax = price * BigInt(doc.tax_bps) / 10_000n;
  const sum = (to: string) => payouts.filter((x) => x.to === to && x.via === (token ? 'ft' : 'near')).reduce((s, x) => s + x.amount, 0n);
  const ok = sum(doc.merchant) === price - tax && sum(doc.tax_vault) === tax;
  add(ok, 'pay-split-from-terms', id, `merchant ${sum(doc.merchant)} / vault ${sum(doc.tax_vault)}, the terms say ${price - tax} / ${tax}`);
}

/** All payouts of one tx (a settlement, a retry or a reclaim) and the events that describe them. */
function checkResendAndSplit(result: any, doc: InvoiceDoc, p: ParsedTx, add: Add, beforeStatus: string | null, paidBy: string | null, prefix: string, view: any): void {
  const id = doc.invoice_id;
  const signer: string | undefined = result.transaction?.signer_id;
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
  // owed_reclaimed: exactly what was owed to the merchant and the vault goes back to paid_by, in one payout.
  for (const e of p.events.filter((x) => x.event === 'owed_reclaimed')) {
    const d = e.data[0] as Record<string, unknown>;
    const amount = decimal(d.amount); const mPart = decimal(d.merchant_part); const tPart = decimal(d.tax_part);
    const owedM = decimal(view?.owed_merchant); const owedT = decimal(view?.owed_tax);
    const ok = amount !== null && mPart !== null && tPart !== null && mPart + tPart === amount && d.payer === paidBy
      && owedM === mPart && owedT === tPart && payouts.length === 1 && payouts[0].to === paidBy && payouts[0].amount === amount;
    add(ok, 'reclaim-matches-owed', id, `reclaimed ${String(d.amount)} (merchant ${String(d.merchant_part)} + tax ${String(d.tax_part)}) to ${String(d.payer)}; owed before: ${String(view?.owed_merchant)} + ${String(view?.owed_tax)}; paid ${payouts.map((x) => `${x.to}:${x.amount}`).join(',')}`);
  }
  // extra_swept: the merchant and the vault get the invoice's own split of the extra, nobody else.
  const resentTo = (to: string) => resent.reduce((sum, e) => { const d = e.data[0] as Record<string, unknown>; return d.to === to ? sum + (decimal(d.amount) ?? 0n) : sum; }, 0n);
  for (const e of p.events.filter((x) => x.event === 'extra_swept')) {
    const d = e.data[0] as Record<string, unknown>;
    const net = decimal(d.amount); const tax = decimal(d.tax_amount);
    const dec = docDecimals(doc); const token = docToken(doc) !== null;
    const sum = (to: string) => payouts.filter((x) => x.to === to && x.via === (token ? 'ft' : 'near')).reduce((a, x) => a + x.amount, 0n);
    const okPayout = net !== null && tax !== null && d.to === doc.merchant && d.tax_to === doc.tax_vault
      && sum(doc.merchant) - resentTo(doc.merchant) === net && sum(doc.tax_vault) - resentTo(doc.tax_vault) === tax;
    add(okPayout, 'extra-swept-payouts', id, `merchant ${net === null ? '?' : formatUnits(net, dec)} -> ${String(d.to)}, vault ${tax === null ? '?' : formatUnits(tax, dec)} -> ${String(d.tax_to)}; paid ${payouts.map((x) => `${x.to}:${x.amount}`).join(',')}`);
    const okTax = net !== null && tax !== null && tax === (net + tax) * BigInt(doc.tax_bps) / 10_000n;
    add(okTax, 'extra-swept-tax', id, `tax ${String(d.tax_amount)} of extra ${net === null || tax === null ? '?' : net + tax} at ${doc.tax_bps} bps`);
  }
  const paid = p.events.find((e) => e.event === 'invoice_paid');
  // A settlement the payer's own `pay` started is the invoice's split of the price whether or not invoice_paid followed (a failed payout, a deleted receipt).
  const refundedWhole = p.transfers.filter((t) => t.to === signer).reduce((a, t) => a + t.yocto, 0n) === payDeposit(result);
  if (docToken(doc) === null && payDeposit(result) !== null && (p.returnValue === 'PAID' || p.returnValue === 'PAYOUT_PENDING')
    && !refundedWhole && !p.events.some((e) => e.event === 'payment_refunded')) {
    checkPaySplitFromTerms(payouts, doc, add);
  }
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
      // ... at the invoice's price: a payer pays exactly the price, a swept transfer covers it; `payer` is the signer (pay) or null (transfer).
      const price = docAmountRaw(doc);
      add(d.via === 'pay' ? settled === price : d.via === 'transfer' && settled >= price, 'settled-covers-price', id, `${show(settled)} of ${show(price)} via ${String(d.via)}`);
      add(d.via === 'pay' ? d.payer === signer : d.via === 'transfer' && d.payer === null, 'paid-by-signer', id, `payer ${String(d.payer)}, signer ${String(signer)}`);
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
  // A fixture that continues an invoice created and paid in an earlier recording (the L3 retry on LATE-V3) lists it in `resumed`:
  // the first snapshot must then show an INITIALIZED account on the pinned code, and the first tx does not carry a state init.
  const resumed = Array.isArray(f.resumed) && f.resumed.includes(id);
  let expectedStatus: string = 'OPEN';
  let beforeStatus: string | null = null;
  let paidBy: string | null = null;
  let pendingFailure: { merchant: bigint; tax: bigint; payer: bigint } | null = null;
  let pendingView = false;
  let pendingGet = false;
  let checkedInit = resumed;
  let expectUntouched = false;   // the last tx was a sweep that returned CONCURRENT_PAYMENT: nothing may have been paid or recorded as owed
  let sawBefore = false;
  let txSeen = false;
  let view: any = null;                       // the last recorded get_invoice (the state the next tx starts from)
  const payers = new Set<string>();           // accounts a payout may legitimately go back to: signers of `pay` txs and recorded paid_by
  let paidEvents = 0;                         // invoice_paid events of this invoice across the whole recording (must be at most one)
  let pendingPaid: Record<string, unknown> | null = null;   // the invoice_paid of the last tx: the next get_invoice must agree with it
  let pendingResend: { owed_merchant: bigint | null; owed_tax: bigint | null; owed_payer: bigint | null } | null = null;
  const stateInitHex = (() => { try { return toHex(rawFromTerms(doc, codeHash)); } catch { return null; } })();
  const seeView = (v: any) => { view = v; if (typeof v?.paid_by === 'string') payers.add(v.paid_by); };
  // plain transfers to the invoice account are recorded without an invoice id: attribute them by their receiver
  for (const c of f.calls as any[]) {
    if (c.invoice_id != null || c.label !== 'transfer: tx_status') continue;
    const r = c.response?.result;
    if (r?.transaction?.receiver_id !== doc.account_id) continue;
    const p0 = parseTxStatus(r, doc.account_id);
    const acts: any[] = r.transaction.actions ?? [];
    const okT = p0.success && acts.length > 0 && acts.every((a) => a?.Transfer && BigInt(a.Transfer.deposit) > 0n);
    add(okT, 'plain-transfer-tx', id, `${p0.txHash} ${acts.map((a) => (a?.Transfer ? formatNear(BigInt(a.Transfer.deposit)) : Object.keys(a ?? {})[0])).join(',')}`);
  }
  if (!resumed && !calls.some((c) => String(c.label ?? '').endsWith(': tx_status'))) add(false, 'no-recorded-tx', id, 'the recording has no transaction for this invoice');
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
      if (resumed) {
        add(s.kind === 'INITIALIZED' && s.globalContractHash === codeHash, 'resumed-initialized', id, s.kind === 'INITIALIZED' ? String(s.globalContractHash) : s.kind);
      } else if (docToken(doc) === null) {
        // NEAR: the plain transfer parked funds in an account that exists but has no code yet.
        add(s.kind === 'UNINITIALIZED' && s.amount > 0n, 'transfer-path-uninitialized', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
      } else add(s.kind === 'NONEXISTENT' || s.kind === 'UNINITIALIZED', 'transfer-path-uninitialized', id, s.kind);
    } else if (label.startsWith('ft: ft_balance_of')) {
      // The recorded token balance (parked funds while NEAR still says UNKNOWN_ACCOUNT, or what is left after a settle).
      const v = decodeViewResult(call.response);
      add(v !== null && v !== undefined && /^\d+$/.test(String(v)), 'ft-parked-balance', id, formatUnits(BigInt(String(v)), docDecimals(doc)));
    } else if (label === 'transfer-path: get_invoice (uninitialized)') {
      const v = decodeViewResult(call.response);
      seeView(v);
      if (resumed && !txSeen) {
        beforeStatus = v.status; paidBy = v.paid_by ?? null; expectedStatus = v.status;
      }
    } else if (label === 'before: get_invoice') {
      const v = decodeViewResult(call.response);
      seeView(v);
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
      if (pendingPaid) {
        // the state the chain reports must be what invoice_paid announced
        const d = pendingPaid;
        const okV = v.status === 'PAID' && (v.paid_by ?? null) === (d.payer ?? null) && decimal(v.paid_amount) === decimal(d.amount) && decimal(v.tax_amount) === decimal(d.tax_amount);
        add(okV, 'after-view-matches-paid-event', id, `view ${String(v.status)} ${String(v.paid_by)} ${String(v.paid_amount)}/${String(v.tax_amount)}, event ${String(d.payer)} ${String(d.amount)}/${String(d.tax_amount)}`);
        pendingPaid = null;
      }
      if (pendingResend) {
        const e = pendingResend;
        const okR = (['owed_merchant', 'owed_tax', 'owed_payer'] as const).every((k) => e[k] === null || decimal(v[k] ?? '0') === e[k]);
        add(okR, 'owed-after-resend', id, `owed ${String(v.owed_merchant)}/${String(v.owed_tax)}/${String(v.owed_payer)}, expected ${String(e.owed_merchant)}/${String(e.owed_tax)}/${String(e.owed_payer)}`);
        pendingResend = null;
      }
      seeView(v);
      if (pendingFailure) {
        const owedM = BigInt(String(v.owed_merchant ?? '0'));
        const owedT = BigInt(String(v.owed_tax ?? '0'));
        add(owedM === pendingFailure.merchant && owedT === pendingFailure.tax, 'owed-after-failure', id, `owed ${owedM}/${owedT}, failed ${pendingFailure.merchant}/${pendingFailure.tax}`);
        pendingFailure = null;
      }
      if (expectUntouched) {
        const owed = BigInt(String(v.owed_merchant ?? '0')) + BigInt(String(v.owed_tax ?? '0')) + BigInt(String(v.owed_payer ?? '0'));
        add(owed === 0n && v.status === 'OPEN' && (v.paid_by ?? null) === null && String(v.paid_amount ?? '0') === '0', 'concurrent-payment-nothing-owed', id,
          `status ${String(v.status)}, owed ${owed}, paid_by ${String(v.paid_by ?? null)}`);
        expectUntouched = false;
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
      // Whatever state init a tx carries is exactly this invoice's (the account is created FROM THESE TERMS), and the tx is addressed to the
      // invoice account (an ft_transfer_call: to the token, with the invoice as receiver_id, checked by ft-call-args).
      if (p.stateInitBase64 !== null) {
        let got: string | null = null;
        try { got = toHex(base64.decode(p.stateInitBase64)); } catch { /* malformed */ }
        add(got !== null && got === stateInitHex, 'state-init-matches-terms', id, got === stateInitHex ? '' : 'the recorded UniversalStateInit is not rawFromTerms(document)');
      }
      const isFtCall = (result.transaction?.actions ?? []).some((a: any) => a?.FunctionCall?.method_name === 'ft_transfer_call');
      if (!['register', 'token-register', 'plain-transfer', 'ft-transfer', 'uninitialized-call'].includes(prefix) && !isFtCall) {
        add(p.receiverId === doc.account_id, 'tx-receiver-is-invoice', id, `${prefix} tx addressed to ${p.receiverId}`);
      }
      const signer: string | undefined = result.transaction?.signer_id;
      const isPayCall = payDeposit(result) !== null;
      if (isPayCall && signer) payers.add(signer);
      paidEvents += p.events.filter((e) => e.event === 'invoice_paid').length;
      if (prefix === 'pay') checkFtCall(result, doc, add);
      if (isPayCall) checkNearPay(result, doc, p, add);
      checkPayoutRecipients(payoutsOf(result, doc.account_id), doc, signer, isPayCall, payers, add);
      if (prefix === 'sweep' && p.returnValue === 'CONCURRENT_PAYMENT') {
        // F1 (v3.1): a sweep that read the token balance while a payment was in flight must plan nothing: no payout, no event, nothing owed afterwards.
        const sent = payoutsOf(result, doc.account_id);
        add(sent.length === 0 && p.events.length === 0 && p.downstreamFailures.length === 0, 'concurrent-payment-plans-nothing', id,
          `${sent.length} payout(s), ${p.events.length} event(s), ${p.downstreamFailures.length} failure(s)`);
        expectUntouched = true;
      }
      const paidReceipts = paidAfterCallback(result, doc.account_id, p, add, id);
      checkResendAndSplit(result, doc, p, add, beforeStatus, paidBy, prefix, view);
      const failedEvents = p.events.filter((e) => e.event === 'transfer_failed');
      if (p.downstreamFailures.length > 0 || failedEvents.length > 0) {
        add(failedEvents.length === p.downstreamFailures.length, 'transfer-failed-unregistered', id, `${p.downstreamFailures.length} failed, ${failedEvents.length} transfer_failed events`);
      }
      // Each transfer_failed describes one payout receipt that really failed: same recipient, same amount, and a role the document allows for that recipient.
      {
        const failedIds = failedReceiptIds(result);
        const unmatched = payoutsOf(result, doc.account_id).filter((x) => failedIds.has(x.receiptId));
        for (const e of failedEvents) {
          const d = e.data[0] as Record<string, unknown>;
          const amount = decimal(d.amount);
          const i = unmatched.findIndex((x) => x.to === d.to && x.amount === amount);
          const isPayer = typeof d.to === 'string' && (payers.has(d.to) || d.to === signer);
          const roleOk = d.role === 'merchant' ? d.to === doc.merchant : d.role === 'tax' ? d.to === doc.tax_vault : d.role === 'payer' && isPayer;
          add(i >= 0 && roleOk, 'transfer-failed-matches-payout', id, `${String(d.role)} ${String(d.to)} ${String(d.amount)}${i < 0 ? ' has no failed payout receipt' : roleOk ? '' : ' has the wrong role for that recipient'}`);
          if (i >= 0) unmatched.splice(i, 1);
        }
      }
      // A retry never pays more than was owed, and the chain's owed ledger afterwards is what is left (plus whatever failed again).
      {
        const resent = p.events.filter((e) => e.event === 'tax_resent' || e.event === 'owed_resent');
        if (resent.length > 0) {
          const slotOf = (e: any): 'owed_merchant' | 'owed_tax' | 'owed_payer' => (e.event === 'tax_resent' ? 'owed_tax' : (e.data[0] as any).to === doc.merchant ? 'owed_merchant' : 'owed_payer');
          const by = { owed_merchant: 0n, owed_tax: 0n, owed_payer: 0n };
          for (const e of resent) by[slotOf(e)] += decimal((e.data[0] as any).amount) ?? 0n;
          const failedBy = { owed_merchant: 0n, owed_tax: 0n, owed_payer: 0n };
          for (const e of failedEvents) {
            const d = e.data[0] as any;
            failedBy[d.role === 'tax' ? 'owed_tax' : d.role === 'payer' ? 'owed_payer' : 'owed_merchant'] += decimal(d.amount) ?? 0n;
          }
          const prior = { owed_merchant: decimal(view?.owed_merchant ?? '0'), owed_tax: decimal(view?.owed_tax ?? '0'), owed_payer: decimal(view?.owed_payer ?? '0') };
          const slots = ['owed_merchant', 'owed_tax', 'owed_payer'] as const;
          const within = view !== null && slots.every((k) => prior[k] !== null && by[k] <= prior[k]!);
          add(within, 'owed-resent-within-owed', id, view === null ? 'no recorded state before the retry' : `resent ${by.owed_merchant}/${by.owed_tax}/${by.owed_payer}, owed ${String(prior.owed_merchant)}/${String(prior.owed_tax)}/${String(prior.owed_payer)}`);
          pendingResend = within ? {
            owed_merchant: prior.owed_merchant! - by.owed_merchant + failedBy.owed_merchant,
            owed_tax: prior.owed_tax! - by.owed_tax + failedBy.owed_tax,
            owed_payer: prior.owed_payer! - by.owed_payer + failedBy.owed_payer,
          } : null;
        }
      }
      pendingPaid = (p.events.find((e) => e.event === 'invoice_paid')?.data[0] as Record<string, unknown> | undefined) ?? null;
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
  add(paidEvents <= 1, 'single-invoice-paid', id, `${paidEvents} invoice_paid event(s) in the recording`);
}

