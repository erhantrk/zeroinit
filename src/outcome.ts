// Parse EXPERIMENTAL_tx_status results (INTERFACES.md §9; v3 additions in docs/STABLECOIN.md §10).
export interface ZiEvent { standard: string; version: string; event: string; data: Array<Record<string, unknown>> }
export interface FtTransfer { token: string; to: string; amount: bigint }
export interface ParsedTx {
  txHash: string;
  receiverId: string;
  success: boolean;
  failures: unknown[];             // the tx itself, or a receipt run on the invoice account, failed (pay()/sweep() panicked)
  downstreamFailures: unknown[];   // a receipt run on ANOTHER account failed (e.g. a transfer to a missing account); the contract records it
  logs: string[];
  events: ZiEvent[];
  returnValue: unknown;            // decoded JSON return value, e.g. "PAID"; for ft_transfer_call the amount USED (NEP-141: sent minus what the token refunded; "0" when everything came back)
  transfers: Array<{ to: string; yocto: bigint }>;   // Transfer actions sent BY the invoice account
  ftTransfers: FtTransfer[];       // ft_transfer calls sent BY the invoice account (the token contract is the receiver)
  nep141Events: Array<Record<string, unknown>>;      // the token's own EVENT_JSON (standard "nep141")
  stateInitBase64: string | null;  // the UniversalStateInit raw bytes carried by the tx, if any
}

function decodeActionArgs(a: any): { receiver_id?: string; amount?: string } | null {
  if (!a || typeof a !== 'object') return null;
  const fc = a.FunctionCall;
  if (!fc || fc.method_name !== 'ft_transfer') return null;
  try {
    const text = Buffer.from(String(fc.args ?? ''), 'base64').toString('utf8');
    const v = JSON.parse(text);
    return typeof v?.receiver_id === 'string' && typeof v?.amount === 'string' ? v : null;
  } catch { return null; }
}

export function parseTxStatus(result: any, invoiceAccountId: string): ParsedTx {
  const failures: unknown[] = [];
  const downstreamFailures: unknown[] = [];
  if (result.status && 'Failure' in result.status) failures.push(result.status.Failure);
  for (const ro of result.receipts_outcome ?? []) {
    const st = ro.outcome?.status;
    if (st && typeof st === 'object' && 'Failure' in st) {
      // A Transfer to a nonexistent account fails ON that account; the invoice contract sees it in on_settled.
      const executor = ro.outcome?.executor_id;
      (executor === undefined || executor === invoiceAccountId ? failures : downstreamFailures).push(st.Failure);
    }
  }
  const logs: string[] = (result.receipts_outcome ?? []).flatMap((ro: any) => ro.outcome?.logs ?? []);
  const events: ZiEvent[] = [];
  const nep141Events: Array<Record<string, unknown>> = [];
  for (const ro of result.receipts_outcome ?? []) {
    // A zeroinit event only counts when the invoice account emitted it: any other contract can log a look-alike EVENT_JSON.
    const executor = ro.outcome?.executor_id;
    const fromInvoice = executor === undefined || executor === invoiceAccountId;
    for (const l of ro.outcome?.logs ?? []) {
      if (typeof l !== 'string' || !l.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(l.slice('EVENT_JSON:'.length));
        if (e.standard === 'zeroinit' && fromInvoice) events.push(e);
        else if (e.standard === 'nep141') nep141Events.push(e);
      } catch { /* ignore foreign logs */ }
    }
  }
  let returnValue: unknown = null;
  const sv = result.status?.SuccessValue;
  if (typeof sv === 'string' && sv.length > 0) {
    const txt = Buffer.from(sv, 'base64').toString('utf8');
    try { returnValue = JSON.parse(txt); } catch { returnValue = txt; }
  }
  const transfers: Array<{ to: string; yocto: bigint }> = [];
  const ftTransfers: FtTransfer[] = [];
  for (const r of result.receipts ?? []) {
    if (r.predecessor_id !== invoiceAccountId) continue;
    for (const a of r.receipt?.Action?.actions ?? []) {
      if (a.Transfer) transfers.push({ to: r.receiver_id, yocto: BigInt(a.Transfer.deposit) });
      const ft = decodeActionArgs(a);
      if (ft && ft.receiver_id !== undefined && ft.amount !== undefined) ftTransfers.push({ token: r.receiver_id, to: ft.receiver_id, amount: BigInt(ft.amount) });
    }
  }
  let stateInitBase64: string | null = null;
  for (const a of result.transaction?.actions ?? []) {
    if (a && typeof a === 'object' && a.UniversalStateInit) stateInitBase64 = a.UniversalStateInit.state_init;
  }
  return { txHash: result.transaction?.hash ?? '', receiverId: result.transaction?.receiver_id ?? '',
    success: failures.length === 0 && !('Failure' in (result.status ?? {})),
    failures, downstreamFailures, logs, events, returnValue, transfers, ftTransfers, nep141Events, stateInitBase64 };
}
