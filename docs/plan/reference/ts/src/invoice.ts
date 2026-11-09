// Invoice document create / load / check (INTERFACES.md §6.1).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { base58 } from '@scure/base';
import { toHex, fromHex, formatNear } from './bytes.ts';
import { invoiceStateBytes, invoiceStateInit, type InvoiceTerms, type CodeRef, type Scheme } from './stateinit.ts';

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
export const rawFromDoc = (d: InvoiceDoc): Uint8Array => fromHex(d.raw_state_init_hex);

/** Recompute everything from the terms only. */
export function checkDoc(d: InvoiceDoc): { idFromTerms: boolean; rawFromTerms: boolean; expectedId: string } {
  const { raw, accountId } = invoiceStateInit(d.scheme, { codeHash: base58.decode(d.code_hash) }, termsFromDoc(d));
  return { idFromTerms: accountId === d.account_id, rawFromTerms: toHex(raw) === d.raw_state_init_hex, expectedId: accountId };
}

export function saveDoc(dir: string, d: InvoiceDoc): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${d.invoice_id}.json`);
  if (existsSync(p)) throw new Error(`${p} already exists (invoice ids must be unique)`);
  writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  return p;
}
export function loadDoc(dir: string, id: string): InvoiceDoc {
  for (const p of [join(dir, `${id}.json`), join(dir, 'examples', `${id}.json`), join(dir, 'demo', `${id}.json`)]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`invoice ${id} not found in ${dir}/, ${dir}/examples/ or ${dir}/demo/`);
}
export function listDocs(dir: string): InvoiceDoc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.receipt.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
