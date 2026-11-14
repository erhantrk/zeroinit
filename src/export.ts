// `zi export`: one CSV row per invoice, for a bookkeeper. Every status comes from the chain, never from the local file.
import { formatNear } from './bytes.ts';
import { trustedCodeHash, pinForVerification, readOnlyAllowList, type Config } from './config.ts';
import { viewAccount, viewInvoice } from './rpc.ts';
import { docProblem, onchainProblem, docAmountRaw, docToken, docUnit, docDecimals, type InvoiceDoc } from './invoice.ts';
import { ftBalanceOf, formatUnits } from './ft.ts';
import { checkCode } from './checkcode.ts';

export const EXPORT_COLUMNS = [
  'invoice_id', 'status', 'currency', 'amount', 'merchant_share', 'tax_share', 'tax_rate_percent', 'paid_amount', 'paid_at_utc', 'due_utc',
  'merchant', 'tax_vault', 'paid_by', 'owed_not_yet_sent', 'address', 'check_code', 'token_contract', 'explorer_link', 'note',
] as const;
export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

/** What the chain says about one invoice address (fetched by `chainView`, or supplied by a test). */
export type ChainView =
  | { kind: 'unverified'; reason: string }
  | { kind: 'no-account'; parked: bigint }                 // NONEXISTENT or UNINITIALIZED: nobody has paid through the contract
  | { kind: 'invoice'; inv: any; parked: bigint };         // INITIALIZED, running the pinned code with the document's terms; parked = token balance

/** floor(x * bps / 10000), the contract's own tax formula. */
export function taxOf(x: bigint, bps: number): bigint {
  const b = BigInt(bps);
  return (x / 10_000n) * b + (x % 10_000n) * b / 10_000n;
}

export async function chainView(cfg: Config, doc: InvoiceDoc): Promise<ChainView> {
  const pin = pinForVerification(trustedCodeHash(cfg), doc.code_hash);
  const bad = docProblem(doc, pin, readOnlyAllowList(cfg, doc.code_hash, docToken(doc)));
  if (bad) return { kind: 'unverified', reason: bad };
  const s = await viewAccount(cfg, doc.account_id);
  const token = docToken(doc);
  if (s.kind !== 'INITIALIZED') {
    const parked = token !== null ? await ftBalanceOf(cfg, token, doc.account_id) : s.kind === 'UNINITIALIZED' ? s.amount : 0n;
    return { kind: 'no-account', parked };
  }
  const inv = await viewInvoice(cfg, doc.account_id);
  const mismatch = onchainProblem(doc, pin, s.globalContractHash, inv);
  if (mismatch) return { kind: 'unverified', reason: mismatch };
  // A token invoice can hold tokens that no settlement used yet (a plain transfer short of the price); a NEAR balance mixes in storage, so it is not shown.
  const parked = token !== null && inv.status === 'OPEN' ? await ftBalanceOf(cfg, token, doc.account_id) : 0n;
  return { kind: 'invoice', inv, parked };
}

const iso = (ms: bigint | string | number): string => new Date(Number(ms)).toISOString();

export function exportRow(doc: InvoiceDoc, view: ChainView, network: string, now = Date.now()): ExportRow {
  const token = docToken(doc);
  const dec = docDecimals(doc);
  const fmt = (x: bigint) => (token === null ? formatNear(x) : formatUnits(x, dec));
  const amount = docAmountRaw(doc);
  const expectedTax = taxOf(amount, doc.tax_bps);
  const explorer = network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  const row: ExportRow = {
    invoice_id: doc.invoice_id, status: '', currency: docUnit(doc), amount: fmt(amount),
    merchant_share: fmt(amount - expectedTax), tax_share: fmt(expectedTax), tax_rate_percent: (doc.tax_bps / 100).toString(),
    paid_amount: '', paid_at_utc: '', due_utc: iso(doc.expires_at_ms), merchant: doc.merchant, tax_vault: doc.tax_vault, paid_by: '',
    owed_not_yet_sent: '', address: doc.account_id, check_code: checkCode(doc.account_id), token_contract: token ?? '',
    explorer_link: `${explorer}/address/${doc.account_id}`, note: '',
  };
  if (view.kind === 'unverified') {
    return { ...row, status: 'UNVERIFIED', note: `not counted: ${view.reason}` };
  }
  if (view.kind === 'no-account') {
    const expired = now > Number(doc.expires_at_ms);
    const parked = view.parked > 0n ? `${fmt(view.parked)} ${docUnit(doc)} sent by plain transfer, not settled yet (anyone can run zi sweep)` : '';
    return { ...row, status: expired ? 'EXPIRED' : 'OPEN', note: parked || (expired ? 'never paid' : 'not paid yet') };
  }
  const inv = view.inv;
  const paid = BigInt(inv.paid_amount ?? '0');
  const owed = BigInt(inv.owed_merchant ?? '0') + BigInt(inv.owed_tax ?? '0');
  const owedPayer = BigInt(inv.owed_payer ?? '0');
  const settled = inv.status === 'PAID' || inv.status === 'SETTLING';
  const tax = BigInt(inv.tax_amount ?? '0');
  const notes: string[] = [];
  const pastDue = inv.status === 'OPEN' && now > Number(doc.expires_at_ms);
  if (inv.status === 'OPEN' && view.parked > 0n) notes.push(`${fmt(view.parked)} ${docUnit(doc)} received by plain transfer, less than the price; not settled`);
  if (pastDue) notes.push('past the due date and never paid');
  if (settled && inv.paid_by == null) notes.push('paid fully or partly by a plain transfer, so no single payer is recorded');
  if (owed > 0n) notes.push('part of the payout is owed; zi sweep resends it');
  if (owedPayer > 0n) notes.push(`${fmt(owedPayer)} ${docUnit(doc)} owed back to the payer`);
  if (inv.status === 'REFUNDED') notes.push('the payment was returned');
  return {
    ...row,
    status: pastDue ? 'EXPIRED' : String(inv.status),
    merchant_share: settled ? fmt(paid - tax) : row.merchant_share,
    tax_share: settled ? fmt(tax) : row.tax_share,
    paid_amount: settled ? fmt(paid) : '',
    paid_at_utc: settled && BigInt(inv.paid_at_ms ?? '0') > 0n ? iso(inv.paid_at_ms) : '',
    paid_by: inv.paid_by ?? '',
    owed_not_yet_sent: owed > 0n ? fmt(owed) : '',
    note: notes.join('; '),
  };
}

/** RFC 4180 field; a leading = + - @ is prefixed with ' so a spreadsheet never runs it as a formula. */
export function csvField(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(','), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvField(r[c])).join(','))];
  return lines.join('\r\n') + '\r\n';
}
