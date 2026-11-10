// zi — ZeroInit CLI (INTERFACES.md §7; docs/STABLECOIN.md §10 for v3).
// Run: node src/cli.ts <command> [flags]
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNear, formatNear, utf8 } from './bytes.ts';
import { invoiceStateBytes } from './stateinit.ts';
import { actFunctionCall } from './tx.ts';
import { loadConfig, trustedCodeHash, pinForVerification, deploymentLabel, deploymentOf, fixesParkedFunds, tokenBySymbol, type Config, type Signer, type AllowedToken } from './config.ts';
import { checkNetwork, viewAccount, viewInvoice, setRecordInvoice, recordInvoiceDoc, rpcCall } from './rpc.ts';
import { sendActions } from './send.ts';
import { createInvoiceDoc, loadDoc, saveDoc, checkDoc, assertDocTrusted, assertAccountsUsable, stateInitAction, termsMatchOnchain, randomSalt,
  isV3Doc, docAmountRaw, docAmountDisplay, docToken, docUnit, docDecimals, GRACE_DEFAULT_MS, GRACE_MIN_MS, GRACE_MAX_MS, type InvoiceDoc } from './invoice.ts';
import { runVectors } from './vectors.ts';
import { replayFixture, fixturePin } from './replay.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';
import { GAS, FLOAT_YOCTO, actFund, actFtTransfer, actFtTransferCall, actStorageDeposit, payMsg, parseUnits, formatUnits,
  ftBalanceOf, ftMetadata, storageBalanceBounds, storageBalanceOf } from './ft.ts';

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

/** --grace <N>ms|<N>s|<N>m|<N>h|<N>d, default 7 days; the contract's range is 1 minute to 365 days. */
function parseGrace(s?: string): bigint {
  if (s === undefined) return GRACE_DEFAULT_MS;
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(s);
  if (!m) throw new UsageError('--grace needs a unit: 60000ms, 3600s, 30m, 2h or 7d');
  const n = BigInt(m[1]);
  const ms = n * (m[2] === 'ms' ? 1n : m[2] === 's' ? 1000n : m[2] === 'm' ? 60_000n : m[2] === 'h' ? 3_600_000n : 86_400_000n);
  if (ms < GRACE_MIN_MS || ms > GRACE_MAX_MS) throw new UsageError(`--grace must be between ${GRACE_MIN_MS} and ${GRACE_MAX_MS} ms`);
  return ms;
}

function need(s: Signer | null, who: string): Signer {
  if (!s) throw new UsageError(`set ZI_${who}_ACCOUNT and ZI_${who}_KEY`);
  return s;
}

function txLines(p: ParsedTx, decimals = 24, unit = 'NEAR'): string[] {
  const l = [`TX ${p.txHash}`, `RESULT ${p.success ? (typeof p.returnValue === 'object' && p.returnValue !== null ? JSON.stringify(p.returnValue) : String(p.returnValue)) : 'FAILED ' + JSON.stringify(p.failures)}`];
  for (const e of p.events) l.push(`EVENT ${e.event} ${JSON.stringify(e.data[0])}`);
  for (const t of p.transfers) l.push(`TRANSFER ${t.to} ${formatNear(t.yocto)}`);
  for (const t of p.ftTransfers) l.push(`FT_TRANSFER ${t.to} ${formatUnits(t.amount, decimals)} ${unit} (${t.token})`);
  for (const f of p.downstreamFailures) l.push(`TRANSFER_FAILED ${JSON.stringify(f)}`);
  l.push(`LINK https://testnet.nearblocks.io/txns/${p.txHash}`);
  return l;
}

function tokenForDoc(cfg: Config, doc: InvoiceDoc): AllowedToken {
  const symbol = isV3Doc(doc) && doc.asset.kind === 'ft' ? doc.asset.symbol : null;
  const contract = docToken(doc);
  if (!symbol || !contract) throw new UsageError(`invoice ${doc.invoice_id} is a NEAR invoice`);
  const entry = tokenBySymbol(cfg.allowedTokens, symbol);
  if (!entry || entry.accountId !== contract) {
    throw new UsageError(`token ${symbol} ${contract} is not on this client's allow-list${cfg.allowedTokens.length ? '' : ' (set ZI_TUSDC_ACCOUNT)'}: refusing to pay it`);
  }
  return entry;
}

function tokenFromArg(cfg: Config, explicit: string | undefined, doc: InvoiceDoc | null): AllowedToken {
  if (explicit) {
    const t = tokenBySymbol(cfg.allowedTokens, explicit);
    if (!t) throw new UsageError(cfg.allowedTokens.length ? `unknown token ${explicit} (allow-list: ${cfg.allowedTokens.map((x) => x.symbol).join(', ')})` : `no token is configured: set ZI_TUSDC_ACCOUNT (the allow-list is empty)`);
    return t;
  }
  if (doc && docToken(doc)) return tokenForDoc(cfg, doc);
  if (cfg.allowedTokens.length === 1) return cfg.allowedTokens[0];
  throw new UsageError('need --token <symbol> (the allow-list has no single default)');
}

/** An account id or an invoice id: invoice ids resolve to the invoice's `0u` account. */
function resolveTarget(cfg: Config, target: string): { account: string; doc: InvoiceDoc | null } {
  try { const doc = loadDoc(cfg.invoiceDir, target); return { account: doc.account_id, doc }; } catch { return { account: target, doc: null }; }
}

/** Parse a failure's JSON for a contract panic message. */
function failureText(p: ParsedTx): string {
  return JSON.stringify(p.failures);
}

async function statusLine(cfg: Config, doc: InvoiceDoc, label?: string): Promise<{ line: string; obj: any }> {
  const s = await viewAccount(cfg, doc.account_id, label);
  const token = docToken(doc);
  const unit = docUnit(doc);
  const dec = docDecimals(doc);
  const tokens = token === null ? 0n : await ftBalanceOf(cfg, token, doc.account_id).catch(() => 0n);
  const parked = tokens > 0n ? ` tokens_parked=${formatUnits(tokens, dec)} ${unit}` : '';
  if (s.kind === 'NONEXISTENT') return { line: `STATE NONEXISTENT${parked}`.trim(), obj: { ...s, token_balance_raw: tokens.toString() } };
  if (s.kind === 'UNINITIALIZED') return { line: `STATE UNINITIALIZED balance=${formatNear(s.amount)}${parked}`, obj: { ...s, token_balance_raw: tokens.toString() } };
  const inv = await viewInvoice(cfg, doc.account_id, label ? label.replace('view_account', 'get_invoice') : undefined);
  const extra = token === null ? ''
    : ` tokens=${formatUnits(tokens, dec)} ${unit} owed_merchant=${formatUnits(BigInt(inv.owed_merchant ?? '0'), dec)} owed_tax=${formatUnits(BigInt(inv.owed_tax ?? '0'), dec)} owed_payer=${formatUnits(BigInt(inv.owed_payer ?? '0'), dec)}`;
  return { line: `STATE INITIALIZED status=${inv.status} paid_by=${inv.paid_by ?? 'null'} balance=${formatNear(s.amount)} storage=${s.storageUsage}${extra}`,
    obj: { ...s, token_balance_raw: tokens.toString(), invoice: inv } };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const KNOWN = ['vectors', 'replay', 'invoice', 'status', 'pay', 'init', 'sweep', 'verify', 'receipt', 'serve', 'token', 'refund-payer'];
  if (!cmd || !KNOWN.includes(cmd)) throw new UsageError(`unknown command ${cmd ?? '(none)'}. Commands: ${KNOWN.join(', ')}`);
  const args = cmd === 'invoice' ? rest.slice(1) : cmd === 'token' ? rest.slice(1) : rest;
  const { values: v, positionals: pos } = parseArgs({ args, allowPositionals: true, options: {
    id: { type: 'string' }, merchant: { type: 'string' }, 'tax-vault': { type: 'string' }, 'tax-bps': { type: 'string' },
    amount: { type: 'string' }, 'expires-in': { type: 'string' }, 'expires-at': { type: 'string' }, salt: { type: 'string' },
    scheme: { type: 'string' }, 'code-hash': { type: 'string' }, layout: { type: 'string' }, token: { type: 'string' }, grace: { type: 'string' },
    'no-init': { type: 'boolean' }, offline: { type: 'boolean' }, 'allow-parked': { type: 'boolean' }, plain: { type: 'boolean' },
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
    const pin = fixturePin(pos[0], trustedCodeHash({ codeHashB58: process.env.ZI_CODE_HASH ?? null }));
    const r = replayFixture(pos[0], pin);
    out(json, r, [`INFO deployment ${deploymentLabel(pin)} ${pin}`, ...r.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.id}${c.detail ? ' ' + c.detail : ''}`)]);
    return r.length > 0 && r.every((c) => c.ok) ? 0 : 1;
  }

  const cfg = loadConfig();

  if (cmd === 'serve') {
    const { serve } = await import('./server.ts');
    await serve(cfg, Number(v.port ?? '8787'));
    return await new Promise<number>(() => {}); // runs until Ctrl-C
  }

  if (cmd === 'token') {
    const sub = rest[0];
    if (sub !== 'register' && sub !== 'balance') throw new UsageError('usage: zi token register <account|invoice id> [--token tUSDC] | zi token balance <account|invoice id> [--token tUSDC]');
    const target = rest[1];
    if (!target) throw new UsageError(`usage: zi token ${sub} <account|invoice id> [--token tUSDC]`);
    const { account, doc } = resolveTarget(cfg, target);
    const entry = tokenFromArg(cfg, v.token, doc);
    await checkNetwork(cfg);
    if (sub === 'balance') {
      const bal = await ftBalanceOf(cfg, entry.accountId, account);
      out(json, { account, token: entry.accountId, symbol: entry.symbol, balance_raw: bal.toString(), balance: formatUnits(bal, entry.decimals) },
        [`BALANCE ${formatUnits(bal, entry.decimals)} ${entry.symbol} ${account} (token ${entry.accountId})`]);
      return 0;
    }
    const bounds = await storageBalanceBounds(cfg, entry.accountId);
    const signer = need(cfg.payer, 'PAYER');
    // A NEP-145 balance can be created for any account id, including a `0u` id that NEAR does not know yet.
    const existing = await storageBalanceOf(cfg, entry.accountId, account);
    const p = await sendActions(cfg, signer, entry.accountId, [actStorageDeposit(account, bounds.min)], 'token-register');
    out(json, p, [`REGISTER ${account} on ${entry.accountId} (storage deposit ${formatNear(bounds.min)} NEAR; it was ${existing ? 'already registered' : 'not registered'})`, ...txLines(p)]);
    return p.success ? 0 : 1;
  }

  if (cmd === 'invoice') {
    if (rest[0] !== 'new') throw new UsageError('usage: zi invoice new --id … --merchant … --tax-vault … --tax-bps … --amount … --expires-in … [--token tUSDC]');
    const codeHash = v['code-hash'] ?? trustedCodeHash(cfg);
    if (codeHash !== trustedCodeHash(cfg)) console.error(`WARNING code hash ${codeHash} is not the trusted hash ${trustedCodeHash(cfg)}: \`zi verify\` will FAIL this invoice unless ZI_CODE_HASH is set to it`);
    if (!v.id || !v.merchant || !v['tax-vault'] || !v['tax-bps'] || !v.amount) throw new UsageError('missing --id/--merchant/--tax-vault/--tax-bps/--amount');
    const scheme = (v.scheme ?? cfg.scheme) as '0u' | '0s';
    const dep = deploymentOf(codeHash);
    const layoutFlag = v.layout === undefined ? null : Number(v.layout);
    if (layoutFlag !== null && layoutFlag !== 1 && layoutFlag !== 3) throw new UsageError('--layout must be 1 or 3');
    const layout = (layoutFlag ?? (dep?.version === 'v3' ? 3 : 1)) as 1 | 3;
    const tokenEntry = v.token ? tokenBySymbol(cfg.allowedTokens, v.token) : null;
    if (v.token && !tokenEntry) {
      throw new UsageError(cfg.allowedTokens.length
        ? `unknown token ${v.token} (allow-list: ${cfg.allowedTokens.map((x) => x.symbol).join(', ')})`
        : 'token invoices need ZI_TUSDC_ACCOUNT (the allow-list is empty): the token account is a public id, see docs/STABLECOIN.md §2');
    }
    if (tokenEntry && layout !== 3) throw new UsageError('token invoices need the v3 layout (--layout 3, or a trusted v3 deployment)');
    if (v.grace !== undefined && layout !== 3) throw new UsageError('--grace only exists on v3 invoices');
    const amount = tokenEntry ? parseUnits(v.amount, tokenEntry.decimals) : parseNear(v.amount);
    const terms = { invoice_id: v.id, merchant: v.merchant, tax_vault: v['tax-vault'], tax_bps: /^\d+$/.test(v['tax-bps']) ? Number(v['tax-bps']) : NaN,
      amount, expires_at_ms: parseExpiry(v['expires-in'], v['expires-at']), salt: v.salt !== undefined ? parseSalt(v.salt) : randomSalt(),
      layout, grace_ms: layout === 3 ? parseGrace(v.grace) : undefined,
      token: tokenEntry?.accountId ?? null, token_symbol: tokenEntry?.symbol, token_decimals: tokenEntry?.decimals };
    invoiceStateBytes(terms); // validates
    if (!v.offline) {
      setRecordInvoice(null);
      await assertAccountsUsable(cfg, { merchant: terms.merchant, tax_vault: terms.tax_vault, token: terms.token,
        token_symbol: terms.token_symbol, token_decimals: terms.token_decimals });
    }
    const doc = createInvoiceDoc(scheme, codeHash, terms);
    const file = saveDoc(cfg.invoiceDir, doc);
    recordInvoiceDoc(cfg, doc);
    out(json, doc, [`INVOICE ${doc.invoice_id}`, `ACCOUNT ${doc.account_id}`, `PAY ${docAmountDisplay(doc)} ${docUnit(doc)} before ${doc.expires_at_iso}`, `FILE ${file}`]);
    return 0;
  }

  const id = pos[0];
  if (!id) throw new UsageError(`usage: zi ${cmd} <INVOICE_ID>`);
  const doc = loadDoc(cfg.invoiceDir, id);
  setRecordInvoice(doc.invoice_id);

  if (cmd === 'verify') {
    const trusted = pinForVerification(trustedCodeHash(cfg), doc.code_hash);   // v1/v2 history docs verify against their own hash (read-only); the rest against the trusted hash
    const c = checkDoc(doc, trusted, cfg.allowedTokens);
    const token = docToken(doc);
    const entry = token ? tokenBySymbol(cfg.allowedTokens, isV3Doc(doc) && doc.asset.kind === 'ft' ? doc.asset.symbol : '') : null;
    const tokenAllowed = token === null || (entry !== null && entry.accountId === token);
    const lines = [`${c.codeHashTrusted ? 'PASS' : 'FAIL'} code-hash-trusted ${doc.code_hash}${c.codeHashTrusted ? '' : ` (trusted ${trusted})`}`,
      `INFO deployment ${c.codeHashTrusted ? deploymentLabel(trusted) : 'none: the invoice uses a code hash that is not trusted'}`,
      `${c.formatMatchesDeployment ? 'PASS' : 'FAIL'} format-matches-deployment ${doc.format}`,
      `${c.idFromTerms ? 'PASS' : 'FAIL'} id-from-terms ${c.expectedId}`, `${c.rawFromTerms ? 'PASS' : 'FAIL'} raw-from-terms`,
      `${c.fieldsConsistent ? 'PASS' : 'FAIL'} doc-fields-from-terms`];
    if (token !== null) lines.push(`${tokenAllowed ? 'PASS' : 'FAIL'} token-allowed ${docUnit(doc)} ${token}${tokenAllowed ? '' : ' (set ZI_TUSDC_ACCOUNT / use a token on the allow-list)'}`);
    let ok = c.codeHashTrusted && c.formatMatchesDeployment && c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && tokenAllowed;
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
        if (token !== null && entry) {
          try {
            const meta = await ftMetadata(cfg, token);
            const metaOk = meta.symbol === entry.symbol && meta.decimals === entry.decimals;
            lines.push(`${metaOk ? 'PASS' : 'FAIL'} token-metadata-onchain ${meta.symbol} ${meta.decimals}`);
            ok = ok && metaOk;
          } catch (e) {
            lines.push(`FAIL token-metadata-onchain ${e instanceof Error ? e.message : String(e)}`);
            ok = false;
          }
        }
        if (token !== null && entry) {
          const bal = await ftBalanceOf(cfg, token, doc.account_id);
          lines.push(`INFO token-balance ${formatUnits(bal, entry.decimals)} ${entry.symbol}`);
        }
        ok = ok && codeOk && termsOk && noKeys;
      } else {
        lines.push(`INFO state=${s.kind}`);
        if (token !== null && entry) {
          const bal = await ftBalanceOf(cfg, token, doc.account_id);
          lines.push(`INFO token-balance ${formatUnits(bal, entry.decimals)} ${entry.symbol}`);
        }
      }
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
  if (cmd === 'refund-payer') {
    const trusted = trustedCodeHash(cfg);
    assertDocTrusted(doc, trusted, cfg.allowedTokens);
    await checkNetwork(cfg);
    const signer = need(cfg.sweeper, 'SWEEPER');
    const token = docToken(doc);
    const p = await sendActions(cfg, signer, doc.account_id,
      [actFunctionCall('refund_payer', utf8('{}'), token ? GAS.refundToken : GAS.refundNear, 0n)], 'refund-payer');
    const after = await statusLine(cfg, doc, 'after: view_account');
    out(json, { tx: p, after: after.obj }, [...txLines(p, docDecimals(doc), docUnit(doc)), after.line]);
    if (!p.success) {
      const m = /NOT_YET: refundable after (\d+)/.exec(failureText(p));
      if (m) console.error(`NOT YET: refundable after ${new Date(Number(m[1])).toISOString()} (${m[1]}); run \`zi refund-payer ${doc.invoice_id}\` then`);
      return 1;
    }
    return p.returnValue === 'REFUNDED' ? 0 : 1;
  }
  if (cmd === 'pay' || cmd === 'sweep' || cmd === 'init') {
    const trusted = trustedCodeHash(cfg);
    assertDocTrusted(doc, trusted, cfg.allowedTokens);   // never sign for a doc whose terms/code hash/state init do not re-derive
    await checkNetwork(cfg);
    const signer = cmd === 'pay' ? need(cfg.payer, 'PAYER') : need(cfg.sweeper, 'SWEEPER');
    const token = docToken(doc);
    const entry = token === null ? null : tokenForDoc(cfg, doc);
    const unit = docUnit(doc);
    const dec = docDecimals(doc);

    if (cmd === 'pay' && entry) {
      // token path: register the invoice id if needed -> init + fund if the account does not exist -> ft_transfer_call / plain ft_transfer
      const amount = v.amount ? parseUnits(v.amount, entry.decimals) : docAmountRaw(doc);
      const sb = await storageBalanceOf(cfg, entry.accountId, doc.account_id);
      if (sb === null) {
        const bounds = await storageBalanceBounds(cfg, entry.accountId);
        const reg = await sendActions(cfg, signer, entry.accountId, [actStorageDeposit(doc.account_id, bounds.min)], 'register');
        out(json, reg, [...txLines(reg), `REGISTERED ${doc.account_id} on ${entry.accountId} (${formatNear(bounds.min)} NEAR storage deposit)`]);
        if (!reg.success) return 1;
      }
      if (v.plain) {
        // The exchange path: no state init, no init transaction. The tokens sit on the token contract until a sweep.
        const p = await sendActions(cfg, signer, entry.accountId, [actFtTransfer(doc.account_id, amount)], 'plain-transfer');
        const after = await statusLine(cfg, doc, 'after: view_account');
        out(json, { tx: p, after: after.obj }, [...txLines(p, dec, unit), after.line]);
        console.error(`PLAIN: a bare ft_transfer; anyone can run \`zi sweep ${doc.invoice_id}\` to settle it`);
        return p.success ? 0 : 1;
      }
      const s = await viewAccount(cfg, doc.account_id);
      if (s.kind !== 'INITIALIZED') {
        const init = await sendActions(cfg, signer, doc.account_id, [stateInitAction(doc, trusted), actFund()], 'init');
        out(json, init, [...txLines(init), `INITIALIZED ${doc.account_id}`]);
        if (!init.success) return 1;
      }
      const p = await sendActions(cfg, signer, entry.accountId, [actFtTransferCall(doc.account_id, amount, payMsg(doc.invoice_id))], 'pay', doc.account_id);
      const after = await statusLine(cfg, doc, 'after: view_account');
      out(json, { tx: p, after: after.obj }, [...txLines(p, dec, unit), after.line]);
      const paid = p.events.some((e) => e.event === 'invoice_paid');
      const rejected = p.events.find((e) => e.event === 'payment_rejected');
      const failed = p.events.filter((e) => e.event === 'transfer_failed');
      if (rejected) {
        const reason = (rejected.data[0] as Record<string, unknown>)?.reason;
        console.error(`NOT PAID: payment_rejected ${String(reason)} (the token returned the amount)`);
      } else if (failed.length) {
        console.error(`WARNING ${failed.length} payout(s) failed; the shares are owed. Fix the recipient, then run \`zi sweep ${doc.invoice_id}\``);
      } else if (!paid) {
        console.error(`NOT PAID yet: the settlement is in flight or incomplete (no invoice_paid event); run \`zi status ${doc.invoice_id}\` and then \`zi sweep ${doc.invoice_id}\` if a share is owed`);
      }
      return p.success && paid && failed.length === 0 ? 0 : 1;
    }

    const before = await statusLine(cfg, doc, cmd === 'pay' ? 'before: view_account' : 'transfer-path: view_account (uninitialized)');
    // v1 limitation (audit contract-3): pay() ignores funds already parked by a plain transfer, so paying again would charge
    // the payer twice. Settle parked funds with `zi sweep` instead; --allow-parked overrides on purpose. v2+ fixes it.
    if (cmd === 'pay' && !fixesParkedFunds(trusted) && before.obj.kind === 'UNINITIALIZED' && before.obj.amount > 0n && !v['allow-parked']) {
      throw new UsageError(`invoice ${doc.invoice_id} already holds ${formatNear(before.obj.amount)} NEAR from a plain transfer: run \`zi sweep ${doc.invoice_id}\` instead of paying again (or pass --allow-parked)`);
    }
    const actions: Uint8Array[] = [];
    if (cmd === 'init' && entry) {
      actions.push(stateInitAction(doc, trusted), actFund());
    } else {
      if (!v['no-init'] && (cmd !== 'sweep' || before.obj.kind !== 'INITIALIZED')) actions.push(stateInitAction(doc, trusted));
      if (cmd === 'pay') actions.push(actFunctionCall('pay', utf8('{}'), GAS.payNear, v.amount ? parseNear(v.amount) : docAmountRaw(doc)));
      if (cmd === 'sweep') {
        if (entry && (before.obj.kind !== 'INITIALIZED' || before.obj.amount < 100n)) actions.push(actFund());
        actions.push(actFunctionCall('sweep', utf8('{}'), entry ? GAS.tokenSweep : GAS.sweepNear, 0n));
      }
    }
    const p = await sendActions(cfg, signer, doc.account_id, actions, cmd === 'init' ? 'init' : cmd);
    const after = await statusLine(cfg, doc, cmd === 'sweep' ? 'sweep-after: view_account' : 'after: view_account');
    out(json, { tx: p, after: after.obj }, [...txLines(p, dec, unit), after.line]);
    const incomplete = ['PAYOUT_PENDING', 'REFUND_FAILED', 'SETTLING'].includes(String(p.returnValue));
    // PAYOUT_PENDING means the payment was ACCEPTED and a payout failed: the money is not back with the payer (REFUND_FAILED: a refund could not be sent).
    if (cmd === 'pay' && p.success && p.returnValue !== 'PAID') {
      console.error(incomplete ? `NOT PAID (yet): ${String(p.returnValue)}` : `NOT PAID: ${String(p.returnValue)} (the deposit was refunded)`);
    }
    if (cmd === 'pay' && incomplete) {
      console.error(`WARNING the settlement is not complete: ${String(p.returnValue)}; fix the recipient, then run \`zi sweep ${doc.invoice_id}\``);
    }
    if (cmd === 'sweep' && entry && p.success) {
      const value = String(p.returnValue);
      if (['UNDERPAID', 'NOTHING_TO_SWEEP', 'NEEDS_YOCTO', 'BALANCE_UNAVAILABLE', 'CONCURRENT_PAYMENT', 'PAYOUT_PENDING'].includes(value)) {
        console.error(`SWEEP NOT COMPLETE: ${value}${value === 'NEEDS_YOCTO' ? ` (send \`zi init ${doc.invoice_id}\` to fund the 1-yocto float)` : value === 'CONCURRENT_PAYMENT' ? ' (a payment was in flight during the balance read; nothing was settled, retry the payment or run the sweep again)' : ''}`);
        return 1;
      }
    }
    // A payout to a missing account fails downstream; the contract records it and keeps the share owed.
    if (p.success && p.downstreamFailures.length) console.error(`WARNING ${p.downstreamFailures.length} transfer(s) failed downstream (see TRANSFER_FAILED / EVENT transfer_failed); the funds bounced back to the invoice account`);
    return p.success && p.downstreamFailures.length === 0 && (cmd !== 'pay' || p.returnValue === 'PAID') ? 0 : 1;
  }
  if (cmd === 'receipt') {
    await checkNetwork(cfg);
    const trusted = pinForVerification(trustedCodeHash(cfg), doc.code_hash);
    const s = await viewAccount(cfg, doc.account_id);
    if (s.kind !== 'INITIALIZED') throw new Error(`invoice account is ${s.kind}; nothing to receipt yet`);
    const inv = await viewInvoice(cfg, doc.account_id);
    let events: unknown[] = []; let ftTransfers: unknown[] = []; let txHash: string | null = null;
    if (v.tx) {
      const signerGuess = inv.paid_by ?? cfg.sweeper?.accountId ?? doc.merchant;
      const st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: v.tx, sender_account_id: signerGuess, wait_until: 'FINAL' });
      if (st.error) throw new Error(`--tx ${v.tx}: tx_status lookup failed (signer guess ${signerGuess}): ${JSON.stringify(st.error)}`);
      const p = parseTxStatus(st.result, doc.account_id); events = p.events; ftTransfers = p.ftTransfers.map((t) => ({ ...t, amount: t.amount.toString() })); txHash = p.txHash;
    }
    const c = checkDoc(doc, trusted, cfg.allowedTokens);
    const checks = { id_matches_terms: c.idFromTerms && c.rawFromTerms && c.fieldsConsistent, code_hash_matches: c.codeHashTrusted && s.globalContractHash === trusted,
      terms_match_onchain: termsMatchOnchain(doc, inv), status: inv.status };
    const failed = [!checks.id_matches_terms && 'id_matches_terms', !checks.code_hash_matches && 'code_hash_matches', !checks.terms_match_onchain && 'terms_match_onchain',
      inv.status !== 'PAID' && `status (${inv.status}, not PAID)`].filter(Boolean) as string[];
    if (failed.length) {
      const lines = failed.map((f) => `FAIL ${f}`);
      out(json, { ok: false, failed, checks }, [...lines, 'no receipt written']);
      return 1;
    }
    const receipt = { format: 'zeroinit-receipt/1', invoice: doc, deployment: deploymentLabel(trusted), onchain: inv,
      account: { amount: s.amount.toString(), storage_usage: s.storageUsage, global_contract_hash: s.globalContractHash },
      tx_hash: txHash, events, ft_transfers: ftTransfers, checks, generated_at_iso: new Date().toISOString() };
    const file = join(cfg.invoiceDir, `${doc.invoice_id}.receipt.json`);
    writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    const tax = BigInt(inv.tax_amount);
    const dec = docDecimals(doc);
    const unit = docUnit(doc);
    const fmt = (x: bigint) => (docToken(doc) === null ? `${formatNear(x)} NEAR` : `${formatUnits(x, dec)} ${unit}`);
    out(json, receipt, [`RECEIPT ${file}`, '', `| Field | Value |`, `|---|---|`, `| Invoice | ${doc.invoice_id} |`, `| Address | ${doc.account_id} |`,
      `| Status | ${inv.status} |`, `| Paid by | ${inv.paid_by ?? '(plain transfer)'} |`, `| Paid | ${fmt(BigInt(inv.paid_amount))} |`,
      `| Merchant got | ${fmt(BigInt(inv.paid_amount) - tax)} → ${doc.merchant} |`, `| Tax | ${fmt(tax)} → ${doc.tax_vault} |`]);
    return 0;
  }
  throw new UsageError(`unhandled command ${cmd}`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  console.error(`ERROR ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof UsageError ? 2 : 1);
});
