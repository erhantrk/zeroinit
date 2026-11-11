export const FORM_FIELDS = ['id', 'merchant', 'tax_vault', 'tax_bps', 'asset', 'amount', 'expires_in_minutes', 'payout_grace_ms'];

/** Every value a badge can show. The label also becomes a CSS class, so anything else (a hostile get_invoice answer) is UNKNOWN. */
const BADGES = ['NONEXISTENT', 'UNINITIALIZED', 'OPEN', 'PAID', 'EXPIRED', 'SETTLING', 'REFUNDED', 'LOADING', 'ERROR', 'UNVERIFIED', 'UNKNOWN'];
export function badgeLabel(status) {
  if (!status) return 'LOADING';                 // not fetched yet (the list is drawn before the statuses arrive)
  if (status.error || !status.state) return 'ERROR'; // e.g. an RPC rate limit; the log shows the error
  const label = status.state === 'INITIALIZED' && status.invoice ? status.invoice.status : status.state;
  return BADGES.includes(label) ? label : 'UNKNOWN';
}

/** HTML-escape a value from an invoice file or an RPC answer before it goes into innerHTML. */
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
}

/** One invoice row for the list. Every dynamic value is escaped; the id is only ever read back through dataset.id. */
export function rowHtml({ doc: d, status, label }) {
  return `<p><a href="#" data-id="${escapeHtml(d.invoice_id)}">${escapeHtml(d.invoice_id)}</a> <span class="badge ${escapeHtml(label)}">${escapeHtml(label)}</span>`
    + `<br><code>${escapeHtml(d.account_id)}</code><br>${escapeHtml(amountLabel(d, status))}`
    + `${status && status.reason ? `<br><small>${escapeHtml(status.reason)}</small>` : ''}</p>`;
}
/** The selected-invoice header of the payer card. */
export function selectedHtml(sel) {
  return `<p><b>${escapeHtml(sel.id)}</b>: pay <b>${escapeHtml(sel.amountLabel)}</b> to<br><code>${escapeHtml(sel.accountId)}</code></p>`;
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
  if (status && status.token_balance_error) s += ' (token balance unknown)';   // a failed view is not a zero balance
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
