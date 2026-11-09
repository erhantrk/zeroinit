export const FORM_FIELDS = ['id', 'merchant', 'tax_vault', 'tax_bps', 'amount_near', 'expires_in_minutes'];

export function badgeLabel(status) {
  return status.state === 'INITIALIZED' && status.invoice ? status.invoice.status : status.state;
}

export function invoiceRows(docs, statuses) {
  return docs.map((doc, i) => ({ doc, status: statuses[i], label: badgeLabel(statuses[i]) }));
}

export function formBody(values) {
  return Object.fromEntries(FORM_FIELDS.map((k) => [k, values[k]]));
}

export function selection(rows, id) {
  const row = rows.find((r) => r.doc.invoice_id === id);
  if (!row) return null;
  return { id, amountNear: row.doc.amount_near, accountId: row.doc.account_id, label: row.label };
}
