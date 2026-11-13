// A short check code for an invoice address. A `0u…` id has no checksum of its own (the format belongs to NEAR): a mistyped address is
// a valid address of other bytes, and funds sent there are lost. The issuer shows this code next to the address; a payer who types or
// pastes the address into a wallet can first run `zi check <address> <code>`. 4 characters = 20 bits: a changed address passes by chance
// about once in a million.
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8 } from './bytes.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
export const CHECK_CODE_LENGTH = 4;

export function checkCode(accountId: string): string {
  const h = sha256(utf8(`zeroinit-check-code/1:${accountId}`));
  const bits = (h[0] << 16) | (h[1] << 8) | h[2]; // 24 bits, use the top 20
  let out = '';
  for (let i = 0; i < CHECK_CODE_LENGTH; i++) out += ALPHABET[(bits >>> (19 - 5 * i)) & 31];
  return out;
}

/** Normalizes what a person typed (case, spaces, the look-alike letters Crockford maps). */
export function normalizeCheckCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export function checkCodeMatches(accountId: string, code: string): boolean {
  return normalizeCheckCode(code) === checkCode(accountId.trim());
}
