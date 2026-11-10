// Parse EXPERIMENTAL_tx_status results (INTERFACES.md §9).
export interface ZiEvent { standard: string; version: string; event: string; data: Array<Record<string, unknown>> }
export interface ParsedTx {
  txHash: string;
  receiverId: string;
  success: boolean;
  failures: unknown[];             // the tx itself, or a receipt run on the invoice account, failed (pay()/sweep() panicked)
  downstreamFailures: unknown[];   // a receipt run on ANOTHER account failed (e.g. a transfer to a missing account); v2 records it via on_transfer
  logs: string[];
  events: ZiEvent[];
  returnValue: unknown;            // decoded JSON return value of pay()/sweep(), e.g. "PAID"
  transfers: Array<{ to: string; yocto: bigint }>;   // Transfer actions sent BY the invoice account
  stateInitBase64: string | null;  // the UniversalStateInit raw bytes carried by the tx, if any
}

export function parseTxStatus(result: any, invoiceAccountId: string): ParsedTx {
  const failures: unknown[] = [];
  const downstreamFailures: unknown[] = [];
  if (result.status && 'Failure' in result.status) failures.push(result.status.Failure);
  for (const ro of result.receipts_outcome ?? []) {
    const st = ro.outcome?.status;
    if (st && typeof st === 'object' && 'Failure' in st) {
      // A Transfer to a nonexistent account fails ON that account; the invoice contract (v2) sees it in on_transfer and the money bounces back.
      const executor = ro.outcome?.executor_id;
      (executor === undefined || executor === invoiceAccountId ? failures : downstreamFailures).push(st.Failure);
    }
  }
  const logs: string[] = (result.receipts_outcome ?? []).flatMap((ro: any) => ro.outcome?.logs ?? []);
  const events: ZiEvent[] = [];
  for (const l of logs) {
    if (!l.startsWith('EVENT_JSON:')) continue;
    try { const e = JSON.parse(l.slice('EVENT_JSON:'.length)); if (e.standard === 'zeroinit') events.push(e); } catch { /* ignore foreign logs */ }
  }
  let returnValue: unknown = null;
  const sv = result.status?.SuccessValue;
  if (typeof sv === 'string' && sv.length > 0) {
    const txt = Buffer.from(sv, 'base64').toString('utf8');
    try { returnValue = JSON.parse(txt); } catch { returnValue = txt; }
  }
  const transfers: Array<{ to: string; yocto: bigint }> = [];
  for (const r of result.receipts ?? []) {
    if (r.predecessor_id !== invoiceAccountId) continue;
    for (const a of r.receipt?.Action?.actions ?? []) if (a.Transfer) transfers.push({ to: r.receiver_id, yocto: BigInt(a.Transfer.deposit) });
  }
  let stateInitBase64: string | null = null;
  for (const a of result.transaction?.actions ?? []) if (a && typeof a === 'object' && a.UniversalStateInit) stateInitBase64 = a.UniversalStateInit.state_init;
  return { txHash: result.transaction?.hash ?? '', receiverId: result.transaction?.receiver_id ?? '', success: failures.length === 0 && !('Failure' in (result.status ?? {})),
    failures, downstreamFailures, logs, events, returnValue, transfers, stateInitBase64 };
}
