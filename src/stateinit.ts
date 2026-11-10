// Invoice STATE borsh, UniversalStateInit (0u) and DeterministicStateInit (0s) bytes, and id derivation.
// Spec: INTERFACES.md §2 and §3. Verified against nearcore 2.14.0-rc.5 vectors (see test/vectors.test.ts).
import { sha3_256, keccak_256 } from '@noble/hashes/sha3.js';
import { concat, u8, u16, u32, u64, u128, str, bytesVec, utf8, cmpBytes, toHex } from './bytes.ts';

export type CodeRef = { codeHash: Uint8Array } | { accountId: string };

export interface InvoiceTerms {
  invoice_id: string;      // ^[A-Za-z0-9_-]{1,32}$
  merchant: string;        // existing NEAR account
  tax_vault: string;       // existing NEAR account
  tax_bps: number;         // 0..10000
  amount: bigint;          // yoctoNEAR, > 0
  expires_at_ms: bigint;   // unix ms
  salt: bigint;            // u64
}

export const STATE_KEY = utf8('STATE');

const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A NEAR account id: 2-64 chars, lowercase alphanumerics with single - or _ separators, dot-separated parts. */
export function isValidNearAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && NEAR_ACCOUNT_ID.test(id);
}
const U64_MAX = (1n << 64n) - 1n;

/** Exact borsh of the contract's `Invoice` struct in its initial (OPEN, unpaid) state. 135 bytes for the example. */
export function invoiceStateBytes(t: InvoiceTerms): Uint8Array {
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
