// Loads ZI_* env vars. Testnet-only guard (PLAN.md §14 rule 1).
import { base58 } from '@scure/base';

/** The invoice-contract deployments this client knows. All are global contracts on testnet, identified by the sha256 (base58) of the wasm. */
export interface Deployment {
  version: 'v1' | 'v2' | 'v3' | 'v3.1' | 'v3.2' | 'v3.2r' | 'v3.3';
  hash: string;
  label: string;
  /** Contract-level findings this deployment fixes (see README "v1 → v2" and "v2 → v3"). */
  fixes: readonly string[];
  /** State layout the deployment's invoices use: 1 (v1, v2) or 3 (v3 to v3.3); decides the document format (/1 or /2). */
  layout: 1 | 3;
  /** true: only for verifying/replaying recorded history; never used to issue or sign. */
  historical: boolean;
}
export const V1_CODE_HASH = 'Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k';
export const V2_CODE_HASH = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';
/** v3 wasm built from this repo, 161,213 bytes, sha256 0724781d…0b1f. Deployed on testnet as a global contract (docs/SPIKES.md "Contract v3 live"). History since v3.1: it has the token-sweep race (final-review F1). */
export const V3_CODE_HASH = 'Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa';
/** v3.1 wasm (v3 plus the F1 fix: a token sweep racing an in-flight ft_transfer_call plans nothing), built from this repo, 163,771 bytes, sha256 1b1dcc75…e278. Deployed by the operator (tx 52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB). History since v3.2: the race stays open on every rejection path except `busy`. */
export const V31_CODE_HASH = '2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX';
/** v3.2 wasm (v3.1 plus the audit fixes contract-1 HIGH on every rejection path, contract-2/3/4), built from this repo, 164,040 bytes, sha256 016bf5ba…5e63d. Deployed by the operator (tx GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg, deployer sm1110-zi32-deployer.testnet). History since v3.2r: same source, but a non-reproducible build. */
export const V32_CODE_HASH = '6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ';
/** v3.2r = the SAME source as v3.2, built reproducibly (`cargo near build reproducible-wasm` at commit 4116e69, image sourcescan/cargo-near:0.23.0-rust-1.99.1 pinned by digest), 163,788 bytes, sha256 9a8f368d…5b92. The build records its commit in the contract metadata, so a later commit gives a different hash. Published as a global contract by hash (tx DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs, signer sm1110-zi-deployer.testnet). */
export const V32R_CODE_HASH = 'BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry';
/** v3.3 = v3.2r plus "parked funds count toward the price" (pay() and token payments; a settlement that used parked funds records no payer), built reproducibly (`cargo near build reproducible-wasm` at commit 7727a1c, same pinned image), 170,344 bytes, sha256 b03c1b08…2a8e. Published as a global contract by hash (tx 2Sr5wa1TF117WpEyjBDPFx5jULPJQKVzZ4ooy8hA6TPS, signer zeroinit-deployer.testnet). */
export const V33_CODE_HASH = 'CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb';
export const KNOWN_DEPLOYMENTS: readonly Deployment[] = [
  { version: 'v3.3', hash: V33_CODE_HASH, label: 'v3.3 (current, deployed on testnet: parked funds count toward the price; reproducible build of commit 7727a1c)', fixes: ['contract-1', 'contract-2', 'contract-3', 'settling', 'owed-ledger', 'tax-extras', 'tokens', 'token-sweep-race', 'token-sweep-race-all-rejections', 'late-release-by-sweep', 'paid-at-ms-first-settlement', 'status-from-promise', 'parked-counted'], layout: 3, historical: false },
  { version: 'v3.2r', hash: V32R_CODE_HASH, label: 'v3.2r (history, frozen: the v3.2 source built reproducibly, rebuild commit 4116e69; a payment on top of parked funds is charged twice; verify and replay only)', fixes: ['contract-1', 'contract-2', 'contract-3', 'settling', 'owed-ledger', 'tax-extras', 'tokens', 'token-sweep-race', 'token-sweep-race-all-rejections', 'late-release-by-sweep', 'paid-at-ms-first-settlement', 'status-from-promise'], layout: 3, historical: true },
  { version: 'v3.2', hash: V32_CODE_HASH, label: 'v3.2 (history, frozen: the same source as v3.2r but a non-reproducible build; verify and replay only)', fixes: ['contract-1', 'contract-2', 'contract-3', 'settling', 'owed-ledger', 'tax-extras', 'tokens', 'token-sweep-race', 'token-sweep-race-all-rejections', 'late-release-by-sweep', 'paid-at-ms-first-settlement', 'status-from-promise'], layout: 3, historical: true },
  { version: 'v3.1', hash: V31_CODE_HASH, label: 'v3.1 (history, frozen: v3 plus the token-sweep race fix for the busy rejection only; verify and replay only)', fixes: ['contract-1', 'contract-2', 'contract-3', 'settling', 'owed-ledger', 'tax-extras', 'tokens', 'token-sweep-race'], layout: 3, historical: true },
  { version: 'v3', hash: V3_CODE_HASH, label: 'v3 (history, frozen: NEP-141, SETTLING, owed ledger; has the token-sweep race; verify and replay only)', fixes: ['contract-1', 'contract-2', 'contract-3', 'settling', 'owed-ledger', 'tax-extras', 'tokens'], layout: 3, historical: true },
  { version: 'v2', hash: V2_CODE_HASH, label: 'v2 (history, frozen: fixes contract-1/2/3; verify and replay only)', fixes: ['contract-1', 'contract-2', 'contract-3'], layout: 1, historical: true },
  { version: 'v1', hash: V1_CODE_HASH, label: 'v1 (history, frozen: known limitations contract-1/2/3; verify only, never pay)', fixes: [], layout: 1, historical: true },
];
/** The known deployment with this code hash, or null (an own deployment pinned through ZI_CODE_HASH, or a foreign contract). */
export const deploymentOf = (hash: string): Deployment | null => KNOWN_DEPLOYMENTS.find((d) => d.hash === hash) ?? null;
/** Human label of a code hash: the known deployment's label, else "custom". */
export const deploymentLabel = (hash: string): string => deploymentOf(hash)?.label ?? 'custom (not a known ZeroInit deployment)';

/** The current ZeroInit invoice contract (v3.3), built from this repo and deployed on testnet. */
export const DEPLOYED_CODE_HASH = V33_CODE_HASH;
/** The code hash a payer trusts: ZI_CODE_HASH when set (own deployment), else the current deployed hash (v3.3). Never the invoice file's own value. */
export const trustedCodeHash = (cfg: { codeHashB58: string | null }): string => cfg.codeHashB58 ?? DEPLOYED_CODE_HASH;
/**
 * The hash to verify a document against: the trusted hash, or (read-only checks only) the hash of a historical known deployment
 * the document was issued under. A foreign/unknown hash is never accepted: it resolves to the trusted hash, so the check FAILs.
 */
export function pinForVerification(trusted: string, docCodeHash: string): string {
  const d = deploymentOf(docCodeHash);
  return docCodeHash !== trusted && d?.historical ? d.hash : trusted;
}
/** Does the deployment behind `hash` fix this finding? Unknown hashes: no (stay conservative). */
export const fixesFinding = (hash: string, finding: string): boolean => deploymentOf(hash)?.fixes.includes(finding) ?? false;
/** Does the deployment behind `hash` fix contract-3 (pay() settles funds parked by a plain transfer)? Unknown hashes: no. */
export const fixesParkedFunds = (hash: string): boolean => fixesFinding(hash, 'contract-3');

/** One NEP-141 token the client is allowed to issue, verify and pay. The symbol+decimals are pinned here, never read from a doc. */
export interface AllowedToken {
  symbol: string;
  decimals: number;
  accountId: string;
}
/** The mock tUSDC (6 decimals) deployed for this project on testnet. A testnet mock: it has no value and no issuer behind it. */
export const DEFAULT_TUSDC_ACCOUNT = 'zeroinit-tusdc.testnet';
/**
 * The allow-list. tUSDC is the only entry. The default is the deployed mock (`DEFAULT_TUSDC_ACCOUNT`); ZI_TUSDC_ACCOUNT points
 * it at another token instance, and a set-but-empty ZI_TUSDC_ACCOUNT switches token invoices off (`--token` is refused with a
 * clear message, docs/STABLECOIN.md §10).
 */
export function allowedTokens(env: Record<string, string | undefined> = process.env): AllowedToken[] {
  const id = (env.ZI_TUSDC_ACCOUNT ?? DEFAULT_TUSDC_ACCOUNT).trim();
  return id ? [{ symbol: 'tUSDC', decimals: 6, accountId: id }] : [];
}
export const tokenBySymbol = (allowed: readonly AllowedToken[], symbol: string): AllowedToken | null =>
  allowed.find((t) => t.symbol === symbol) ?? null;

/**
 * The tUSDC mock that the history deployments (v3 to v3.2r) were run with. Accepted ONLY for read-only checks (verify, status,
 * receipt, replay) of a document issued under a historical deployment; nothing is ever issued or paid with it.
 */
export const HISTORICAL_TOKENS: readonly AllowedToken[] = [{ symbol: 'tUSDC', decimals: 6, accountId: 'sm1110-tusdc.testnet' }];
/** The allow-list for a read-only check of a document: the client's own, or the history token for a historical deployment's documents. */
export function readOnlyAllowList(cfg: { allowedTokens: AllowedToken[] }, docCodeHash: string, docTokenAccount: string | null): readonly AllowedToken[] {
  if (!deploymentOf(docCodeHash)?.historical) return cfg.allowedTokens;
  if (docTokenAccount === null || cfg.allowedTokens.some((t) => t.accountId === docTokenAccount)) return cfg.allowedTokens;
  return HISTORICAL_TOKENS;
}

export interface Signer { accountId: string; secret: string }
export interface Config {
  network: 'testnet';
  rpcUrl: string;
  /** Archival endpoint for transaction lookups (`zi receipt --tx`): the default RPC prunes transactions after about 1.5 days. null = none. */
  archivalRpcUrl: string | null;
  scheme: '0u' | '0s';
  codeHashB58: string | null;
  invoiceDir: string;
  record: string | null;
  payer: Signer | null;
  sweeper: Signer | null;
  allowedTokens: AllowedToken[];
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

const DEFAULT_RPC_URL = 'https://rpc.testnet.fastnear.com';
const TESTNET_ACCOUNT = /^(?:[\w.-]+\.testnet|[0-9a-f]{64}|0[us][0-9a-z]+)$/;
export function loadConfig(env: Env = process.env): Config {
  const network = env.ZI_NETWORK ?? 'testnet';
  if (network !== 'testnet') throw new Error('ZI_NETWORK must be "testnet": ZeroInit is testnet-only');
  const rpcUrl = env.ZI_RPC_URL ?? DEFAULT_RPC_URL;
  if (/mainnet/i.test(rpcUrl)) throw new Error('refusing a mainnet RPC URL');
  // A substring test is only a first line of defence; every command also asserts chain_id == testnet over RPC (checkNetwork, rpc.ts).
  const archivalRpcUrl = env.ZI_ARCHIVAL_RPC_URL ?? (rpcUrl === DEFAULT_RPC_URL ? 'https://archival-rpc.testnet.fastnear.com' : null);
  if (archivalRpcUrl !== null && /mainnet/i.test(archivalRpcUrl)) throw new Error('refusing a mainnet archival RPC URL');
  const scheme = (env.ZI_SCHEME ?? '0u') as '0u' | '0s';
  if (scheme !== '0u' && scheme !== '0s') throw new Error('ZI_SCHEME must be 0u or 0s');
  const codeHashB58 = env.ZI_CODE_HASH ?? null;
  if (codeHashB58 !== null && base58.decode(codeHashB58).length !== 32) throw new Error('ZI_CODE_HASH must be base58 of 32 bytes');
  const tokens = allowedTokens(env);
  for (const t of tokens) if (!TESTNET_ACCOUNT.test(t.accountId)) throw new Error(`ZI_TUSDC_ACCOUNT "${t.accountId}" is not a testnet account`);
  return {
    network: 'testnet', rpcUrl, archivalRpcUrl, scheme, codeHashB58,
    invoiceDir: env.ZI_INVOICE_DIR ?? 'invoices',
    record: env.ZI_RECORD ?? null,
    payer: signer(env, 'PAYER'),
    sweeper: signer(env, 'SWEEPER'),
    allowedTokens: tokens,
  };
}
