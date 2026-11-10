// SHOULD: local dashboard API (INTERFACES.md §8; docs/STABLECOIN.md §10 for v3). Binds 127.0.0.1 only.
// Signs with server-side env keys (demo only).
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseNear, formatNear, utf8 } from './bytes.ts';
import { actFunctionCall, actTransfer } from './tx.ts';
import { trustedCodeHash, deploymentOf, tokenBySymbol, type Config, type AllowedToken } from './config.ts';
import { viewAccount, viewInvoice } from './rpc.ts';
import { sendActions } from './send.ts';
import { createInvoiceDoc, saveDoc, loadDoc, listDocs, assertDocTrusted, assertAccountsUsable, stateInitAction, randomSalt,
  isV3Doc, docAmountRaw, docAmountDisplay, docToken, docUnit, docDecimals, docGraceMs, GRACE_MIN_MS, GRACE_MAX_MS, type InvoiceDoc } from './invoice.ts';
import { GAS, FLOAT_YOCTO, actFund, actFtTransfer, actFtTransferCall, actStorageDeposit, payMsg, parseUnits, formatUnits,
  ftBalanceOf, storageBalanceBounds, storageBalanceOf } from './ft.ts';

const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A signing/transport failure is a bad gateway; a bad document or request is a 400. */
const statusForError = (e: unknown): number => (/chain_id|RPC request|send_tx|tx_status|HTTP 5\d\d/.test(message(e)) ? 502 : 400);

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

function tokenForDoc(cfg: Config, doc: InvoiceDoc): AllowedToken {
  const contract = docToken(doc);
  const symbol = isV3Doc(doc) && doc.asset.kind === 'ft' ? doc.asset.symbol : '';
  const entry = tokenBySymbol(cfg.allowedTokens, symbol);
  if (!contract || !entry || entry.accountId !== contract) throw new Error(`token ${contract ?? '(none)'} is not on this server's allow-list`);
  return entry;
}

/** Register the invoice id on the token if needed, init it if needed, then run the payer's token action. */
async function tokenPay(cfg: Config, doc: InvoiceDoc, entry: AllowedToken, plain: boolean, amount: bigint) {
  const signer = cfg.payer;
  if (!signer) throw new Error('server has no payer key');
  const trusted = trustedCodeHash(cfg);
  const txs: any[] = [];
  const sb = await storageBalanceOf(cfg, entry.accountId, doc.account_id);
  if (sb === null) {
    const bounds = await storageBalanceBounds(cfg, entry.accountId);
    txs.push(await sendActions(cfg, signer, entry.accountId, [actStorageDeposit(doc.account_id, bounds.min)], 'register'));
  }
  if (!plain) {
    const s = await viewAccount(cfg, doc.account_id);
    if (s.kind !== 'INITIALIZED') txs.push(await sendActions(cfg, signer, doc.account_id, [stateInitAction(doc, trusted), actFund()], 'init'));
  }
  const last = plain
    ? await sendActions(cfg, signer, entry.accountId, [actFtTransfer(doc.account_id, amount)], 'plain')
    : await sendActions(cfg, signer, entry.accountId, [actFtTransferCall(doc.account_id, amount, payMsg(doc.invoice_id))], 'pay');
  txs.push(last);
  return { txs, last };
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
      const m = /^\/api\/invoices\/([A-Za-z0-9_-]{1,32})\/(status|pay|sweep|refund|plain)$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync('web/index.html', 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/state.js') return send(res, 200, readFileSync('web/state.js', 'utf8'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/invoices') {
        // Display amounts are derived from the raw amount (what the contract moves), never trusted from the file's display field.
        return send(res, 200, listDocs(cfg.invoiceDir).map((d) => {
          try {
            // Derive the display amount from the raw amount (what the contract moves), never from the file's display field.
            const raw = docAmountRaw(d);
            const display = isV3Doc(d) ? (d.asset.kind === 'ft' ? formatUnits(raw, d.asset.decimals) : formatNear(raw)) : formatNear(raw);
            return { ...d, amount_display: display, unit: docUnit(d), amount_near: docToken(d) === null ? display : undefined };
          } catch { return d; }
        }));
      }
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        const b = await body();
        if (!b.ok) return;
        let doc: InvoiceDoc;
        try {
          const expiresInMinutes = uintField('expires_in_minutes', b.value.expires_in_minutes);
          if (expiresInMinutes < 1) throw new Error('expires_in_minutes must be a positive integer');
          const assetName = typeof b.value.asset === 'string' && b.value.asset !== '' ? b.value.asset : 'near';
          const entry = assetName === 'near' ? null : tokenBySymbol(cfg.allowedTokens, assetName);
          if (assetName !== 'near' && !entry) {
            throw new Error(cfg.allowedTokens.length ? `unknown asset ${assetName} (allow-list: near, ${cfg.allowedTokens.map((x) => x.symbol).join(', ')})` : 'no token is configured: set ZI_TUSDC_ACCOUNT');
          }
          const dep = deploymentOf(trustedCodeHash(cfg));
          const layout = dep?.version === 'v3' ? 3 : 1;
          if (entry && layout !== 3) throw new Error('token invoices need the v3 deployment');
          const amountText = nonEmptyString('amount', b.value.amount ?? b.value.amount_near);
          const amount = entry ? parseUnits(amountText, entry.decimals) : parseNear(amountText);
          const graceRaw = b.value.payout_grace_ms;
          const grace = graceRaw === undefined || graceRaw === '' ? undefined : BigInt(uintField('payout_grace_ms', graceRaw));
          if (grace !== undefined && (grace < GRACE_MIN_MS || grace > GRACE_MAX_MS)) throw new Error(`payout_grace_ms must be between ${GRACE_MIN_MS} and ${GRACE_MAX_MS}`);
          const terms = { invoice_id: nonEmptyString('id', b.value.id), merchant: nonEmptyString('merchant', b.value.merchant), tax_vault: nonEmptyString('tax_vault', b.value.tax_vault),
            tax_bps: uintField('tax_bps', b.value.tax_bps), amount,
            expires_at_ms: BigInt(Date.now() + expiresInMinutes * 60_000), salt: randomSalt(),
            layout, grace_ms: grace, token: entry?.accountId ?? null, token_symbol: entry?.symbol, token_decimals: entry?.decimals };
          doc = createInvoiceDoc(cfg.scheme, trustedCodeHash(cfg), terms);
          await assertAccountsUsable(cfg, { merchant: terms.merchant, tax_vault: terms.tax_vault, token: terms.token,
            token_symbol: terms.token_symbol, token_decimals: terms.token_decimals });
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
          const token = docToken(doc);
          const tokenBalance = token === null ? 0n : await ftBalanceOf(cfg, token, doc.account_id).catch(() => 0n);
          return send(res, 200, { state: s.kind, balance_yocto: s.kind === 'NONEXISTENT' ? '0' : s.amount.toString(),
            storage_usage: s.kind === 'NONEXISTENT' ? null : s.storageUsage, invoice,
            token, token_symbol: isV3Doc(doc) && doc.asset.kind === 'ft' ? doc.asset.symbol : null,
            token_decimals: token === null ? null : docDecimals(doc), token_balance_raw: tokenBalance.toString(),
            owed_merchant: invoice?.owed_merchant ?? null, owed_tax: invoice?.owed_tax ?? null, owed_payer: invoice?.owed_payer ?? null,
            busy_until_ms: invoice?.busy_until_ms ?? null });
        }
        if (req.method === 'POST') {
          if (!['pay', 'sweep', 'refund', 'plain'].includes(m[2])) return send(res, 404, { error: 'not found' });
          const b = await body();
          if (!b.ok) return;
          const trusted = trustedCodeHash(cfg);
          try {
            assertDocTrusted(doc, trusted, cfg.allowedTokens);
          } catch (e) {
            return send(res, 400, { error: message(e) });
          }
          const token = docToken(doc);
          try {
            if (token !== null) {
              const entry = tokenForDoc(cfg, doc);
              if (m[2] === 'pay' || m[2] === 'plain') {
                let amount = docAmountRaw(doc);
                if (b.value.amount !== undefined && b.value.amount !== '') amount = parseUnits(String(b.value.amount), entry.decimals);
                const { txs, last } = await tokenPay(cfg, doc, entry, m[2] === 'plain', amount);
                const paid = last.events.some((e) => e.event === 'invoice_paid');
                const rejected = last.events.find((e) => e.event === 'payment_rejected');
                const failed = last.events.filter((e) => e.event === 'transfer_failed').length;
                const pending = !paid && !rejected && failed === 0;
                const code = !last.success ? 502 : m[2] === 'plain' ? 200 : paid && failed === 0 ? 200 : rejected ? 409 : pending ? 202 : 409;
                return send(res, code, { paid, pending, tx_hash: last.txHash, result: last.returnValue, events: last.events,
                  rejected: rejected ? (rejected.data[0] as any)?.reason ?? null : null,
                  transfers_failed: last.downstreamFailures.length + failed,
                  transfers: last.transfers.map((t) => ({ to: t.to, yocto: t.yocto.toString() })),
                  ft_transfers: last.ftTransfers.map((t) => ({ token: t.token, to: t.to, amount: t.amount.toString() })),
                  txs: txs.map((t) => t.txHash) });
              }
              if (m[2] === 'refund') {
                const signer = cfg.sweeper;
                if (!signer) return send(res, 400, { error: 'server has no sweeper key' });
                const p = await sendActions(cfg, signer, doc.account_id, [actFunctionCall('refund_payer', utf8('{}'), GAS.refundToken, 0n)], 'refund');
                return send(res, p.success && p.returnValue === 'REFUNDED' ? 200 : 409, { paid: false, tx_hash: p.txHash, result: p.returnValue, events: p.events });
              }
              // sweep: init + fund when needed, then sweep
              const signer = cfg.sweeper;
              if (!signer) return send(res, 400, { error: 'server has no sweeper key' });
              const s = await viewAccount(cfg, doc.account_id);
              const actions: Uint8Array[] = [];
              if (s.kind !== 'INITIALIZED') actions.push(stateInitAction(doc, trusted), actFund());
              else if (s.amount < 100n) actions.push(actFund());
              actions.push(actFunctionCall('sweep', utf8('{}'), GAS.tokenSweep, 0n));
              const p = await sendActions(cfg, signer, doc.account_id, actions, 'sweep');
              const ok = p.success && ['PAID', 'EXTRA_SWEPT', 'TAX_RESENT', 'OWED_RESENT', 'REFUNDED'].includes(String(p.returnValue));
              return send(res, ok ? 200 : 409, { paid: String(p.returnValue) === 'PAID', tx_hash: p.txHash, result: p.returnValue, events: p.events,
                transfers_failed: p.downstreamFailures.length });
            }
            // NEAR invoice: a bare Transfer, exactly what a wallet or exchange sends.
            if (m[2] === 'plain') {
              const signer = cfg.payer;
              if (!signer) return send(res, 400, { error: 'server has no payer key' });
              let amount: bigint;
              try {
                amount = b.value.amount_near ? parseNear(String(b.value.amount_near)) : docAmountRaw(doc);
              } catch (e) {
                return send(res, 400, { error: message(e) });
              }
              const p = await sendActions(cfg, signer, doc.account_id, [actTransfer(amount)], 'plain');
              return send(res, p.success ? 200 : 502, { paid: false, tx_hash: p.txHash, result: p.returnValue, events: p.events });
            }
            if (m[2] === 'refund') {
              const signer = cfg.sweeper;
              if (!signer) return send(res, 400, { error: 'server has no sweeper key' });
              const p = await sendActions(cfg, signer, doc.account_id, [actFunctionCall('refund_payer', utf8('{}'), GAS.refundNear, 0n)], 'refund');
              return send(res, p.success && p.returnValue === 'REFUNDED' ? 200 : 409, { paid: false, tx_hash: p.txHash, result: p.returnValue, events: p.events });
            }
            const isPay = m[2] === 'pay';
            const signer = isPay ? cfg.payer : cfg.sweeper;
            if (!signer) return send(res, 400, { error: `server has no ${isPay ? 'payer' : 'sweeper'} key` });
            let deposit: bigint;
            try {
              deposit = isPay ? (b.value.amount_near ? parseNear(String(b.value.amount_near)) : docAmountRaw(doc)) : 0n;
            } catch (e) {
              return send(res, 400, { error: message(e) });
            }
            const p = await sendActions(cfg, signer, doc.account_id, [stateInitAction(doc, trusted), actFunctionCall(m[2], utf8('{}'), isPay ? GAS.payNear : GAS.sweepNear, deposit)], m[2]);
            // pay() refunds instead of panicking: only PAID is a payment (409 + paid:false for REFUNDED_*).
            // A settlement whose payouts are still in flight or partly failed is pending (202), not paid.
            const paid = p.success && (!isPay || p.returnValue === 'PAID');
            const pending = isPay && p.success && ['PAYOUT_PENDING', 'SETTLING'].includes(String(p.returnValue));
            return send(res, !p.success ? 502 : paid ? 200 : pending ? 202 : 409, { paid, pending, tx_hash: p.txHash, result: p.returnValue, events: p.events, transfers_failed: p.downstreamFailures.length,
              transfers: p.transfers.map((t) => ({ to: t.to, yocto: t.yocto.toString() })) });
          } catch (e) {
            return send(res, statusForError(e), { error: message(e) });
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
