// SHOULD: local dashboard API (INTERFACES.md §8). Binds 127.0.0.1 only. Signs with server-side env keys (demo only).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseNear, formatNear, utf8 } from './bytes.ts';
import { actFunctionCall } from './tx.ts';
import { trustedCodeHash, type Config } from './config.ts';
import { viewAccount, viewInvoice } from './rpc.ts';
import { sendActions } from './send.ts';
import { createInvoiceDoc, saveDoc, loadDoc, listDocs, assertDocTrusted, assertAccountsUsable, stateInitAction, randomSalt, type InvoiceDoc } from './invoice.ts';

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
/** Strict body fields: no Number()/String() coercion of missing or empty values into valid-looking terms. */
function nonEmptyString(name: string, v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name} is required (non-empty string)`);
  return v;
}
function uintField(name: string, v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export function serve(cfg: Config, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const bound = server.address();
    const boundPort = typeof bound === 'object' && bound ? bound.port : port;
    // DNS-rebinding guard: a rebound page sends its own hostname in Host (and no Origin on same-origin GETs).
    const host = req.headers.host;
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
      return send(res, 403, { error: `host ${String(host)} is not the dashboard host` });
    }
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
      if (req.method === 'GET' && url.pathname === '/api/invoices') {
        // The dashboard shows amount_near: derive it from amount_yocto (what pay attaches), never trust the file's display field.
        return send(res, 200, listDocs(cfg.invoiceDir).map((d) => { try { return { ...d, amount_near: formatNear(BigInt(d.amount_yocto)) }; } catch { return d; } }));
      }
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        const b = await body();
        if (!b.ok) return;
        let doc: InvoiceDoc;
        try {
          const expiresInMinutes = uintField('expires_in_minutes', b.value.expires_in_minutes);
          if (expiresInMinutes < 1) throw new Error('expires_in_minutes must be a positive integer');
          const terms = { invoice_id: nonEmptyString('id', b.value.id), merchant: nonEmptyString('merchant', b.value.merchant), tax_vault: nonEmptyString('tax_vault', b.value.tax_vault),
            tax_bps: uintField('tax_bps', b.value.tax_bps), amount: parseNear(nonEmptyString('amount_near', typeof b.value.amount_near === 'number' ? String(b.value.amount_near) : b.value.amount_near)),
            expires_at_ms: BigInt(Date.now() + expiresInMinutes * 60_000), salt: randomSalt() };
          doc = createInvoiceDoc(cfg.scheme, trustedCodeHash(cfg), terms);
          await assertAccountsUsable(cfg, terms);
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
          const trusted = trustedCodeHash(cfg);
          try {
            assertDocTrusted(doc, trusted);
          } catch (e) {
            return send(res, 400, { error: message(e) });
          }
          try {
            const p = await sendActions(cfg, signer, doc.account_id, [stateInitAction(doc, trusted), actFunctionCall(m[2], utf8('{}'), GAS, deposit)], m[2]);
            // pay() refunds instead of panicking: only PAID is a payment (409 + paid:false for REFUNDED_*).
            const paid = p.success && (!isPay || p.returnValue === 'PAID');
            return send(res, !p.success ? 502 : paid ? 200 : 409, { paid, tx_hash: p.txHash, result: p.returnValue, events: p.events, transfers_failed: p.downstreamFailures.length,
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
