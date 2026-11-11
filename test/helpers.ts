// Shared test helpers (not a test file): fake JSON-RPC server, CLI runner, temp invoice dirs, throwaway signer keys.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { parseNear } from '../src/bytes.ts';
import { createInvoiceDoc, saveDoc, isV3Doc, docToken, docGraceMs, type InvoiceDoc } from '../src/invoice.ts';
import { V1_CODE_HASH, V2_CODE_HASH, V3_CODE_HASH, V31_CODE_HASH, V32_CODE_HASH } from '../src/config.ts';

/** The current (v3.2) build hash, the default trusted hash. v3.1, v3, v2 and v1 are the frozen history deployments. */
export const DEPLOYED = V32_CODE_HASH;
export const V31 = V31_CODE_HASH;
export const V3 = V3_CODE_HASH;
export const V2 = V2_CODE_HASH;
export const V1 = V1_CODE_HASH;
export const FOREIGN = base58.encode(new Uint8Array(32).fill(0xee));

/** The per-run API token the dashboard tests pass to serve() and send on every POST. */
export const TEST_TOKEN = 'test-token-0123456789abcdef';

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'zi-test-'));

/** A throwaway ed25519 payer: an implicit (64-hex) account plus its secret in near-cli format. Not a real key. */
export function throwawaySigner(): { account: string; secret: string } {
  const seed = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(seed);
  return { account: Buffer.from(pub).toString('hex'), secret: 'ed25519:' + base58.encode(new Uint8Array([...seed, ...pub])) };
}

export const terms = (over: Record<string, unknown> = {}) => ({ invoice_id: 'INV-T-1', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: 800,
  amount: parseNear('1'), expires_at_ms: BigInt(Date.now() + 3_600_000), salt: 7n, ...over });

/** A doc for the given code hash: /2 (v3 layout) for the v3 deployment, /1 (v1/v2 layout) otherwise. */
export function makeDoc(codeHash = DEPLOYED, over: Record<string, unknown> = {}): InvoiceDoc {
  return createInvoiceDoc('0u', codeHash, terms(over));
}
/** A token doc on v3 with a fake allow-list token address. */
export function makeTokenDoc(over: Record<string, unknown> = {}): InvoiceDoc {
  return createInvoiceDoc('0u', DEPLOYED, terms({ token: 'tusdc.example.testnet', token_symbol: 'tUSDC', token_decimals: 6, amount: 1_500_000n, ...over }));
}
export function writeDoc(dir: string, doc: InvoiceDoc): void { saveDoc(dir, doc); }

export interface FakeRpc { url: string; calls: Array<{ method: string; params: any }>; close(): Promise<void> }
type Handler = (params: any) => unknown;

/** A JSON-RPC server. `handlers[method]` returns a `result` or `{ __error: <error object> }`. Unknown methods answer a JSON-RPC error. */
export async function fakeRpc(handlers: Record<string, Handler>): Promise<FakeRpc> {
  const calls: FakeRpc['calls'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const { method, params } = JSON.parse(body);
      calls.push({ method, params });
      const h = handlers[method];
      const out: any = { jsonrpc: '2.0', id: 'zi' };
      if (!h) out.error = { name: 'HANDLER_ERROR', cause: { name: 'METHOD_NOT_FOUND' }, message: `no handler for ${method}` };
      else { const r: any = h(params); if (r && r.__error) out.error = r.__error; else out.result = r; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}

export const statusResult = (chain_id: string) => ({ chain_id, protocol_version: 88, version: { version: 'test' } });
export const unknownAccount = { __error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT', info: {} }, message: 'unknown' } };
export const viewResult = (obj: unknown) => ({ result: [...Buffer.from(JSON.stringify(obj))], logs: [], block_height: 1, block_hash: 'x' });

export function runCli(args: string[], env: Record<string, string> = {}, script = 'src/cli.ts'): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
/** The get_invoice() view matching the doc, including the v3 fields for a /2 doc. */
export const onchainInvoice = (doc: InvoiceDoc, over: Record<string, unknown> = {}) => ({
  v: isV3Doc(doc) ? 3 : 1, account_id: doc.account_id, invoice_id: doc.invoice_id, merchant: doc.merchant, tax_vault: doc.tax_vault,
  tax_bps: doc.tax_bps, amount: isV3Doc(doc) ? doc.amount_raw : doc.amount_yocto, expires_at_ms: doc.expires_at_ms, salt: doc.salt,
  ...(isV3Doc(doc) ? { grace_ms: docGraceMs(doc).toString(), token: docToken(doc), owed_merchant: '0', owed_tax: '0', owed_payer: '0', refund_to: null, busy_until_ms: '0' } : {}),
  status: 'OPEN', paid_by: null, paid_at_ms: '0', paid_amount: '0', tax_amount: '0', ...over,
});

export interface Chain {
  hash?: string | null;
  invoice?: Record<string, unknown> | null;
  uninitialized?: boolean;
  txResult?: unknown;
  chainId?: string;
  txStatusError?: boolean;
  /** token views for a token doc */
  ftBalance?: string;
  ftMetadata?: { symbol: string; decimals: number };
  storageBalance?: { total: string; available: string } | null;
  storageMin?: string;
  accountAmount?: string;
}
export function handlers(doc: InvoiceDoc, ch: Chain) {
  const initialized = ch.invoice !== undefined && ch.invoice !== null;
  const token = docToken(doc);
  return {
    status: () => statusResult(ch.chainId ?? 'testnet'),
    block: () => ({ header: { hash: base58.encode(new Uint8Array(32).fill(1)) } }),
    send_tx: () => ({}),
    EXPERIMENTAL_tx_status: () => (ch.txStatusError ? { __error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' }, message: 'x' } } : ch.txResult),
    query: (p: any) => {
      switch (p.request_type) {
        case 'view_access_key': return { nonce: 5 };
        case 'view_access_key_list': return { keys: [] };
        case 'call_function':
          if (token) {
            if (p.method_name === 'get_invoice') return viewResult(ch.invoice);
            if (p.method_name === 'ft_balance_of') return viewResult(ch.ftBalance ?? '0');
            if (p.method_name === 'ft_metadata') return viewResult(ch.ftMetadata ?? { spec: 'ft-1.0.0', symbol: 'tUSDC', decimals: 6 });
            if (p.method_name === 'storage_balance_of') return viewResult(ch.storageBalance === undefined ? { total: '1250000000000000000000', available: '0' } : ch.storageBalance);
            if (p.method_name === 'storage_balance_bounds') return viewResult({ min: ch.storageMin ?? '1250000000000000000000', max: null });
            return { __error: { name: 'HANDLER_ERROR', cause: { name: 'METHOD_NOT_FOUND' }, message: p.method_name } };
          }
          return viewResult(ch.invoice);
        case 'view_account':
          if (ch.uninitialized) return { state: 'uninitialized', amount: '1000000000000000000000000', storage_usage: 0 };
          if (!initialized) return unknownAccount;
          return { amount: ch.accountAmount ?? '1000000000000000000000000', storage_usage: 300, global_contract_hash: ch.hash === undefined ? DEPLOYED : ch.hash };
        default: return { __error: { name: 'HANDLER_ERROR', cause: { name: 'X' }, message: p.request_type } };
      }
    },
  };
}
export const payResult = (doc: InvoiceDoc, value: string) => ({ status: { SuccessValue: b64(value) }, transaction: { hash: 'H', signer_id: 'x', receiver_id: doc.account_id, actions: [] }, receipts_outcome: [], receipts: [] });

/** Minimal borsh reader for the signed V0 transactions the CLI sends (tests only). */
export interface DecodedAction { kind: 'FunctionCall' | 'Transfer' | 'UniversalStateInit'; method?: string; args?: string; gas?: bigint; deposit?: bigint; rawLen?: number }
export function decodeSignedTx(b64: string): { signer: string; receiver: string; actions: DecodedAction[] } {
  const b = Buffer.from(b64, 'base64');
  let o = 0;
  const u8 = () => b[o++];
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return v; };
  const u128 = () => { let v = 0n; for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]); o += 16; return v; };
  const bytes = (n: number) => { const x = b.subarray(o, o + n); o += n; return x; };
  const str = () => bytes(u32()).toString('utf8');
  const signer = str();
  u8(); bytes(32); u64();
  const receiver = str();
  bytes(32);
  const n = u32();
  const actions: DecodedAction[] = [];
  for (let i = 0; i < n; i++) {
    const kind = u8();
    if (kind === 2) actions.push({ kind: 'FunctionCall', method: str(), args: bytes(u32()).toString('utf8'), gas: u64(), deposit: u128() });
    else if (kind === 3) actions.push({ kind: 'Transfer', deposit: u128() });
    else if (kind === 15) actions.push({ kind: 'UniversalStateInit', rawLen: bytes(u32()).length, deposit: u128() });
    else throw new Error(`unknown action discriminant ${kind}`);
  }
  return { signer, receiver, actions };
}
