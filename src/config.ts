// Loads ZI_* env vars. Testnet-only guard (PLAN.md §14 rule 1).
import { base58 } from '@scure/base';

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
  const rpcUrl = env.ZI_RPC_URL ?? 'https://rpc.testnet.near.org';
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
