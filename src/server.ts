// SHOULD: local dashboard API (INTERFACES.md §8). Binds 127.0.0.1 only. Signs with server-side env keys (demo only).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseNear, utf8 } from './bytes.ts';
import { actUniversalStateInit, actDeterministicStateInit, actFunctionCall } from './tx.ts';
import type { Config } from './config.ts';
import { viewAccount, viewInvoice } from './rpc.ts';
import { sendActions } from './send.ts';
import { createInvoiceDoc, saveDoc, loadDoc, listDocs, rawFromDoc, randomSalt, type InvoiceDoc } from './invoice.ts';

const GAS = 50_000_000_000_000n;
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json'): void {
  res.writeHead(code, { 'content-type': type });
  res.end(typeof body === 'string' ? body : j(body));
}
async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
function initAction(doc: InvoiceDoc): Uint8Array {
  return doc.scheme === '0u' ? actUniversalStateInit(rawFromDoc(doc), 0n) : actDeterministicStateInit(rawFromDoc(doc), 0n);
}

export function serve(cfg: Config, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const m = /^\/api\/invoices\/([A-Za-z0-9_-]{1,32})\/(status|pay|sweep)$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync('web/index.html', 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/invoices') return send(res, 200, listDocs(cfg.invoiceDir));
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        const b = await readBody(req);
        if (!cfg.codeHashB58) return send(res, 400, { error: 'ZI_CODE_HASH not set' });
        const doc = createInvoiceDoc(cfg.scheme, cfg.codeHashB58, { invoice_id: String(b.id), merchant: String(b.merchant), tax_vault: String(b.tax_vault),
          tax_bps: Number(b.tax_bps), amount: parseNear(String(b.amount_near)), expires_at_ms: BigInt(Date.now() + Number(b.expires_in_minutes) * 60_000), salt: randomSalt() });
        saveDoc(cfg.invoiceDir, doc);
        return send(res, 200, doc);
      }
      if (m) {
        const doc = loadDoc(cfg.invoiceDir, m[1]);
        if (m[2] === 'status' && req.method === 'GET') {
          const s = await viewAccount(cfg, doc.account_id);
          const invoice = s.kind === 'INITIALIZED' ? await viewInvoice(cfg, doc.account_id) : null;
          return send(res, 200, { state: s.kind, balance_yocto: s.kind === 'NONEXISTENT' ? '0' : s.amount.toString(),
            storage_usage: s.kind === 'NONEXISTENT' ? null : s.storageUsage, invoice });
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          const isPay = m[2] === 'pay';
          const signer = isPay ? cfg.payer : cfg.sweeper;
          if (!signer) return send(res, 400, { error: `server has no ${isPay ? 'payer' : 'sweeper'} key` });
          const deposit = isPay ? (b.amount_near ? parseNear(String(b.amount_near)) : BigInt(doc.amount_yocto)) : 0n;
          const p = await sendActions(cfg, signer, doc.account_id, [initAction(doc), actFunctionCall(m[2], utf8('{}'), GAS, deposit)], m[2]);
          return send(res, p.success ? 200 : 502, { tx_hash: p.txHash, result: p.returnValue, events: p.events,
            transfers: p.transfers.map((t) => ({ to: t.to, yocto: t.yocto.toString() })) });
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => { console.log(`SERVE http://127.0.0.1:${port}`); resolve(server); }));
}
