export const FORM_FIELDS = ['id', 'merchant', 'tax_vault', 'tax_bps', 'asset', 'amount', 'expires_in_minutes', 'payout_grace_ms'];

export function badgeLabel(status) {
  if (!status) return 'LOADING';                 // not fetched yet (the list is drawn before the statuses arrive)
  if (status.error || !status.state) return 'ERROR'; // e.g. an RPC rate limit; the log shows the error
  return status.state === 'INITIALIZED' && status.invoice ? status.invoice.status : status.state;
}

/** Raw u128 -> canonical display amount (no floating point). */
export function formatRaw(raw, decimals) {
  try {
    let v = BigInt(String(raw));
    if (v < 0n) return String(raw);
    const d = 10n ** BigInt(decimals);
    const whole = v / d;
    const frac = (v % d).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch { return String(raw); }
}

export function invoiceRows(docs, statuses) {
  return docs.map((doc, i) => ({ doc, status: statuses[i], label: badgeLabel(statuses[i]) }));
}

/** "1.5 tUSDC", plus the parked token balance while the NEAR account does not exist yet. */
export function amountLabel(doc, status) {
  const amount = doc.amount_display ?? doc.amount_near ?? '?';
  const unit = doc.unit ?? 'NEAR';
  let s = `${amount} ${unit}`;
  const parked = status && status.token_balance_raw && BigInt(status.token_balance_raw) > 0n;
  if (parked && status.state !== 'INITIALIZED') s += ` (${formatRaw(status.token_balance_raw, status.token_decimals ?? 6)} ${status.token_symbol ?? unit} parked)`;
  return s;
}

export function formBody(values) {
  return Object.fromEntries(FORM_FIELDS.map((k) => [k, values[k]]));
}

export function selection(rows, id) {
  const row = rows.find((r) => r.doc.invoice_id === id);
  if (!row) return null;
  return { id, amountDisplay: row.doc.amount_display ?? row.doc.amount_near, unit: row.doc.unit ?? 'NEAR',
    amountLabel: amountLabel(row.doc, row.status), accountId: row.doc.account_id, label: row.label };
}
