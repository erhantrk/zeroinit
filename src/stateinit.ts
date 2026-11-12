// Invoice STATE borsh, UniversalStateInit (0u) and DeterministicStateInit (0s) bytes, and id derivation.
// Spec: SPEC.md §2 and §3 (layout 1 = v1/v2) and docs/STABLECOIN.md §3 (layout 3 = v3).
// Verified against nearcore 2.14.0-rc.5 vectors (see test/vectors.test.ts).
import { sha3_256, keccak_256 } from '@noble/hashes/sha3.js';
import { concat, u8, u16, u32, u64, u128, str, bytesVec, utf8, cmpBytes, toHex } from './bytes.ts';

export type CodeRef = { codeHash: Uint8Array } | { accountId: string };

/** 1 = the v1/v2 borsh layout (135 bytes, NEAR only); 3 = the v3 layout (201 NEAR / 226 token bytes). */
export type StateLayout = 1 | 3;

export interface InvoiceTerms {
  invoice_id: string;      // ^[A-Za-z0-9_-]{1,32}$
  merchant: string;        // existing NEAR account
  tax_vault: string;       // existing NEAR account
  tax_bps: number;         // 0..10000
  amount: bigint;          // yoctoNEAR or token base units, > 0
  expires_at_ms: bigint;   // unix ms
  salt: bigint;            // u64
  layout?: StateLayout;    // default 1 (v1/v2)
  grace_ms?: bigint;       // layout 3 only: refund grace after max(expiry, paid_at)
  token?: string | null;   // layout 3 only: NEP-141 contract, null = NEAR
  token_symbol?: string;   // doc display only, not part of the state
  token_decimals?: number; // doc display only, not part of the state
}

export const STATE_KEY = utf8('STATE');

const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A NEAR account id: 2-64 chars, lowercase alphanumerics with single - or _ separators, dot-separated parts. */
export function isValidNearAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && NEAR_ACCOUNT_ID.test(id);
}
const U64_MAX = (1n << 64n) - 1n;

function validateTerms(t: InvoiceTerms, layout: StateLayout): void {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(t.invoice_id)) throw new Error('invoice_id must match ^[A-Za-z0-9_-]{1,32}$');
  if (!Number.isInteger(t.tax_bps) || t.tax_bps < 0 || t.tax_bps > 10000) throw new Error('tax_bps 0..10000');
  if (t.amount <= 0n) throw new Error('amount must be > 0');
  // near-account-id rejects bad ids when the contract loads STATE: every pay/sweep would panic and plain-transferred funds would be stuck.
  for (const [name, value] of [['merchant', t.merchant], ['tax_vault', t.tax_vault]] as const) {
    if (!isValidNearAccountId(value)) throw new Error(`${name} "${value}" is not a valid NEAR account id (2-64 chars, lowercase a-z 0-9 - _ and dots)`);
  }
  // u64 fields wrap silently on chain (an expiry before 1970 would never expire): reject out-of-range values.
  if (t.expires_at_ms < 0n || t.expires_at_ms > U64_MAX) throw new Error(`expires_at_ms out of u64 range: ${t.expires_at_ms}`);
  if (t.salt < 0n || t.salt > U64_MAX) throw new Error(`salt out of u64 range: ${t.salt}`);
  if (layout === 3) {
    if (t.grace_ms === undefined) throw new Error('layout 3 needs grace_ms');
    if (t.grace_ms < 0n || t.grace_ms > U64_MAX) throw new Error(`grace_ms out of u64 range: ${t.grace_ms}`);
    if (t.token != null && !isValidNearAccountId(t.token)) throw new Error(`token "${t.token}" is not a valid NEAR account id`);
  } else {
    if (t.token != null) throw new Error('a token invoice needs the v3 layout');
    if (t.grace_ms !== undefined) throw new Error('grace_ms needs the v3 layout');
  }
}

/** Exact borsh of the contract's `Invoice` struct in its initial (OPEN, unpaid) state. */
export function invoiceStateBytes(t: InvoiceTerms): Uint8Array {
  const layout = t.layout ?? 1;
  validateTerms(t, layout);
  if (layout === 1) {
    return concat(
      u8(1),                    // v
      str(t.invoice_id),
      str(t.merchant),
      str(t.tax_vault),
      u16(t.tax_bps),
      u128(t.amount),
      u64(t.expires_at_ms),
      u64(t.salt),
      u8(0),                    // status OPEN
      u8(0),                    // paid_by: None
      u64(0n),                  // paid_at_ms
      u128(0n),                 // paid_amount
      u128(0n),                 // tax_amount
    );
  }
  return concat(
    u8(3),                      // v
    str(t.invoice_id),
    str(t.merchant),
    str(t.tax_vault),
    u16(t.tax_bps),
    u128(t.amount),
    u64(t.expires_at_ms),
    u64(t.salt),
    u64(t.grace_ms!),
    t.token == null ? u8(0) : concat(u8(1), str(t.token)),   // token: Option<AccountId>
    u8(0),                      // status OPEN
    u8(0),                      // paid_by: None
    u64(0n),                    // paid_at_ms
    u128(0n),                   // paid_amount
    u128(0n),                   // tax_amount
    u128(0n),                   // owed_merchant
    u128(0n),                   // owed_tax
    u128(0n),                   // owed_payer
    u8(0),                      // refund_to: None
    u64(0n),                    // busy_until_ms
  );
}

function globalContractIdentifier(code: CodeRef): Uint8Array {
  if ('codeHash' in code) {
    if (code.codeHash.length !== 32) throw new Error('codeHash must be 32 bytes');
    return concat(u8(0), code.codeHash);          // GlobalContractIdentifier::CodeHash = 0
  }
  return concat(u8(1), str(code.accountId));      // GlobalContractIdentifier::AccountId = 1
}

function dataMap(entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  const sorted = [...entries].sort((a, b) => cmpBytes(a[0], b[0]));
  for (let i = 1; i < sorted.length; i++) if (cmpBytes(sorted[i - 1][0], sorted[i][0]) === 0) throw new Error('duplicate key');
  return concat(u32(sorted.length), ...sorted.map(([k, v]) => concat(bytesVec(k), bytesVec(v))));
}

/** Canonical borsh of UniversalStateInit::V1 { code: Some(code), data, access_keys: {} } */
export function universalStateInitBytes(code: CodeRef | null, entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  return concat(
    u8(0),                                         // UniversalStateInit::V1
    code ? concat(u8(1), globalContractIdentifier(code)) : u8(0), // Option<GlobalContractIdentifier>
    dataMap(entries),                              // BTreeMap<Vec<u8>,Vec<u8>>
    u32(0),                                        // access_keys: BTreeSet<PublicKeyHandle> = empty
  );
}

/** borsh of DeterministicAccountStateInit::V1 { code, data } (NEP-616, fallback scheme) */
export function deterministicStateInitBytes(code: CodeRef, entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  return concat(u8(0), globalContractIdentifier(code), dataMap(entries));
}

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
export function encodeUniversalAccountId(hash: Uint8Array): string {
  if (hash.length !== 32) throw new Error('hash must be 32 bytes');
  let acc = 0, nbits = 0, s = '0u';
  for (const byte of hash) {
    acc = (acc << 8) | byte; nbits += 8;
    while (nbits >= 5) { nbits -= 5; s += CROCKFORD[(acc >> nbits) & 31]; }
    acc &= (1 << nbits) - 1;
  }
  s += CROCKFORD[(acc << (5 - nbits)) & 31];      // 1 leftover bit, padded with 4 zero bits
  if (s.length !== 54) throw new Error('internal: uaid length');
  return s;
}
export const deriveUniversalAccountId = (raw: Uint8Array): string => encodeUniversalAccountId(sha3_256(raw));
export const deriveDeterministicAccountId = (raw: Uint8Array): string => '0s' + toHex(keccak_256(raw).slice(12));

export type Scheme = '0u' | '0s';
export function invoiceStateInit(scheme: Scheme, code: CodeRef, t: InvoiceTerms): { raw: Uint8Array; accountId: string } {
  const entries: Array<[Uint8Array, Uint8Array]> = [[STATE_KEY, invoiceStateBytes(t)]];
  if (scheme === '0u') { const raw = universalStateInitBytes(code, entries); return { raw, accountId: deriveUniversalAccountId(raw) }; }
  const raw = deterministicStateInitBytes(code, entries); return { raw, accountId: deriveDeterministicAccountId(raw) };
}
