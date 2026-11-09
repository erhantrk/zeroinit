// Hand-rolled NEAR Transaction (V0) encoder + ed25519 signing. near-api-js 7.4.0 cannot encode
// UniversalStateInit / DeterministicStateInit (its schema has a placeholder), so we encode ourselves.
// Byte-for-byte parity with near-api-js for Transfer/FunctionCall is asserted in test/vectors.test.ts.
import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { concat, u8, u32, u64, u128, str, bytesVec } from './bytes.ts';

// Action enum discriminants (nearcore core/primitives/src/action/mod.rs @ 2.14.0-rc.5)
export const ACTION = { FunctionCall: 2, Transfer: 3, DeterministicStateInit: 11, UniversalStateInit: 15 } as const;

export const actTransfer = (deposit: bigint) => concat(u8(ACTION.Transfer), u128(deposit));
export const actFunctionCall = (method: string, args: Uint8Array, gas: bigint, deposit: bigint) =>
  concat(u8(ACTION.FunctionCall), str(method), bytesVec(args), u64(gas), u128(deposit));
/** UniversalStateInitAction { state_init: RawStateInit(Vec<u8>), deposit: u128 } */
export const actUniversalStateInit = (raw: Uint8Array, deposit: bigint) =>
  concat(u8(ACTION.UniversalStateInit), bytesVec(raw), u128(deposit));
/** DeterministicStateInitAction { state_init: DeterministicAccountStateInit (inline borsh), deposit } */
export const actDeterministicStateInit = (stateInitBorsh: Uint8Array, deposit: bigint) =>
  concat(u8(ACTION.DeterministicStateInit), stateInitBorsh, u128(deposit));

export interface KeyPair { seed: Uint8Array; publicKey: Uint8Array; publicKeyStr: string }
/** secret = "ed25519:<base58 of 64 bytes: seed(32) || pubkey(32)>" (near-cli / near-api-js format) */
export function keyPairFromSecret(secret: string): KeyPair {
  if (!secret.startsWith('ed25519:')) throw new Error('only ed25519 keys supported');
  const raw = base58.decode(secret.slice(8));
  if (raw.length !== 64 && raw.length !== 32) throw new Error('ed25519 secret must decode to 64 (or 32) bytes');
  const seed = raw.slice(0, 32);
  const publicKey = ed25519.getPublicKey(seed);
  if (raw.length === 64 && base58.encode(raw.slice(32)) !== base58.encode(publicKey)) throw new Error('secret/public mismatch');
  return { seed, publicKey, publicKeyStr: 'ed25519:' + base58.encode(publicKey) };
}

export interface TxParams { signerId: string; publicKey: Uint8Array; nonce: bigint; receiverId: string; blockHash: Uint8Array; actions: Uint8Array[] }
export function encodeTransactionV0(p: TxParams): Uint8Array {
  if (p.publicKey.length !== 32 || p.blockHash.length !== 32) throw new Error('bad key/blockhash length');
  return concat(str(p.signerId), u8(0), p.publicKey, u64(p.nonce), str(p.receiverId), p.blockHash, u32(p.actions.length), ...p.actions);
}
export function signTransaction(p: TxParams, kp: KeyPair): { signedTxBase64: string; txHash: string; txBytes: Uint8Array } {
  const txBytes = encodeTransactionV0(p);
  const hash = sha256(txBytes);
  const sig = ed25519.sign(hash, kp.seed);
  const signed = concat(txBytes, u8(0), sig);           // Signature::ED25519 = 0
  return { signedTxBase64: base64.encode(signed), txHash: base58.encode(hash), txBytes };
}
