// Hand-built live calls for the failure runs (docs/STABLECOIN.md §11.4 L11, L12, L16, L19) and the v3.3 private-callback check. Signed with the payer key, recorded
// through ZI_RECORD like every other step (labels `<label>: tx_status`, then `after: view_account` / `after: get_invoice`).
//   node scripts/live-call.ts near-on-token <invoice-id>
//       pay() with 0.1 NEAR attached on a token invoice: the contract must refund it (REFUNDED_WRONG_ASSET).
//   node scripts/live-call.ts ft-call <token-account> <invoice-id> <amount> <msg: pay|empty|bad> <gas-Tgas> <label>
//       ft_transfer_call on any NEP-141 contract to the invoice account (registers the invoice on that token first if needed).
//       `pay` = the strict msg, `empty` = "", `bad` = {"action":"x"}. The invoice must already be initialized (zi init).
import { loadConfig } from '../src/config.ts';
import { checkNetwork, viewAccount, viewInvoice, setRecordInvoice } from '../src/rpc.ts';
import { sendActions } from '../src/send.ts';
import { loadDoc, docDecimals } from '../src/invoice.ts';
import { actFunctionCall } from '../src/tx.ts';
import { utf8, parseNear } from '../src/bytes.ts';
import { actStorageDeposit, payMsg, parseUnits, formatUnits, storageBalanceBounds, storageBalanceOf } from '../src/ft.ts';

const T = 1_000_000_000_000n;
const [mode, ...a] = process.argv.slice(2);
const cfg = loadConfig();
if (!cfg.payer) throw new Error('set ZI_PAYER_ACCOUNT and ZI_PAYER_KEY');
const payer = cfg.payer;
await checkNetwork(cfg);

function show(p: Awaited<ReturnType<typeof sendActions>>, label: string): void {
  console.log(`TX ${p.txHash}`);
  console.log(`RESULT ${p.success ? String(p.returnValue) : 'FAILED ' + JSON.stringify(p.failures)}`);
  for (const e of p.events) console.log(`EVENT ${e.event} ${JSON.stringify(e.data[0])}`);
  for (const e of p.nep141Events) console.log(`NEP141 ${JSON.stringify(e)}`);
  for (const f of p.downstreamFailures) console.log(`TRANSFER_FAILED ${JSON.stringify(f)}`);
  console.log(`LINK https://testnet.nearblocks.io/txns/${p.txHash}  (${label})`);
}
async function after(account: string): Promise<void> {
  const s = await viewAccount(cfg, account, 'after: view_account');
  if (s.kind === 'INITIALIZED') {
    const inv = await viewInvoice(cfg, account, 'after: get_invoice');
    console.log(`STATE INITIALIZED status=${inv.status} owed_merchant=${inv.owed_merchant} owed_tax=${inv.owed_tax} busy_until_ms=${inv.busy_until_ms}`);
  } else console.log(`STATE ${s.kind}`);
}

if (mode === 'near-on-token') {
  const doc = loadDoc(cfg.invoiceDir, a[0]);
  setRecordInvoice(doc.invoice_id);
  const p = await sendActions(cfg, payer, doc.account_id, [actFunctionCall('pay', utf8('{}'), 100n * T, parseNear('0.1'))], 'wrong-asset');
  show(p, 'wrong-asset');
  await after(doc.account_id);
  process.exitCode = p.success && p.returnValue === 'REFUNDED_WRONG_ASSET' ? 0 : 1;
} else if (mode === 'ft-call') {
  const [token, id, amountText, msgKind, gasT, label] = a;
  if (!token || !id || !amountText || !msgKind || !gasT || !label) throw new Error('usage: ft-call <token> <invoice-id> <amount> <pay|empty|bad> <gas-Tgas> <label>');
  const doc = loadDoc(cfg.invoiceDir, id);
  setRecordInvoice(doc.invoice_id);
  const msg = msgKind === 'pay' ? payMsg(doc.invoice_id) : msgKind === 'empty' ? '' : msgKind === 'bad' ? '{"action":"x"}' : (() => { throw new Error('msg must be pay|empty|bad'); })();
  const amount = parseUnits(amountText, docDecimals(doc));
  if ((await storageBalanceOf(cfg, token, doc.account_id)) === null) {
    const bounds = await storageBalanceBounds(cfg, token);
    const reg = await sendActions(cfg, payer, token, [actStorageDeposit(doc.account_id, bounds.min)], 'token-register');
    console.log(`REGISTER ${reg.success ? 'SUCCESS' : 'FAILED'} ${doc.account_id} on ${token} tx ${reg.txHash}`);
    if (!reg.success) process.exit(1);
  }
  const call = actFunctionCall('ft_transfer_call', utf8(JSON.stringify({ receiver_id: doc.account_id, amount: amount.toString(), msg })), BigInt(gasT) * T, 1n);
  const p = await sendActions(cfg, payer, token, [call], label, doc.account_id);
  show(p, label);
  console.log(`SENT ${formatUnits(amount, docDecimals(doc))} on ${token}, msg kind ${msgKind}, gas ${gasT} Tgas`);
  await after(doc.account_id);
  process.exitCode = p.success ? 0 : 1;
} else if (mode === 'private-callback') {
  // v3.3: on_pay_balance decides how much of a token payment is used. It must only run as the hook's own callback: a direct call
  // from any account must fail on the contract's private check and change nothing.
  const doc = loadDoc(cfg.invoiceDir, a[0]);
  setRecordInvoice(doc.invoice_id);
  const args = { sender_id: payer.accountId, amount: '1', lock: '0' };
  const p = await sendActions(cfg, payer, doc.account_id, [actFunctionCall('on_pay_balance', utf8(JSON.stringify(args)), 30n * T, 0n)], 'private-callback');
  show(p, 'private-callback');
  await after(doc.account_id);
  const refused = !p.success && JSON.stringify(p.failures).includes('private');
  console.log(refused ? 'PASS on_pay_balance refuses a direct call' : 'FAIL on_pay_balance accepted a direct call');
  process.exitCode = refused ? 0 : 1;
} else throw new Error('usage: live-call.ts near-on-token <id> | ft-call <token> <id> <amount> <pay|empty|bad> <gas-Tgas> <label> | private-callback <id>');
