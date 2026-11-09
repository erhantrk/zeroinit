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
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const bound = server.address();
    const boundPort = typeof bound === 'object' && bound ? bound.port : port;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}`) {
      return send(res, 403, { error: `origin ${origin} is not the dashboard origin` });
    }
    const body = async (): Promise<{ ok: true; value: any } | { ok: false }> => {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        send(res, 400, { error: 'content-type must be application/json' });
        return { ok: false };
      }
      try {
        return { ok: true, value: await readBody(req) };
      } catch {
        send(res, 400, { error: 'invalid JSON body' });
        return { ok: false };
      }
    };
    try {
      const m = /^\/api\/invoices\/([A-Za-z0-9_-]{1,32})\/(status|pay|sweep)$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync('web/index.html', 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/state.js') return send(res, 200, readFileSync('web/state.js', 'utf8'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/invoices') return send(res, 200, listDocs(cfg.invoiceDir));
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        const b = await body();
        if (!b.ok) return;
        if (!cfg.codeHashB58) return send(res, 400, { error: 'ZI_CODE_HASH not set' });
        let doc: InvoiceDoc;
        try {
          doc = createInvoiceDoc(cfg.scheme, cfg.codeHashB58, { invoice_id: String(b.value.id), merchant: String(b.value.merchant), tax_vault: String(b.value.tax_vault),
            tax_bps: Number(b.value.tax_bps), amount: parseNear(String(b.value.amount_near)), expires_at_ms: BigInt(Date.now() + Number(b.value.expires_in_minutes) * 60_000), salt: randomSalt() });
          saveDoc(cfg.invoiceDir, doc);
        } catch (e) {
          return send(res, 400, { error: message(e) });
        }
        return send(res, 200, doc);
      }
      if (m) {
        let doc: InvoiceDoc;
        try {
          doc = loadDoc(cfg.invoiceDir, m[1]);
        } catch (e) {
          return send(res, 400, { error: message(e) });
        }
        if (m[2] === 'status' && req.method === 'GET') {
          const s = await viewAccount(cfg, doc.account_id);
          const invoice = s.kind === 'INITIALIZED' ? await viewInvoice(cfg, doc.account_id) : null;
          return send(res, 200, { state: s.kind, balance_yocto: s.kind === 'NONEXISTENT' ? '0' : s.amount.toString(),
            storage_usage: s.kind === 'NONEXISTENT' ? null : s.storageUsage, invoice });
        }
        if (req.method === 'POST') {
          if (m[2] !== 'pay' && m[2] !== 'sweep') return send(res, 404, { error: 'not found' });
          const b = await body();
          if (!b.ok) return;
          const isPay = m[2] === 'pay';
          const signer = isPay ? cfg.payer : cfg.sweeper;
          if (!signer) return send(res, 400, { error: `server has no ${isPay ? 'payer' : 'sweeper'} key` });
          let deposit: bigint;
          try {
            deposit = isPay ? (b.value.amount_near ? parseNear(String(b.value.amount_near)) : BigInt(doc.amount_yocto)) : 0n;
          } catch (e) {
            return send(res, 400, { error: message(e) });
          }
          try {
            const p = await sendActions(cfg, signer, doc.account_id, [initAction(doc), actFunctionCall(m[2], utf8('{}'), GAS, deposit)], m[2]);
            return send(res, p.success ? 200 : 502, { tx_hash: p.txHash, result: p.returnValue, events: p.events,
              transfers: p.transfers.map((t) => ({ to: t.to, yocto: t.yocto.toString() })) });
          } catch (e) {
            return send(res, 502, { error: message(e) });
          }
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 502, { error: message(e) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`SERVE http://127.0.0.1:${boundPort}`);
    resolve(server);
  }));
}
