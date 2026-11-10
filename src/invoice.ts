// Invoice document create / load / check (INTERFACES.md §6.1; docs/STABLECOIN.md §9-10 for /2).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { base58 } from '@scure/base';
import { toHex, formatNear } from './bytes.ts';
import { invoiceStateBytes, invoiceStateInit, isValidNearAccountId, type InvoiceTerms, type CodeRef, type Scheme, type StateLayout } from './stateinit.ts';
import { actUniversalStateInit, actDeterministicStateInit } from './tx.ts';
import { deploymentOf, tokenBySymbol, type Config, type AllowedToken } from './config.ts';
import { checkNetwork, viewAccount } from './rpc.ts';
import { ftMetadata, storageBalanceOf, formatUnits } from './ft.ts';

export { isValidNearAccountId };

/** `/1` is the v1/v2 document (NEAR only, state layout 1). New v3 invoices use `/2`. */
export interface InvoiceDocV1 {
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

export type InvoiceAsset = { kind: 'near' } | { kind: 'ft'; contract: string; symbol: string; decimals: number };

/** `/2` is the v3 document: one asset (NEAR or one NEP-141 token), raw amount + display amount, grace. */
export interface InvoiceDocV3 {
  format: 'zeroinit-invoice/2';
  network: 'testnet';
  scheme: Scheme;
  code_hash: string;
  invoice_id: string;
  merchant: string;
  tax_vault: string;
  tax_bps: number;
  asset: InvoiceAsset;
  amount_raw: string;
  amount_display: string;
  expires_at_ms: string;
  expires_at_iso: string;
  salt: string;
  payout_grace_ms: string;
  state_hex: string;
  raw_state_init_hex: string;
  account_id: string;
  created_at_iso: string;
}

export type InvoiceDoc = InvoiceDocV1 | InvoiceDocV3;

export const isV3Doc = (d: InvoiceDoc): d is InvoiceDocV3 => d.format === 'zeroinit-invoice/2';
export const docAmountRaw = (d: InvoiceDoc): bigint => BigInt(isV3Doc(d) ? d.amount_raw : d.amount_yocto);
export const docAmountDisplay = (d: InvoiceDoc): string => (isV3Doc(d) ? d.amount_display : d.amount_near);
export const docToken = (d: InvoiceDoc): string | null => (isV3Doc(d) && d.asset.kind === 'ft' ? d.asset.contract : null);
export const docTokenSymbol = (d: InvoiceDoc): string | null => (isV3Doc(d) && d.asset.kind === 'ft' ? d.asset.symbol : null);
export const docDecimals = (d: InvoiceDoc): number => (isV3Doc(d) ? (d.asset.kind === 'ft' ? d.asset.decimals : 24) : 24);
export const docGraceMs = (d: InvoiceDoc): bigint => (isV3Doc(d) ? BigInt(d.payout_grace_ms) : 0n);
/** Unit shown after an amount: "NEAR" or the token symbol. */
export const docUnit = (d: InvoiceDoc): string => (isV3Doc(d) && d.asset.kind === 'ft' ? d.asset.symbol : 'NEAR');
export const docLayout = (d: InvoiceDoc): StateLayout => (isV3Doc(d) ? 3 : 1);

export const GRACE_MIN_MS = 60_000n;
export const GRACE_MAX_MS = 31_536_000_000n;
export const GRACE_DEFAULT_MS = 604_800_000n;

export function randomSalt(): bigint {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return new DataView(b.buffer).getBigUint64(0, true);
}

export function createInvoiceDoc(scheme: Scheme, codeHashB58: string, t: InvoiceTerms, now = new Date()): InvoiceDoc {
  // A bad id would make the contract STATE undeserializable: funds sent there would be locked forever.
  for (const [name, value] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (!isValidNearAccountId(value)) throw new Error(`${name} "${value}" is not a valid NEAR account id (2-64 chars, lowercase a-z 0-9 - _ and dots)`);
  }
  const dep = deploymentOf(codeHashB58);
  const layout: StateLayout = t.layout ?? (dep?.layout ?? 1);
  if (dep && dep.layout !== 3 && layout === 3) throw new Error(`the ${dep.version} deployment uses the old state layout: issue a /1 document`);
  if (dep?.layout === 3 && layout !== 3) throw new Error(`the ${dep.version} deployment needs the v3 state layout (layout 3)`);
  if (t.token != null && scheme !== '0u') throw new Error('tokens are only issued for 0u invoices (0s is untested for tokens)');
  if (layout === 3 && t.token != null && (t.token_symbol === undefined || t.token_decimals === undefined)) {
    throw new Error('a token document needs the token symbol and decimals (from the allow-list)');
  }
  const terms: InvoiceTerms = { ...t, layout, grace_ms: layout === 3 ? (t.grace_ms ?? GRACE_DEFAULT_MS) : undefined };
  const code: CodeRef = { codeHash: base58.decode(codeHashB58) };
  const { raw, accountId } = invoiceStateInit(scheme, code, terms);
  const common = {
    network: 'testnet' as const, scheme, code_hash: codeHashB58,
    invoice_id: terms.invoice_id, merchant: terms.merchant, tax_vault: terms.tax_vault, tax_bps: terms.tax_bps,
    expires_at_ms: terms.expires_at_ms.toString(), expires_at_iso: new Date(Number(terms.expires_at_ms)).toISOString(),
    salt: terms.salt.toString(), state_hex: toHex(invoiceStateBytes(terms)), raw_state_init_hex: toHex(raw),
    account_id: accountId, created_at_iso: now.toISOString(),
  };
  if (layout === 1) {
    return { format: 'zeroinit-invoice/1', ...common, amount_yocto: terms.amount.toString(), amount_near: formatNear(terms.amount) };
  }
  const asset: InvoiceAsset = terms.token == null
    ? { kind: 'near' }
    : { kind: 'ft', contract: terms.token, symbol: terms.token_symbol!, decimals: terms.token_decimals! };
  return {
    format: 'zeroinit-invoice/2', ...common, asset,
    amount_raw: terms.amount.toString(),
    amount_display: asset.kind === 'near' ? formatNear(terms.amount) : formatUnits(terms.amount, asset.decimals),
    payout_grace_ms: (terms.grace_ms ?? GRACE_DEFAULT_MS).toString(),
  };
}

export function termsFromDoc(d: InvoiceDoc): InvoiceTerms {
  const common = { invoice_id: d.invoice_id, merchant: d.merchant, tax_vault: d.tax_vault, tax_bps: d.tax_bps,
    amount: docAmountRaw(d), expires_at_ms: BigInt(d.expires_at_ms), salt: BigInt(d.salt) };
  if (!isV3Doc(d)) return { ...common, layout: 1 };
  return { ...common, layout: 3, grace_ms: BigInt(d.payout_grace_ms),
    token: d.asset.kind === 'ft' ? d.asset.contract : null,
    token_symbol: d.asset.kind === 'ft' ? d.asset.symbol : undefined,
    token_decimals: d.asset.kind === 'ft' ? d.asset.decimals : undefined };
}

const DEC = /^(0|[1-9]\d*)$/;
/** Strict canonical decimal -> bigint (BigInt() alone accepts " 1", "0x10", ""). */
function parseDec(name: string, v: unknown): bigint {
  if (typeof v !== 'string' || !DEC.test(v)) throw new Error(`${name} must be a canonical decimal string`);
  return BigInt(v);
}
const U128_OVER_10000 = ((1n << 128n) - 1n) / 10_000n;

export interface DocChecks {
  idFromTerms: boolean;      // account id re-derived from the terms (with the trusted code hash when given)
  rawFromTerms: boolean;     // raw state init re-derived from the terms
  codeHashTrusted: boolean;  // doc.code_hash equals the trusted (pinned) hash
  formatMatchesDeployment: boolean; // /1 for a v1/v2 deployment, /2 for v3
  fieldsConsistent: boolean; // format/network/scheme and the human-readable fields agree with the terms
  expectedId: string;
}

/**
 * Recompute everything from the terms only. With `trusted` (the pinned deployed hash) the id and raw state init are derived
 * from THAT hash, so a doc built on another contract fails. `allowed` (when given) pins a token document to the allow-list.
 * Never throws: a malformed doc is all-false.
 */
export function checkDoc(d: InvoiceDoc, trusted?: string, allowed?: readonly AllowedToken[] | null): DocChecks {
  const codeHashTrusted = trusted === undefined || d.code_hash === trusted;
  const codeHash = trusted ?? d.code_hash;
  const dep = deploymentOf(codeHash);
  const expectedFormat = dep ? (dep.layout === 3 ? 'zeroinit-invoice/2' : 'zeroinit-invoice/1') : d.format;
  const formatMatchesDeployment = d.format === expectedFormat;
  try {
    if (typeof d.scheme !== 'string' || (d.scheme !== '0u' && d.scheme !== '0s')) throw new Error('bad scheme');
    const t = termsFromDoc(d);
    if (!formatMatchesDeployment) throw new Error(`a ${d.format} document does not belong to the ${dep?.version ?? 'unknown'} deployment`);
    const { raw, accountId } = invoiceStateInit(d.scheme, { codeHash: base58.decode(codeHash) }, t);
    let fieldsConsistent = d.network === 'testnet'
      && d.expires_at_iso === new Date(Number(t.expires_at_ms)).toISOString()
      && d.state_hex === toHex(invoiceStateBytes(t));
    if (!isV3Doc(d)) {
      fieldsConsistent = fieldsConsistent && d.format === 'zeroinit-invoice/1' && d.amount_near === formatNear(t.amount);
    } else {
      if (d.format !== 'zeroinit-invoice/2') throw new Error('bad format');
      const raw = parseDec('amount_raw', d.amount_raw);
      if (raw <= 0n || raw > U128_OVER_10000) throw new Error('amount_raw out of range');
      const grace = parseDec('payout_grace_ms', d.payout_grace_ms);
      if (grace < GRACE_MIN_MS || grace > GRACE_MAX_MS) throw new Error('payout_grace_ms out of range');
      if (d.asset === null || typeof d.asset !== 'object') throw new Error('missing asset');
      if (d.asset.kind === 'near') {
        if (t.token != null) throw new Error('near asset with a token');
        fieldsConsistent = fieldsConsistent && d.amount_display === formatNear(raw);
      } else if (d.asset.kind === 'ft') {
        const asset = d.asset;
        if (d.scheme !== '0u') throw new Error('a token document must be 0u');
        if (!isValidNearAccountId(asset.contract)) throw new Error('bad token contract');
        if (typeof asset.symbol !== 'string' || asset.symbol === '') throw new Error('bad token symbol');
        if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 38) throw new Error('bad token decimals');
        if (allowed !== undefined && allowed !== null) {
          const entry = tokenBySymbol(allowed, asset.symbol);
          if (!entry || entry.accountId !== asset.contract || entry.decimals !== asset.decimals) {
            throw new Error('token is not on the allow-list');
          }
        }
        fieldsConsistent = fieldsConsistent && d.amount_display === formatUnits(raw, asset.decimals);
      } else throw new Error('bad asset kind');
      fieldsConsistent = fieldsConsistent && d.amount_raw === t.amount.toString();
    }
    return { idFromTerms: accountId === d.account_id, rawFromTerms: toHex(raw) === d.raw_state_init_hex, codeHashTrusted, formatMatchesDeployment, fieldsConsistent, expectedId: accountId };
  } catch (e) {
    return { idFromTerms: false, rawFromTerms: false, codeHashTrusted, formatMatchesDeployment, fieldsConsistent: false,
      expectedId: `(invalid invoice: ${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Refuse to sign anything for a doc that is not exactly the invoice its terms + the pinned code hash derive. */
export function assertDocTrusted(d: InvoiceDoc, trusted: string, allowed?: readonly AllowedToken[] | null): void {
  const c = checkDoc(d, trusted, allowed);
  const dep = deploymentOf(d.code_hash);
  const bad = [!c.codeHashTrusted && `code_hash ${d.code_hash} is not the trusted hash ${trusted}${dep?.historical ? ` (it is the ${dep.version} deployment: history, verify and replay only; issue and pay on the trusted hash)` : ''}`,
    !c.formatMatchesDeployment && `the document format ${d.format} does not match the ${deploymentOf(trusted)?.version ?? 'pinned'} deployment`,
    !c.idFromTerms && `account_id does not match the terms (expected ${c.expectedId})`,
    !c.rawFromTerms && 'raw_state_init_hex does not match the terms',
    !c.fieldsConsistent && `display fields (${isV3Doc(d) ? 'asset/amount_raw/amount_display/payout_grace_ms' : 'amount_near'}/expires_at_iso/state_hex/format/network) do not match the terms`].filter(Boolean);
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

/** Every term field of the on-chain get_invoice() view equals the doc's. v3 also compares the token and the grace. */
export function termsMatchOnchain(d: InvoiceDoc, inv: any): boolean {
  const common = inv.invoice_id === d.invoice_id && inv.merchant === d.merchant && inv.tax_vault === d.tax_vault && inv.tax_bps === d.tax_bps
    && inv.amount === docAmountRaw(d).toString() && inv.expires_at_ms === d.expires_at_ms && inv.salt === d.salt;
  if (!common) return false;
  if (!isV3Doc(d)) return true;
  return inv.v === 3 && (inv.token ?? null) === docToken(d) && inv.grace_ms === d.payout_grace_ms;
}

const TESTNET_ID = /^(?:.+\.testnet|[0-9a-f]{64}|0[us][0-9a-z]+)$/;
/**
 * Issuance guard: merchant and tax_vault must be testnet accounts that exist (implicit 64-hex accounts need no account until funded),
 * otherwise the split transfer fails after the invoice is PAID and the funds are stranded under immutable terms.
 * For a token invoice both must also be registered on the token (NEP-145), and the token metadata must match the allow-list.
 */
export async function assertAccountsUsable(cfg: Config, t: { merchant: string; tax_vault: string; token?: string | null; token_symbol?: string; token_decimals?: number }): Promise<void> {
  for (const [name, id] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (!TESTNET_ID.test(id)) throw new Error(`${name} "${id}" is not a testnet account (.testnet, 64-hex implicit or 0u/0s)`);
  }
  await checkNetwork(cfg);
  for (const [name, id] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (/^[0-9a-f]{64}$/.test(id)) continue;
    if ((await viewAccount(cfg, id, `issue: view_account ${name}`)).kind === 'NONEXISTENT') throw new Error(`${name} "${id}" does not exist on testnet (typo?); pass --offline to skip this check`);
  }
  if (t.token) {
    const meta = await ftMetadata(cfg, t.token);
    if (t.token_symbol !== undefined && meta.symbol !== t.token_symbol) throw new Error(`token ${t.token} reports symbol "${meta.symbol}", the allow-list says "${t.token_symbol}"`);
    if (t.token_decimals !== undefined && meta.decimals !== t.token_decimals) throw new Error(`token ${t.token} reports ${meta.decimals} decimals, the allow-list says ${t.token_decimals}`);
    for (const [name, id] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
      if ((await storageBalanceOf(cfg, t.token, id)) === null) {
        throw new Error(`${name} "${id}" is not registered on token ${t.token}: run \`zi token register ${id}\` (or ask them to register), then issue again`);
      }
    }
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
  for (const p of [join(dir, `${id}.json`), join(dir, 'examples', `${id}.json`), join(dir, 'v31', `${id}.json`), join(dir, 'v3', `${id}.json`), join(dir, 'v2', `${id}.json`), join(dir, 'v1', `${id}.json`), join(dir, 'demo', `${id}.json`)]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`invoice ${id} not found in ${dir}/, ${dir}/examples/, ${dir}/v31/, ${dir}/v3/, ${dir}/v2/, ${dir}/v1/ or ${dir}/demo/`);
}
export function listDocs(dir: string): InvoiceDoc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.receipt.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
