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
import { createInvoiceDoc, saveDoc, type InvoiceDoc } from '../src/invoice.ts';

/** The current (v2) deployed hash, the default trusted hash. V1 is the frozen history deployment. */
export const DEPLOYED = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';
export const V1 = 'Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k';
export const FOREIGN = base58.encode(new Uint8Array(32).fill(0xee));

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'zi-test-'));

/** A throwaway ed25519 payer: an implicit (64-hex) account plus its secret in near-cli format. Not a real key. */
export function throwawaySigner(): { account: string; secret: string } {
  const seed = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(seed);
  return { account: Buffer.from(pub).toString('hex'), secret: 'ed25519:' + base58.encode(new Uint8Array([...seed, ...pub])) };
}

export const terms = (over: Record<string, unknown> = {}) => ({ invoice_id: 'INV-T-1', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: 800,
  amount: parseNear('1'), expires_at_ms: BigInt(Date.now() + 3_600_000), salt: 7n, ...over });

export function makeDoc(codeHash = DEPLOYED, over: Record<string, unknown> = {}): InvoiceDoc {
  return createInvoiceDoc('0u', codeHash, terms(over));
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
export const onchainInvoice = (doc: InvoiceDoc, over: Record<string, unknown> = {}) => ({ v: 1, account_id: doc.account_id, invoice_id: doc.invoice_id, merchant: doc.merchant, tax_vault: doc.tax_vault,
  tax_bps: doc.tax_bps, amount: doc.amount_yocto, expires_at_ms: doc.expires_at_ms, salt: doc.salt, status: 'OPEN', paid_by: null, paid_at_ms: '0', paid_amount: '0', tax_amount: '0', ...over });

export interface Chain { hash?: string | null; invoice?: Record<string, unknown> | null; uninitialized?: boolean; txResult?: unknown; chainId?: string; txStatusError?: boolean }
export function handlers(doc: InvoiceDoc, ch: Chain) {
  const initialized = ch.invoice !== undefined && ch.invoice !== null;
  return {
    status: () => statusResult(ch.chainId ?? 'testnet'),
    block: () => ({ header: { hash: base58.encode(new Uint8Array(32).fill(1)) } }),
    send_tx: () => ({}),
    EXPERIMENTAL_tx_status: () => (ch.txStatusError ? { __error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' }, message: 'x' } } : ch.txResult),
    query: (p: any) => {
      switch (p.request_type) {
        case 'view_access_key': return { nonce: 5 };
        case 'view_access_key_list': return { keys: [] };
        case 'call_function': return viewResult(ch.invoice);
        case 'view_account':
          if (ch.uninitialized) return { state: 'uninitialized', amount: '1000000000000000000000000', storage_usage: 0 };
          if (!initialized) return unknownAccount;
          return { amount: '1000000000000000000000000', storage_usage: 300, global_contract_hash: ch.hash === undefined ? DEPLOYED : ch.hash };
        default: return { __error: { name: 'HANDLER_ERROR', cause: { name: 'X' }, message: p.request_type } };
      }
    },
  };
}
export const payResult = (doc: InvoiceDoc, value: string) => ({ status: { SuccessValue: b64(value) }, transaction: { hash: 'H', signer_id: 'x', receiver_id: doc.account_id, actions: [] }, receipts_outcome: [], receipts: [] });

