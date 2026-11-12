// Live status of an invoice account (shared by `zi status` and the MCP server).
import { formatNear } from './bytes.ts';
import { trustedCodeHash, pinForVerification, type Config } from './config.ts';
import { viewAccount, viewInvoice } from './rpc.ts';
import { docProblem, onchainProblem, docToken, docUnit, docDecimals, type InvoiceDoc } from './invoice.ts';
import { ftBalanceOf, formatUnits } from './ft.ts';

/** NEP-141 balance for a status view: a failed view is reported as unknown, never as zero. */
async function tokenBalanceOrError(cfg: Config, token: string | null, account: string): Promise<{ raw: bigint | null; error: string | null }> {
  if (token === null) return { raw: 0n, error: null };
  try { return { raw: await ftBalanceOf(cfg, token, account), error: null }; } catch (e) { return { raw: null, error: e instanceof Error ? e.message : String(e) }; }
}

export async function statusLine(cfg: Config, doc: InvoiceDoc, label?: string): Promise<{ line: string; obj: any }> {
  // A status is only shown for a document that is the invoice its own terms derive: a forged file must not borrow another account's PAID state.
  const pin = pinForVerification(trustedCodeHash(cfg), doc.code_hash);
  const bad = docProblem(doc, pin, cfg.allowedTokens);
  if (bad) return { line: `STATE UNVERIFIED ${bad}`, obj: { state: 'UNVERIFIED', reason: bad } };
  const s = await viewAccount(cfg, doc.account_id, label);
  const token = docToken(doc);
  const unit = docUnit(doc);
  const dec = docDecimals(doc);
  const bal = await tokenBalanceOrError(cfg, token, doc.account_id);
  const tokens = bal.raw;
  const tokenFields = { token_balance_raw: tokens === null ? null : tokens.toString(), ...(bal.error ? { token_balance_error: bal.error } : {}) };
  const tokensText = tokens === null ? `UNKNOWN (${bal.error})` : `${formatUnits(tokens, dec)} ${unit}`;
  const parked = tokens === null ? ` tokens=${tokensText}` : tokens > 0n ? ` tokens_parked=${tokensText}` : '';
  if (s.kind === 'NONEXISTENT') return { line: `STATE NONEXISTENT${parked}`.trim(), obj: { ...s, ...tokenFields } };
  if (s.kind === 'UNINITIALIZED') return { line: `STATE UNINITIALIZED balance=${formatNear(s.amount)}${parked}`, obj: { ...s, ...tokenFields } };
  const inv = await viewInvoice(cfg, doc.account_id, label ? label.replace('view_account', 'get_invoice') : undefined);
  const mismatch = onchainProblem(doc, pin, s.globalContractHash, inv);
  if (mismatch) return { line: `STATE UNVERIFIED ${mismatch}`, obj: { state: 'UNVERIFIED', reason: mismatch, onchain: s.kind } };
  const extra = token === null ? ''
    : ` tokens=${tokensText} owed_merchant=${formatUnits(BigInt(inv.owed_merchant ?? '0'), dec)} owed_tax=${formatUnits(BigInt(inv.owed_tax ?? '0'), dec)} owed_payer=${formatUnits(BigInt(inv.owed_payer ?? '0'), dec)}`;
  return { line: `STATE INITIALIZED status=${inv.status} paid_by=${inv.paid_by ?? 'null'} balance=${formatNear(s.amount)} storage=${s.storageUsage}${extra}`,
    obj: { ...s, ...tokenFields, invoice: inv } };
}

