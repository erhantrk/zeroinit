import { FORM_FIELDS, formBody, invoiceRows, rowHtml, selectedHtml, selection } from '/state.js';
const $ = (id) => document.getElementById(id);
let selected = null;
const log = (o) => { $('log').textContent = JSON.stringify(o, null, 2) + '\n' + $('log').textContent; };
// POSTs need the per-run token from the OPEN url's #fragment (printed by `zi serve`); a fragment is never sent to the server.
const m = /zi_token=([0-9a-f]+)/.exec(location.hash);
if (m) { sessionStorage.setItem('zi_token', m[1]); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('zi_token') ?? '';
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-zi-token': token }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// Last known status per invoice: a refresh keeps showing it until the new one arrives (no flash back to LOADING).
const known = new Map();
let busy = false, again = false;
async function refresh() {
  if (busy) { again = true; return; }   // never overlap refreshes; one more runs after the current one
  busy = true; $('refresh').disabled = true; $('refreshing').textContent = 'checking testnet…';
  try { await refreshOnce(); } finally { busy = false; $('refresh').disabled = false; $('refreshing').textContent = ''; }
  if (again) { again = false; refresh(); }
}
async function refreshOnce() {
  const docs = await api('GET', '/api/invoices');
  if (!Array.isArray(docs)) { log({ error: 'GET /api/invoices did not return a list', response: docs }); return; }
  const statuses = docs.map((d) => known.get(d.invoice_id));
  const draw = () => {
    const rows = invoiceRows(docs, statuses);
    $('invoices').innerHTML = rows.map(rowHtml).join('');   // every value is escaped: invoice files are untrusted input
    document.querySelectorAll('[data-id]').forEach((a) => a.onclick = (e) => { e.preventDefault(); select(a.dataset.id, rows); });
    if (selected) select(selected, rows);
  };
  draw();   // the list shows at once; each badge fills in when its status arrives
  // At most 4 status lookups at a time: each one is 1-2 RPC calls, and a burst of ~60 makes public testnet RPCs answer 429.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, docs.length) }, async () => {
    while (next < docs.length) { const i = next++; statuses[i] = await api('GET', `/api/invoices/${docs[i].invoice_id}/status`); known.set(docs[i].invoice_id, statuses[i]); draw(); }
  }));
}
function select(id, rows) {
  selected = id;
  const row = selection(rows, id);
  if (!row) return;
  $('selected').innerHTML = selectedHtml(row);
  for (const b of ['pay', 'plain', 'sweep', 'refund']) $(b).disabled = false;
}
$('create').onclick = async () => {
  const values = Object.fromEntries(FORM_FIELDS.map((k) => [k, $(k).value]));
  log(await api('POST', '/api/invoices', formBody(values))); refresh();
};
for (const action of ['pay', 'plain', 'sweep', 'refund']) {
  $(action).onclick = async () => { log(await api('POST', `/api/invoices/${selected}/${action}`, {})); refresh(); };
}
$('refresh').onclick = () => refresh();
// No polling: statuses load once when the page opens, after each action, and when Refresh is clicked
// (each status is ~2 RPC calls; polling every few seconds got public testnet RPCs to answer 429).
refresh();
