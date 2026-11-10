// Loads ZI_* env vars. Testnet-only guard (PLAN.md §14 rule 1).
import { base58 } from '@scure/base';

/** The invoice-contract deployments this client knows. Both are global contracts on testnet, identified by the sha256 (base58) of the wasm. */
export interface Deployment {
  version: 'v1' | 'v2';
  hash: string;
  label: string;
  /** Contract-level audit findings this deployment fixes (see README "v1 → v2"). */
  fixes: readonly string[];
  /** true: only for verifying/replaying recorded history; never used to issue or sign. */
  historical: boolean;
}
export const V1_CODE_HASH = 'Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k';
export const V2_CODE_HASH = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';
export const KNOWN_DEPLOYMENTS: readonly Deployment[] = [
  { version: 'v2', hash: V2_CODE_HASH, label: 'v2 (current: fixes contract-1/2/3)', fixes: ['contract-1', 'contract-2', 'contract-3'], historical: false },
  { version: 'v1', hash: V1_CODE_HASH, label: 'v1 (history, frozen: known limitations contract-1/2/3; verify only, never pay)', fixes: [], historical: true },
];
/** The known deployment with this code hash, or null (an own deployment pinned through ZI_CODE_HASH, or a foreign contract). */
export const deploymentOf = (hash: string): Deployment | null => KNOWN_DEPLOYMENTS.find((d) => d.hash === hash) ?? null;
/** Human label of a code hash: the known deployment's label, else "custom". */
export const deploymentLabel = (hash: string): string => deploymentOf(hash)?.label ?? 'custom (not a known ZeroInit deployment)';

/** The current ZeroInit invoice contract (v2), deployed on testnet as a global contract by code hash (sha256 of the committed wasm). */
export const DEPLOYED_CODE_HASH = V2_CODE_HASH;
/** The code hash a payer trusts: ZI_CODE_HASH when set (own deployment), else the current deployed hash (v2). Never the invoice file's own value. */
export const trustedCodeHash = (cfg: { codeHashB58: string | null }): string => cfg.codeHashB58 ?? DEPLOYED_CODE_HASH;
/**
 * The hash to verify a document against: the trusted hash, or (read-only checks only) the hash of a historical known deployment
 * the document was issued under. A foreign/unknown hash is never accepted: it resolves to the trusted hash, so the check FAILs.
 */
export function pinForVerification(trusted: string, docCodeHash: string): string {
  const d = deploymentOf(docCodeHash);
  return docCodeHash !== trusted && d?.historical ? d.hash : trusted;
}
/** Does the deployment behind `hash` fix contract-3 (pay() settles funds parked by a plain transfer)? Unknown hashes: no (stay conservative). */
export const fixesParkedFunds = (hash: string): boolean => deploymentOf(hash)?.fixes.includes('contract-3') ?? false;

export interface Signer { accountId: string; secret: string }
export interface Config {
  network: 'testnet';
  rpcUrl: string;
  scheme: '0u' | '0s';
  codeHashB58: string | null;
  invoiceDir: string;
  record: string | null;
  payer: Signer | null;
  sweeper: Signer | null;
}

type Env = Record<string, string | undefined>;

function signer(env: Env, prefix: 'PAYER' | 'SWEEPER'): Signer | null {
  const accountId = env[`ZI_${prefix}_ACCOUNT`];
  const secret = env[`ZI_${prefix}_KEY`];
  if (!accountId && !secret) return null;
  if (!accountId || !secret) throw new Error(`set both ZI_${prefix}_ACCOUNT and ZI_${prefix}_KEY`);
  if (!accountId.endsWith('.testnet') && !/^[0-9a-f]{64}$/.test(accountId)) throw new Error(`ZI_${prefix}_ACCOUNT must be a testnet account`);
  return { accountId, secret };
}

export function loadConfig(env: Env = process.env): Config {
  const network = env.ZI_NETWORK ?? 'testnet';
  if (network !== 'testnet') throw new Error('ZI_NETWORK must be "testnet": ZeroInit is testnet-only');
  const rpcUrl = env.ZI_RPC_URL ?? 'https://test.rpc.fastnear.com';
  if (/mainnet/i.test(rpcUrl)) throw new Error('refusing a mainnet RPC URL');
  const scheme = (env.ZI_SCHEME ?? '0u') as '0u' | '0s';
  if (scheme !== '0u' && scheme !== '0s') throw new Error('ZI_SCHEME must be 0u or 0s');
  const codeHashB58 = env.ZI_CODE_HASH ?? null;
  if (codeHashB58 !== null && base58.decode(codeHashB58).length !== 32) throw new Error('ZI_CODE_HASH must be base58 of 32 bytes');
  return {
    network: 'testnet', rpcUrl, scheme, codeHashB58,
    invoiceDir: env.ZI_INVOICE_DIR ?? 'invoices',
    record: env.ZI_RECORD ?? null,
    payer: signer(env, 'PAYER'),
    sweeper: signer(env, 'SWEEPER'),
  };
}
