// Offline verification over a recorded fixture (INTERFACES.md §6.3). No network, no keys.
import { readFileSync } from 'node:fs';
import { base64 } from '@scure/base';
import { formatNear, toHex } from './bytes.ts';
import { checkDoc, type InvoiceDoc } from './invoice.ts';
import { accountStateFromResponse, decodeViewResult } from './rpc.ts';
import { parseTxStatus } from './outcome.ts';

export interface Check { ok: boolean; name: string; id: string; detail: string }

export function replayFixture(path: string): Check[] {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  if (f.format !== 'zeroinit-fixture/1') throw new Error('not a zeroinit-fixture/1 file');
  const checks: Check[] = [];
  const add = (ok: boolean, name: string, id: string, detail = '') => checks.push({ ok, name, id, detail });
  for (const doc of f.invoices as InvoiceDoc[]) {
    const id = doc.invoice_id;
    const calls = (f.calls as any[]).filter((c) => c.invoice_id === id);
    const byLabel = (l: string) => calls.filter((c) => c.label === l);
    const c = checkDoc(doc);
    add(c.idFromTerms && c.rawFromTerms, 'id-from-terms', id, doc.account_id);
    // Only the FIRST "before" snapshot must be NONEXISTENT (a second pay on the same invoice sees it initialized).
    const firstBefore = byLabel('before: view_account')[0];
    if (firstBefore) {
      add(firstBefore.params.account_id === doc.account_id && accountStateFromResponse(firstBefore.response).kind === 'NONEXISTENT', 'before-unknown-account', id);
    }
    // Funds parked by a plain transfer: account exists, uninitialized, balance > 0 (amount may be short; sweep decides).
    const firstTransfer = byLabel('transfer-path: view_account (uninitialized)')[0];
    if (firstTransfer) {
      const s = accountStateFromResponse(firstTransfer.response);
      add(s.kind === 'UNINITIALIZED' && s.amount > 0n, 'transfer-path-uninitialized', id, s.kind === 'UNINITIALIZED' ? formatNear(s.amount) : s.kind);
    }
    for (const prefix of ['pay', 'sweep']) {
      for (const t of byLabel(`${prefix}: tx_status`)) {
        const p = parseTxStatus(t.response.result, doc.account_id);
        if (!p.success && prefix === 'sweep' && JSON.stringify(p.failures).includes('UNDERPAID')) {
          // Expected failure: sweep with too little parked balance reverts the whole receipt; funds stay parked.
          add(true, 'sweep-underpaid-reverted', id, p.txHash);
          continue;
        }
        const rawOk = p.stateInitBase64 === null || toHex(base64.decode(p.stateInitBase64)) === doc.raw_state_init_hex;
        add(p.success && p.receiverId === doc.account_id && rawOk, `${prefix}-tx-success`, id, `${p.txHash} result=${String(p.returnValue)}`);
        if (p.returnValue === 'PAID') {
          const amount = BigInt(doc.amount_yocto); const tax = amount * BigInt(doc.tax_bps) / 10000n;
          const sum = (to: string) => p.transfers.filter((x) => x.to === to).reduce((s, x) => s + x.yocto, 0n);
          const merchantOk = prefix === 'pay' ? sum(doc.merchant) === amount - tax : sum(doc.merchant) >= amount - tax;
          add(merchantOk, `split-merchant`, id, formatNear(sum(doc.merchant)));
          add(sum(doc.tax_vault) === tax, `split-vault`, id, formatNear(sum(doc.tax_vault)));
        } else if (typeof p.returnValue === 'string' && p.returnValue.startsWith('REFUNDED')) {
          const ev = p.events.find((e) => e.event === 'payment_refunded');
          add(!!ev, `refund-event`, id, p.returnValue);
        }
      }
    }
    for (const a of [...byLabel('after: get_invoice'), ...byLabel('sweep-after: get_invoice')]) {
      const v = decodeViewResult(a.response);
      add(v.account_id === doc.account_id && v.invoice_id === id, `after-terms-match`, id);
      add(true, `after-status-${v.status}`, id);
    }
  }
  return checks;
}
