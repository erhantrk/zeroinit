// ZeroInit MCP tools (plain functions; mcp/server.ts wraps them). Read-only: nothing here signs or sends a transaction, and no key is ever read.
// Everything is computed by the existing library code (stateinit, invoice, verify, status, rpc); nothing is re-implemented.
import { parseNear, formatNear } from '../src/bytes.ts';
import { trustedCodeHash, pinForVerification, deploymentOf, deploymentLabel, tokenBySymbol, type Config } from '../src/config.ts';
import { invoiceStateBytes } from '../src/stateinit.ts';
import { createInvoiceDoc, assertAccountsUsable, checkDoc, docProblem, GRACE_DEFAULT_MS, GRACE_MIN_MS, GRACE_MAX_MS, randomSalt,
  isV3Doc, docAmountRaw, docAmountDisplay, docUnit, docToken, type InvoiceDoc } from '../src/invoice.ts';
import { checkNetwork, viewAccount, viewInvoice } from '../src/rpc.ts';
import { statusLine } from '../src/status.ts';
import { verifyDoc } from '../src/verify.ts';
import { GAS, parseUnits, formatUnits, ftBalanceOf } from '../src/ft.ts';

/** A refused input: the tool answers an MCP error with this message (a normal result is never an exception). */
export class InputError extends Error {}

const EXPLORER = 'https://testnet.nearblocks.io';
const bigintJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Accounts a status view may be asked about: testnet ids only (the RPC is testnet-only anyway; this keeps odd strings out of requests). */
const ACCOUNT_ID = /^(?:[a-z0-9_.-]{2,64}|0[us][0-9a-z]{20,64})$/;
const TESTNET_ACCOUNT = /^(?:[a-z0-9_.-]+\.testnet|[0-9a-f]{64}|0[us][0-9a-z]+)$/;

export interface IssueArgs {
  merchant: string; tax_vault?: string; amount: string; asset?: string; tax_bps?: number; invoice_number: string;
  expires_in?: string; expires_at?: string; payout_grace_ms?: number; salt?: string; offline?: boolean;
}

function parseExpiry(now: number, inStr?: string, atStr?: string): bigint {
  let ms: number;
  if (atStr) {
    ms = Date.parse(atStr);
    if (Number.isNaN(ms)) throw new InputError('bad expires_at (use an ISO 8601 time, e.g. 2026-12-31T00:00:00Z)');
  } else {
    const m = /^(\d+)([mhd])$/.exec(inStr ?? '24h');
    if (!m) throw new InputError('expires_in must look like 30m, 24h or 7d');
    ms = now + Number(m[1]) * (m[2] === 'd' ? 86_400_000 : m[2] === 'h' ? 3_600_000 : 60_000);
  }
  if (!Number.isSafeInteger(ms) || ms <= now) throw new InputError('the expiry must be in the future');
  return BigInt(ms);
}

function payInstructions(doc: InvoiceDoc, cfg: Config): Record<string, unknown> {
  const unit = docUnit(doc);
  const amount = `${docAmountDisplay(doc)} ${unit}`;
  const token = docToken(doc);
  const common = { pay_address: doc.account_id, amount, amount_raw: docAmountRaw(doc).toString(), expires_at_iso: doc.expires_at_iso,
    split: `${doc.tax_bps / 100}% to the tax vault ${doc.tax_vault}, the rest to the merchant ${doc.merchant}, in the payer's transaction` };
  if (token === null) {
    return { ...common,
      one_transaction: { who: 'the payer, signing with their own key', receiver_id: doc.account_id,
        actions: [{ UniversalStateInit: { raw_state_init_hex: doc.raw_state_init_hex, deposit: '0' } },
          { FunctionCall: { method_name: 'pay', args: {}, gas: GAS.payNear.toString(), deposit_yocto: docAmountRaw(doc).toString() } }],
        cli: `zi pay ${doc.invoice_id}` },
      plain_transfer: { who: 'any wallet or exchange', how: `send ${amount} to ${doc.account_id}`,
        then: `the money waits in the account until anyone runs a sweep (zi sweep ${doc.invoice_id}); a transfer of less than the price is not refunded` } };
  }
  return { ...common, token, token_symbol: unit,
    step_1_register_once: { who: 'the merchant, the payer or anyone (they pay about 0.00125 NEAR)', receiver_id: token,
      action: { FunctionCall: { method_name: 'storage_deposit', args: { account_id: doc.account_id, registration_only: true }, deposit: 'the token\'s storage_balance_bounds().min' } },
      why: 'a token transfer to an unregistered account fails; this registration is a transaction, so issuing a token invoice is free but paying it is not just one transaction',
      cli: `zi token register ${doc.invoice_id}` },
    step_2_pay: { who: 'the payer', options: [
      { name: 'one step', how: `zi pay ${doc.invoice_id} (initialises the account, then ft_transfer_call to ${doc.account_id} with msg {"action":"pay","invoice_id":"${doc.invoice_id}"}, 1 yocto)` },
      { name: 'plain transfer', how: `ft_transfer of ${amount} to ${doc.account_id} on ${token}, then anyone runs zi sweep ${doc.invoice_id}; do not also pay by ft_transfer_call (the parked tokens would be charged twice)` }] },
    note: `the token is on this server's allow-list (${cfg.allowedTokens.map((t) => `${t.symbol} ${t.accountId}`).join(', ')}); a testnet mock with no value` };
}

export async function issueInvoice(cfg: Config, a: IssueArgs, now = Date.now()): Promise<Record<string, unknown>> {
  const codeHash = trustedCodeHash(cfg);
  const dep = deploymentOf(codeHash);
  if (dep?.historical) throw new InputError(`the pinned code hash ${codeHash} is the ${dep.version} deployment (history): refusing to issue; unset ZI_CODE_HASH to use the current deployment`);
  const layout = (dep?.layout ?? 1) as 1 | 3;
  if (a.tax_vault !== undefined && a.tax_bps === undefined) throw new InputError('tax_vault needs tax_bps (basis points, 800 = 8%)');
  const taxBps = a.tax_bps ?? 0;
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000) throw new InputError('tax_bps must be an integer 0..10000');
  const taxVault = a.tax_vault ?? a.merchant;
  for (const [name, id] of [['merchant', a.merchant], ['tax_vault', taxVault]] as const) {
    if (!TESTNET_ACCOUNT.test(id)) throw new InputError(`${name} "${id}" is not a testnet account (.testnet, 64-hex implicit or 0u/0s)`);
  }
  const symbol = a.asset ?? 'NEAR';
  const tokenEntry = symbol === 'NEAR' ? null : tokenBySymbol(cfg.allowedTokens, symbol);
  if (symbol !== 'NEAR' && !tokenEntry) {
    throw new InputError(cfg.allowedTokens.length ? `unknown asset ${symbol} (allowed: NEAR, ${cfg.allowedTokens.map((t) => t.symbol).join(', ')})` : `unknown asset ${symbol}: only NEAR (no token is configured)`);
  }
  if (tokenEntry && layout !== 3) throw new InputError('token invoices need the v3 layout (the pinned deployment is older)');
  if (a.payout_grace_ms !== undefined && layout !== 3) throw new InputError('payout_grace_ms only exists on v3 invoices');
  if (a.salt !== undefined && (!/^\d+$/.test(a.salt) || BigInt(a.salt) >= 1n << 64n)) throw new InputError('salt must be an integer in 0..2^64-1');
  let grace: bigint | undefined;
  if (layout === 3) {
    grace = a.payout_grace_ms === undefined ? GRACE_DEFAULT_MS : BigInt(a.payout_grace_ms);
    if (!Number.isInteger(Number(grace)) || grace < GRACE_MIN_MS || grace > GRACE_MAX_MS) throw new InputError(`payout_grace_ms must be between ${GRACE_MIN_MS} and ${GRACE_MAX_MS}`);
  }
  let amount: bigint;
  try { amount = tokenEntry ? parseUnits(a.amount, tokenEntry.decimals) : parseNear(a.amount); } catch (e) { throw new InputError(`bad amount: ${errText(e)}`); }
  const terms = { invoice_id: a.invoice_number, merchant: a.merchant, tax_vault: taxVault, tax_bps: taxBps, amount,
    expires_at_ms: parseExpiry(now, a.expires_in, a.expires_at), salt: a.salt !== undefined ? BigInt(a.salt) : randomSalt(),
    layout, grace_ms: grace, token: tokenEntry?.accountId ?? null, token_symbol: tokenEntry?.symbol, token_decimals: tokenEntry?.decimals };
  let doc: InvoiceDoc;
  try {
    invoiceStateBytes(terms);   // validates
    if (!a.offline) {
      try { await assertAccountsUsable(cfg, { merchant: terms.merchant, tax_vault: terms.tax_vault, token: terms.token, token_symbol: terms.token_symbol, token_decimals: terms.token_decimals }); }
      catch (e) { throw new InputError(`${errText(e)} (set offline: true to skip the account checks)`); }
    }
    doc = createInvoiceDoc(cfg.scheme, codeHash, terms, new Date(now));
  } catch (e) { throw e instanceof InputError ? e : new InputError(errText(e)); }
  const warnings: string[] = [];
  if (!dep) warnings.push(`code hash ${codeHash} is not a known ZeroInit deployment (ZI_CODE_HASH is set): a payer who trusts the current deployment will refuse this invoice`);
  if (a.tax_vault === undefined) warnings.push('no tax_vault given: the tax vault is the merchant and tax_bps is 0 unless set');
  if (a.offline) warnings.push('offline: the merchant / tax vault accounts were not checked on testnet');
  return {
    transaction_sent: false,
    cost: 'Issuing sent no transaction and cost nothing: the address is computed from the terms. The payer\'s own transaction creates the account, pays the merchant and sets the tax aside. This server never signs.',
    pay_address: doc.account_id,
    deployment: deploymentLabel(codeHash),
    invoice: doc,
    pay_instructions: payInstructions(doc, cfg),
    explorer: `${EXPLORER}/address/${doc.account_id}`,
    warnings,
  };
}

/** Everything about the account of an invoice document, or of a bare account id (then nothing is checked against terms). */
export async function invoiceStatus(cfg: Config, a: { invoice?: InvoiceDoc; account_id?: string }): Promise<Record<string, unknown>> {
  if (a.invoice === undefined && a.account_id === undefined) throw new InputError('give invoice (the document from issue_invoice) or account_id');
  if (a.invoice !== undefined && a.account_id !== undefined) throw new InputError('give invoice or account_id, not both');
  const accountId = a.invoice ? String((a.invoice as any).account_id ?? '') : a.account_id!;
  if (!ACCOUNT_ID.test(accountId)) throw new InputError(`"${accountId}" is not an account id`);
  const links = { account: `${EXPLORER}/address/${accountId}` };
  try {
    await checkNetwork(cfg);
    if (a.invoice) {
      const s = await statusLine(cfg, a.invoice);
      const o: any = bigintJson(s.obj);
      const state = o.state === 'UNVERIFIED' ? 'UNVERIFIED' : o.kind === 'INITIALIZED' ? String(o.invoice?.status ?? 'INITIALIZED') : o.kind === 'UNINITIALIZED' ? 'FUNDED_NOT_MATERIALIZED' : String(o.kind);
      return { ok: o.state !== 'UNVERIFIED', state, account_id: accountId, summary: s.line, detail: o, explorer: links, network_error: null };
    }
    const acc = await viewAccount(cfg, accountId);
    if (acc.kind !== 'INITIALIZED') {
      const state = acc.kind === 'UNINITIALIZED' ? 'FUNDED_NOT_MATERIALIZED' : 'NONEXISTENT';
      return { ok: true, state, account_id: accountId, detail: bigintJson(acc), note: 'no invoice document given: the account was not checked against any terms', explorer: links, network_error: null };
    }
    const invoice = await viewInvoice(cfg, accountId).catch((e) => ({ error: errText(e) }));
    return { ok: !(invoice as any).error, state: String((invoice as any).status ?? 'INITIALIZED'), account_id: accountId, detail: { account: bigintJson(acc), invoice },
      note: 'UNVERIFIED: no invoice document given, so the on-chain terms were not checked against a document or the pinned code hash; pass the invoice to get that', explorer: links, network_error: null };
  } catch (e) {
    return { ok: false, state: 'UNKNOWN', account_id: accountId, explorer: links, network_error: errText(e) };
  }
}

interface Check { name: string; ok: boolean | null; detail: string }
const parseLine = (l: string): Check => {
  const m = /^(PASS|FAIL|INFO) (\S+)(?: (.*))?$/.exec(l);
  return m ? { name: m[2], ok: m[1] === 'INFO' ? null : m[1] === 'PASS', detail: m[3] ?? '' } : { name: 'line', ok: null, detail: l };
};

export async function verifyInvoice(cfg: Config, a: { invoice: InvoiceDoc; offline?: boolean }): Promise<Record<string, unknown>> {
  const doc = a.invoice;
  let offlineRes: { ok: boolean; lines: string[] };
  try { offlineRes = await verifyDoc(cfg, doc, true); }
  catch (e) { return { ok: false, offline_ok: false, onchain: 'not_checked', checks: [{ name: 'well-formed', ok: false, detail: `malformed invoice document: ${errText(e)}` }] }; }
  if (a.offline) return { ok: offlineRes.ok, offline_ok: offlineRes.ok, onchain: 'skipped', onchain_ok: null, checks: offlineRes.lines.map(parseLine) };
  try {
    const full = await verifyDoc(cfg, doc, false);
    return { ok: full.ok, offline_ok: offlineRes.ok, onchain: 'checked', onchain_ok: full.ok, checks: full.lines.map(parseLine), explorer: { account: `${EXPLORER}/address/${doc.account_id}` } };
  } catch (e) {
    return { ok: false, offline_ok: offlineRes.ok, onchain: 'unreachable', onchain_ok: null, network_error: errText(e),
      checks: [...offlineRes.lines.map(parseLine), { name: 'onchain-checks', ok: false, detail: `not performed: ${errText(e)}` }], explorer: { account: `${EXPLORER}/address/${doc.account_id}` } };
  }
}
