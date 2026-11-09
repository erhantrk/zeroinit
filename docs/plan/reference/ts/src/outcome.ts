// Parse EXPERIMENTAL_tx_status results (INTERFACES.md §9).
export interface ZiEvent { standard: string; version: string; event: string; data: Array<Record<string, unknown>> }
export interface ParsedTx {
  txHash: string;
  receiverId: string;
  success: boolean;
  failures: unknown[];
  logs: string[];
  events: ZiEvent[];
  returnValue: unknown;            // decoded JSON return value of pay()/sweep(), e.g. "PAID"
  transfers: Array<{ to: string; yocto: bigint }>;   // Transfer actions sent BY the invoice account
  stateInitBase64: string | null;  // the UniversalStateInit raw bytes carried by the tx, if any
}

export function parseTxStatus(result: any, invoiceAccountId: string): ParsedTx {
  const failures: unknown[] = [];
  if (result.status && 'Failure' in result.status) failures.push(result.status.Failure);
  for (const ro of result.receipts_outcome ?? []) {
    const st = ro.outcome?.status;
    if (st && typeof st === 'object' && 'Failure' in st) failures.push(st.Failure);
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
    failures, logs, events, returnValue, transfers, stateInitBase64 };
}
