// Invoice document create / load / check (INTERFACES.md §6.1).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { base58 } from '@scure/base';
import { toHex, formatNear } from './bytes.ts';
import { invoiceStateBytes, invoiceStateInit, isValidNearAccountId, type InvoiceTerms, type CodeRef, type Scheme } from './stateinit.ts';
import { actUniversalStateInit, actDeterministicStateInit } from './tx.ts';
import { deploymentOf, type Config } from './config.ts';
import { checkNetwork, viewAccount } from './rpc.ts';

export { isValidNearAccountId };

export interface InvoiceDoc {
  format: 'zeroinit-invoice/1';
  network: 'testnet';
  scheme: Scheme;
  code_hash: string;
  invoice_id: string;
  merchant: string;
  tax_vault: string;
  tax_bps: number;
  amount_yocto: string;
  amount_near: string;
  expires_at_ms: string;
  expires_at_iso: string;
  salt: string;
  state_hex: string;
  raw_state_init_hex: string;
  account_id: string;
  created_at_iso: string;
}

export function randomSalt(): bigint {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return new DataView(b.buffer).getBigUint64(0, true);
}

export function createInvoiceDoc(scheme: Scheme, codeHashB58: string, t: InvoiceTerms, now = new Date()): InvoiceDoc {
  // A bad id would make the contract STATE undeserializable: funds sent there would be locked forever.
  for (const [name, value] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (!isValidNearAccountId(value)) throw new Error(`${name} "${value}" is not a valid NEAR account id (2-64 chars, lowercase a-z 0-9 - _ and dots)`);
  }
  const code: CodeRef = { codeHash: base58.decode(codeHashB58) };
  const { raw, accountId } = invoiceStateInit(scheme, code, t);
  return {
    format: 'zeroinit-invoice/1', network: 'testnet', scheme, code_hash: codeHashB58,
    invoice_id: t.invoice_id, merchant: t.merchant, tax_vault: t.tax_vault, tax_bps: t.tax_bps,
    amount_yocto: t.amount.toString(), amount_near: formatNear(t.amount),
    expires_at_ms: t.expires_at_ms.toString(), expires_at_iso: new Date(Number(t.expires_at_ms)).toISOString(),
    salt: t.salt.toString(), state_hex: toHex(invoiceStateBytes(t)), raw_state_init_hex: toHex(raw),
    account_id: accountId, created_at_iso: now.toISOString(),
  };
}

export function termsFromDoc(d: InvoiceDoc): InvoiceTerms {
  return { invoice_id: d.invoice_id, merchant: d.merchant, tax_vault: d.tax_vault, tax_bps: d.tax_bps,
    amount: BigInt(d.amount_yocto), expires_at_ms: BigInt(d.expires_at_ms), salt: BigInt(d.salt) };
}

const DEC = /^(0|[1-9]\d*)$/;
/** Strict canonical decimal -> bigint (BigInt() alone accepts " 1", "0x10", ""). */
function parseDec(name: string, v: unknown): bigint {
  if (typeof v !== 'string' || !DEC.test(v)) throw new Error(`${name} must be a canonical decimal string`);
  return BigInt(v);
}

export interface DocChecks {
  idFromTerms: boolean;      // account id re-derived from the terms (with the trusted code hash when given)
  rawFromTerms: boolean;     // raw state init re-derived from the terms
  codeHashTrusted: boolean;  // doc.code_hash equals the trusted (pinned) hash
  fieldsConsistent: boolean; // format/network/scheme and the human-readable fields agree with the terms
  expectedId: string;
}

/**
 * Recompute everything from the terms only. With `trusted` (the pinned deployed hash) the id and raw state init are derived
 * from THAT hash, so a doc built on another contract fails. Never throws: a malformed doc is all-false.
 */
export function checkDoc(d: InvoiceDoc, trusted?: string): DocChecks {
  const codeHashTrusted = trusted === undefined || d.code_hash === trusted;
  try {
    if (typeof d.scheme !== 'string' || (d.scheme !== '0u' && d.scheme !== '0s')) throw new Error('bad scheme');
    const t: InvoiceTerms = { invoice_id: d.invoice_id, merchant: d.merchant, tax_vault: d.tax_vault, tax_bps: d.tax_bps,
      amount: parseDec('amount_yocto', d.amount_yocto), expires_at_ms: parseDec('expires_at_ms', d.expires_at_ms), salt: parseDec('salt', d.salt) };
    const { raw, accountId } = invoiceStateInit(d.scheme, { codeHash: base58.decode(trusted ?? d.code_hash) }, t);
    const fieldsConsistent = d.format === 'zeroinit-invoice/1' && d.network === 'testnet'
      && d.amount_near === formatNear(t.amount)
      && d.expires_at_iso === new Date(Number(t.expires_at_ms)).toISOString()
      && d.state_hex === toHex(invoiceStateBytes(t));
    return { idFromTerms: accountId === d.account_id, rawFromTerms: toHex(raw) === d.raw_state_init_hex, codeHashTrusted, fieldsConsistent, expectedId: accountId };
  } catch (e) {
    return { idFromTerms: false, rawFromTerms: false, codeHashTrusted, fieldsConsistent: false, expectedId: `(invalid invoice: ${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Refuse to sign anything for a doc that is not exactly the invoice its terms + the pinned code hash derive. */
export function assertDocTrusted(d: InvoiceDoc, trusted: string): void {
  const c = checkDoc(d, trusted);
  const bad = [!c.codeHashTrusted && `code_hash ${d.code_hash} is not the trusted hash ${trusted}${deploymentOf(d.code_hash)?.historical ? ` (it is the ${deploymentOf(d.code_hash)!.version} deployment: history, verify only; issue and pay on the trusted hash)` : ''}`, !c.idFromTerms && `account_id does not match the terms (expected ${c.expectedId})`,
    !c.rawFromTerms && 'raw_state_init_hex does not match the terms', !c.fieldsConsistent && 'display fields (amount_near/expires_at_iso/state_hex/format/network) do not match the terms'].filter(Boolean);
  if (bad.length) throw new Error(`refusing invoice ${d.invoice_id}: ${bad.join('; ')}`);
}

/** The state-init raw bytes to send: always re-derived from the terms and the pinned code hash, never the file's raw hex. */
export function rawFromTerms(d: InvoiceDoc, trusted: string): Uint8Array {
  return invoiceStateInit(d.scheme, { codeHash: base58.decode(trusted) }, termsFromDoc(d)).raw;
}

/** The state-init action for the doc, built from the terms (see rawFromTerms). Call assertDocTrusted first. */
export function stateInitAction(d: InvoiceDoc, trusted: string): Uint8Array {
  const raw = rawFromTerms(d, trusted);
  return d.scheme === '0u' ? actUniversalStateInit(raw, 0n) : actDeterministicStateInit(raw, 0n);
}

/** Every term field of the on-chain get_invoice() view equals the doc's. */
export function termsMatchOnchain(d: InvoiceDoc, inv: any): boolean {
  return inv.invoice_id === d.invoice_id && inv.merchant === d.merchant && inv.tax_vault === d.tax_vault && inv.tax_bps === d.tax_bps
    && inv.amount === d.amount_yocto && inv.expires_at_ms === d.expires_at_ms && inv.salt === d.salt;
}

const TESTNET_ID = /^(?:.+\.testnet|[0-9a-f]{64}|0[us][0-9a-z]+)$/;
/**
 * Issuance guard: merchant and tax_vault must be testnet accounts that exist (implicit 64-hex accounts need no account until funded),
 * otherwise the split transfer fails after the invoice is PAID and the funds are stranded under immutable terms.
 */
export async function assertAccountsUsable(cfg: Config, t: { merchant: string; tax_vault: string }): Promise<void> {
  for (const [name, id] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (!TESTNET_ID.test(id)) throw new Error(`${name} "${id}" is not a testnet account (.testnet, 64-hex implicit or 0u/0s)`);
  }
  await checkNetwork(cfg);
  for (const [name, id] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (/^[0-9a-f]{64}$/.test(id)) continue;
    if ((await viewAccount(cfg, id, `issue: view_account ${name}`)).kind === 'NONEXISTENT') throw new Error(`${name} "${id}" does not exist on testnet (typo?); pass --offline to skip this check`);
  }
}

export function saveDoc(dir: string, d: InvoiceDoc): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${d.invoice_id}.json`);
  if (existsSync(p)) throw new Error(`${p} already exists (invoice ids must be unique)`);
  writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  return p;
}
export function loadDoc(dir: string, id: string): InvoiceDoc {
  for (const p of [join(dir, `${id}.json`), join(dir, 'examples', `${id}.json`), join(dir, 'v2', `${id}.json`), join(dir, 'v1', `${id}.json`), join(dir, 'demo', `${id}.json`)]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`invoice ${id} not found in ${dir}/, ${dir}/examples/, ${dir}/v2/, ${dir}/v1/ or ${dir}/demo/`);
}
export function listDocs(dir: string): InvoiceDoc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.receipt.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
