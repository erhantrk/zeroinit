// zi — ZeroInit CLI (INTERFACES.md §7). Run: node src/cli.ts <command> [flags]
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNear, formatNear, utf8 } from './bytes.ts';
import { invoiceStateBytes } from './stateinit.ts';
import { actFunctionCall } from './tx.ts';
import { loadConfig, trustedCodeHash, type Config, type Signer } from './config.ts';
import { checkNetwork, viewAccount, viewInvoice, setRecordInvoice, recordInvoiceDoc, rpcCall } from './rpc.ts';
import { sendActions } from './send.ts';
import { createInvoiceDoc, loadDoc, saveDoc, checkDoc, assertDocTrusted, assertAccountsUsable, stateInitAction, termsMatchOnchain, randomSalt, type InvoiceDoc } from './invoice.ts';
import { runVectors } from './vectors.ts';
import { replayFixture } from './replay.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';

const GAS_50T = 50_000_000_000_000n;
class UsageError extends Error {}

function out(json: boolean, obj: unknown, lines: string[]): void {
  if (json) console.log(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  else for (const l of lines) console.log(l);
}

function parseExpiry(inStr?: string, atStr?: string): bigint {
  let ms: number;
  if (atStr) {
    ms = Date.parse(atStr);
    if (Number.isNaN(ms)) throw new UsageError('bad --expires-at');
  } else {
    const m = /^(\d+)([hm])$/.exec(inStr ?? '');
    if (!m) throw new UsageError('need --expires-in <N>h|<N>m or --expires-at <ISO>');
    ms = Date.now() + Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 60_000);
  }
  if (!Number.isSafeInteger(ms) || ms <= Date.now()) throw new UsageError('the expiry must be in the future');
  return BigInt(ms);
}

function parseSalt(s: string): bigint {
  if (!/^\d+$/.test(s) || BigInt(s) >= 1n << 64n) throw new UsageError('--salt must be an integer in 0..2^64-1');
  return BigInt(s);
}

function need(s: Signer | null, who: string): Signer {
  if (!s) throw new UsageError(`set ZI_${who}_ACCOUNT and ZI_${who}_KEY`);
  return s;
}

function txLines(p: ParsedTx): string[] {
  const l = [`TX ${p.txHash}`, `RESULT ${p.success ? String(p.returnValue) : 'FAILED ' + JSON.stringify(p.failures)}`];
  for (const e of p.events) l.push(`EVENT ${e.event} ${JSON.stringify(e.data[0])}`);
  for (const t of p.transfers) l.push(`TRANSFER ${t.to} ${formatNear(t.yocto)}`);
  l.push(`LINK https://testnet.nearblocks.io/txns/${p.txHash}`);
  return l;
}

async function statusLine(cfg: Config, doc: InvoiceDoc, label?: string): Promise<{ line: string; obj: any }> {
  const s = await viewAccount(cfg, doc.account_id, label);
  if (s.kind === 'NONEXISTENT') return { line: 'STATE NONEXISTENT', obj: s };
  if (s.kind === 'UNINITIALIZED') return { line: `STATE UNINITIALIZED balance=${formatNear(s.amount)}`, obj: s };
  const inv = await viewInvoice(cfg, doc.account_id, label ? label.replace('view_account', 'get_invoice') : undefined);
  return { line: `STATE INITIALIZED status=${inv.status} paid_by=${inv.paid_by ?? 'null'} balance=${formatNear(s.amount)} storage=${s.storageUsage}`, obj: { ...s, invoice: inv } };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const KNOWN = ['vectors', 'replay', 'invoice', 'status', 'pay', 'init', 'sweep', 'verify', 'receipt', 'serve'];
  if (!cmd || !KNOWN.includes(cmd)) throw new UsageError(`unknown command ${cmd ?? '(none)'}. Commands: ${KNOWN.join(', ')}`);
  const { values: v, positionals: pos } = parseArgs({ args: cmd === 'invoice' ? rest.slice(1) : rest, allowPositionals: true, options: {
    id: { type: 'string' }, merchant: { type: 'string' }, 'tax-vault': { type: 'string' }, 'tax-bps': { type: 'string' },
    amount: { type: 'string' }, 'expires-in': { type: 'string' }, 'expires-at': { type: 'string' }, salt: { type: 'string' },
    scheme: { type: 'string' }, 'code-hash': { type: 'string' }, 'no-init': { type: 'boolean' }, offline: { type: 'boolean' },
    tx: { type: 'string' }, port: { type: 'string' }, json: { type: 'boolean' },
  } });
  const json = !!v.json;

  if (cmd === 'vectors') {
    const r = runVectors();
    out(json, r, r.map((x) => `${x.ok ? 'PASS' : 'FAIL'} ${x.name}`));
    return r.every((x) => x.ok) ? 0 : 1;
  }
  if (cmd === 'replay') {
    if (!pos[0]) throw new UsageError('usage: zi replay <fixture.json>');
    const r = replayFixture(pos[0], trustedCodeHash({ codeHashB58: process.env.ZI_CODE_HASH ?? null }));
    out(json, r, r.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.id}${c.detail ? ' ' + c.detail : ''}`));
    return r.length > 0 && r.every((c) => c.ok) ? 0 : 1;
  }

  const cfg = loadConfig();

  if (cmd === 'serve') {
    const { serve } = await import('./server.ts');
    await serve(cfg, Number(v.port ?? '8787'));
    return await new Promise<number>(() => {}); // runs until Ctrl-C
  }

  if (cmd === 'invoice') {
    if (rest[0] !== 'new') throw new UsageError('usage: zi invoice new --id … --merchant … --tax-vault … --tax-bps … --amount … --expires-in …');
    const codeHash = v['code-hash'] ?? trustedCodeHash(cfg);
    if (codeHash !== trustedCodeHash(cfg)) console.error(`WARNING code hash ${codeHash} is not the trusted hash ${trustedCodeHash(cfg)}: \`zi verify\` will FAIL this invoice unless ZI_CODE_HASH is set to it`);
    if (!v.id || !v.merchant || !v['tax-vault'] || !v['tax-bps'] || !v.amount) throw new UsageError('missing --id/--merchant/--tax-vault/--tax-bps/--amount');
    const scheme = (v.scheme ?? cfg.scheme) as '0u' | '0s';
    const terms = { invoice_id: v.id, merchant: v.merchant, tax_vault: v['tax-vault'], tax_bps: /^\d+$/.test(v['tax-bps']) ? Number(v['tax-bps']) : NaN,
      amount: parseNear(v.amount), expires_at_ms: parseExpiry(v['expires-in'], v['expires-at']), salt: v.salt !== undefined ? parseSalt(v.salt) : randomSalt() };
    invoiceStateBytes(terms); // validates
    if (!v.offline) { setRecordInvoice(null); await assertAccountsUsable(cfg, terms); }
    const doc = createInvoiceDoc(scheme, codeHash, terms);
    const file = saveDoc(cfg.invoiceDir, doc);
    recordInvoiceDoc(cfg, doc);
    out(json, doc, [`INVOICE ${doc.invoice_id}`, `ACCOUNT ${doc.account_id}`, `PAY ${doc.amount_near} NEAR before ${doc.expires_at_iso}`, `FILE ${file}`]);
    return 0;
  }

  const id = pos[0];
  if (!id) throw new UsageError(`usage: zi ${cmd} <INVOICE_ID>`);
  const doc = loadDoc(cfg.invoiceDir, id);
  setRecordInvoice(doc.invoice_id);

  if (cmd === 'verify') {
    const trusted = trustedCodeHash(cfg);
    const c = checkDoc(doc, trusted);
    const lines = [`${c.codeHashTrusted ? 'PASS' : 'FAIL'} code-hash-trusted ${doc.code_hash}${c.codeHashTrusted ? '' : ` (trusted ${trusted})`}`,
      `${c.idFromTerms ? 'PASS' : 'FAIL'} id-from-terms ${c.expectedId}`, `${c.rawFromTerms ? 'PASS' : 'FAIL'} raw-from-terms`,
      `${c.fieldsConsistent ? 'PASS' : 'FAIL'} doc-fields-from-terms`];
    let ok = c.codeHashTrusted && c.idFromTerms && c.rawFromTerms && c.fieldsConsistent;
    if (!v.offline) {
      await checkNetwork(cfg);
      const s = await viewAccount(cfg, doc.account_id);
      if (s.kind === 'INITIALIZED') {
        const codeOk = s.globalContractHash === trusted;   // the pinned hash, never the doc's own
        const inv = await viewInvoice(cfg, doc.account_id);
        const termsOk = termsMatchOnchain(doc, inv);
        const keys = await rpcCall(cfg, 'query', { request_type: 'view_access_key_list', finality: 'final', account_id: doc.account_id });
        const noKeys = !keys.error && Array.isArray(keys.result?.keys) && keys.result.keys.length === 0;
        lines.push(`${codeOk ? 'PASS' : 'FAIL'} code-hash-onchain ${s.globalContractHash}`, `${termsOk ? 'PASS' : 'FAIL'} terms-onchain`,
          `${noKeys ? 'PASS' : 'FAIL'} no-access-keys`, `INFO status=${inv.status}`);
        ok = ok && codeOk && termsOk && noKeys;
      } else lines.push(`INFO state=${s.kind}`);
    }
    out(json, { ok, lines }, lines);
    return ok ? 0 : 1;
  }
  if (cmd === 'status') {
    await checkNetwork(cfg);
    const s = await statusLine(cfg, doc);
    out(json, s.obj, [s.line]);
    return 0;
  }
  if (cmd === 'pay' || cmd === 'sweep' || cmd === 'init') {
    const trusted = trustedCodeHash(cfg);
    assertDocTrusted(doc, trusted);   // never sign for a doc whose terms/code hash/state init do not re-derive
    await checkNetwork(cfg);
    const signer = cmd === 'pay' ? need(cfg.payer, 'PAYER') : need(cfg.sweeper, 'SWEEPER');
    await statusLine(cfg, doc, cmd === 'pay' ? 'before: view_account' : 'transfer-path: view_account (uninitialized)');
    const actions: Uint8Array[] = [];
    if (!v['no-init']) actions.push(stateInitAction(doc, trusted));
    if (cmd === 'pay') actions.push(actFunctionCall('pay', utf8('{}'), GAS_50T, v.amount ? parseNear(v.amount) : BigInt(doc.amount_yocto)));
    if (cmd === 'sweep') actions.push(actFunctionCall('sweep', utf8('{}'), GAS_50T, 0n));
    const p = await sendActions(cfg, signer, doc.account_id, actions, cmd === 'init' ? 'init' : cmd);
    const after = await statusLine(cfg, doc, cmd === 'sweep' ? 'sweep-after: view_account' : 'after: view_account');
    out(json, { tx: p, after: after.obj }, [...txLines(p), after.line]);
    // pay() never panics on a bad payment: it refunds and returns REFUNDED_*. Only PAID is a payment.
    if (cmd === 'pay' && p.success && p.returnValue !== 'PAID') console.error(`NOT PAID: ${String(p.returnValue)} (the deposit was refunded)`);
    return p.success && (cmd !== 'pay' || p.returnValue === 'PAID') ? 0 : 1;
  }
  if (cmd === 'receipt') {
    await checkNetwork(cfg);
    const trusted = trustedCodeHash(cfg);
    const s = await viewAccount(cfg, doc.account_id);
    if (s.kind !== 'INITIALIZED') throw new Error(`invoice account is ${s.kind}; nothing to receipt yet`);
    const inv = await viewInvoice(cfg, doc.account_id);
    let events: unknown[] = []; let txHash: string | null = null;
    if (v.tx) {
      const signerGuess = inv.paid_by ?? cfg.sweeper?.accountId ?? doc.merchant;
      const st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: v.tx, sender_account_id: signerGuess, wait_until: 'FINAL' });
      if (st.error) throw new Error(`--tx ${v.tx}: tx_status lookup failed (signer guess ${signerGuess}): ${JSON.stringify(st.error)}`);
      const p = parseTxStatus(st.result, doc.account_id); events = p.events; txHash = p.txHash;
    }
    const c = checkDoc(doc, trusted);
    const checks = { id_matches_terms: c.idFromTerms && c.rawFromTerms && c.fieldsConsistent, code_hash_matches: c.codeHashTrusted && s.globalContractHash === trusted,
      terms_match_onchain: termsMatchOnchain(doc, inv), status: inv.status };
    const failed = [!checks.id_matches_terms && 'id_matches_terms', !checks.code_hash_matches && 'code_hash_matches', !checks.terms_match_onchain && 'terms_match_onchain',
      inv.status !== 'PAID' && `status (${inv.status}, not PAID)`].filter(Boolean) as string[];
    if (failed.length) {
      const lines = failed.map((f) => `FAIL ${f}`);
      out(json, { ok: false, failed, checks }, [...lines, 'no receipt written']);
      return 1;
    }
    const receipt = { format: 'zeroinit-receipt/1', invoice: doc, onchain: inv,
      account: { amount: s.amount.toString(), storage_usage: s.storageUsage, global_contract_hash: s.globalContractHash },
      tx_hash: txHash, events, checks, generated_at_iso: new Date().toISOString() };
    const file = join(cfg.invoiceDir, `${doc.invoice_id}.receipt.json`);
    writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    const tax = BigInt(inv.tax_amount);
    out(json, receipt, [`RECEIPT ${file}`, '', `| Field | Value |`, `|---|---|`, `| Invoice | ${doc.invoice_id} |`, `| Address | ${doc.account_id} |`,
      `| Status | ${inv.status} |`, `| Paid by | ${inv.paid_by ?? '(plain transfer)'} |`, `| Paid | ${formatNear(BigInt(inv.paid_amount))} NEAR |`,
      `| Merchant got | ${formatNear(BigInt(inv.paid_amount) - tax)} NEAR → ${doc.merchant} |`, `| Tax | ${formatNear(tax)} NEAR → ${doc.tax_vault} |`]);
    return 0;
  }
  throw new UsageError(`unhandled command ${cmd}`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  console.error(`ERROR ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
