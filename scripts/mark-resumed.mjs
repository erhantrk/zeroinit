// Marks an invoice in a fixture as "resumed": it was created and paid in an earlier recording, and this fixture only adds a later step
// (the L3 sweep of LATE-V3). Copies the invoice document into the fixture and lists it in `resumed` (src/replay-v3.ts reads it).
// Usage: node scripts/mark-resumed.mjs <fixture.json> <invoice-doc.json>
import { readFileSync, writeFileSync } from 'node:fs';
const [fixture, docPath] = process.argv.slice(2);
const f = JSON.parse(readFileSync(fixture, 'utf8'));
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
f.invoices = f.invoices.filter((d) => d.invoice_id !== doc.invoice_id).concat([doc]);
f.resumed = [...new Set([...(f.resumed ?? []), doc.invoice_id])];
writeFileSync(fixture, JSON.stringify(f, null, 2) + '\n');
console.log(`marked ${doc.invoice_id} as resumed in ${fixture}`);
