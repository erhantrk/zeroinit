// JSON-RPC client with optional recording (ZI_RECORD) for the replay fixture (INTERFACES.md §6.3, §9).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { base58 } from '@scure/base';
import type { Config } from './config.ts';

let currentInvoiceId: string | null = null;
/** Tag subsequent recorded calls with this invoice id. */
export function setRecordInvoice(id: string | null): void { currentInvoiceId = id; }

function record(path: string, entry: Record<string, unknown>): void {
  const f = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { format: 'zeroinit-fixture/1', recorded_at_iso: new Date().toISOString(), rpc_url: '', invoices: [], calls: [] };
  f.calls.push({ seq: f.calls.length, invoice_id: currentInvoiceId, ...entry });
  writeFileSync(path, JSON.stringify(f, null, 2) + '\n');
}
/** Add an invoice doc to the fixture file (dedup by invoice_id). */
export function recordInvoiceDoc(cfg: Config, doc: { invoice_id: string }): void {
  if (!cfg.record) return;
  const path = cfg.record;
  const f = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { format: 'zeroinit-fixture/1', recorded_at_iso: new Date().toISOString(), rpc_url: cfg.rpcUrl, invoices: [], calls: [] };
  f.rpc_url = cfg.rpcUrl;
  f.invoices = f.invoices.filter((d: { invoice_id: string }) => d.invoice_id !== doc.invoice_id).concat([doc]);
  writeFileSync(path, JSON.stringify(f, null, 2) + '\n');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns the full JSON-RPC response object ({result} or {error}). Throws only on transport failure after 3 tries. */
export async function rpcCall(cfg: Config, method: string, params: unknown, label = `aux: ${method}`): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'zi', method, params });
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(cfg.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (res.status === 429 || res.status >= 500) throw new Error(`RPC HTTP ${res.status}`);
      const json = await res.json();
      if (cfg.record) record(cfg.record, { label, method, params, response: json });
      return json;
    } catch (e) { lastErr = e; await sleep(1000 * (attempt + 1)); }
  }
  throw lastErr;
}

function unwrap(json: any, what: string): any {
  if (json.error) throw new Error(`${what} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

const networkChecked = new WeakMap<Config, { protocol: number; version: string }>();
/** Asserts the RPC is testnet (PLAN §14 rule 1). Cached per Config object so signing paths can call it unconditionally. */
export async function checkNetwork(cfg: Config): Promise<{ protocol: number; version: string }> {
  const cached = networkChecked.get(cfg);
  if (cached) return cached;
  const r = unwrap(await rpcCall(cfg, 'status', []), 'status');
  if (r.chain_id !== 'testnet') throw new Error(`RPC chain_id is ${r.chain_id}, expected testnet`);
  if (r.protocol_version < 88) throw new Error(`protocol ${r.protocol_version} < 88: universal accounts unavailable`);
  const info = { protocol: r.protocol_version, version: r.version.version };
  networkChecked.set(cfg, info);
  return info;
}

export type AccountState =
  | { kind: 'NONEXISTENT' }
  | { kind: 'UNINITIALIZED'; amount: bigint; storageUsage: number; bootstrapNonce: string | null }
  | { kind: 'INITIALIZED'; amount: bigint; storageUsage: number; globalContractHash: string | null; globalContractAccountId: string | null };

export function accountStateFromResponse(json: any): AccountState {
  if (json.error) {
    if (json.error?.cause?.name === 'UNKNOWN_ACCOUNT') return { kind: 'NONEXISTENT' };
    throw new Error(`view_account failed: ${JSON.stringify(json.error)}`);
  }
  const r = json.result;
  if (r.state === 'uninitialized') return { kind: 'UNINITIALIZED', amount: BigInt(r.amount), storageUsage: r.storage_usage, bootstrapNonce: r.bootstrap_nonce != null ? String(r.bootstrap_nonce) : null };
  return { kind: 'INITIALIZED', amount: BigInt(r.amount), storageUsage: r.storage_usage,
    globalContractHash: r.global_contract_hash ?? null, globalContractAccountId: r.global_contract_account_id ?? null };
}

export async function viewAccount(cfg: Config, accountId: string, label?: string): Promise<AccountState> {
  return accountStateFromResponse(await rpcCall(cfg, 'query', { request_type: 'view_account', finality: 'final', account_id: accountId }, label));
}

export function decodeViewResult(json: any): any {
  const r = unwrap(json, 'call_function');
  return JSON.parse(Buffer.from(r.result as number[]).toString('utf8'));
}

export async function viewInvoice(cfg: Config, accountId: string, label?: string): Promise<any> {
  return decodeViewResult(await rpcCall(cfg, 'query', { request_type: 'call_function', finality: 'final', account_id: accountId,
    method_name: 'get_invoice', args_base64: 'e30=' }, label));
}

export async function accessKeyNonce(cfg: Config, accountId: string, publicKey: string): Promise<bigint> {
  const r = unwrap(await rpcCall(cfg, 'query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey }), 'view_access_key');
  return BigInt(r.nonce);
}

export async function finalBlockHash(cfg: Config): Promise<Uint8Array> {
  const r = unwrap(await rpcCall(cfg, 'block', { finality: 'final' }), 'block');
  return base58.decode(r.header.hash);
}
