// HISTORY: this recorder ran against contract v3.1 (2prMzXHZ…DaYX) on 2026-11-10. The client default is v3.2 now: pay/sweep/init refuse a v3.1 invoice unless ZI_CODE_HASH is pinned to the v3.1 hash, and a re-run records v3.2 invoices (use record-v32-*.sh).
// LIVE v3.1 F1 race (final review): a token `sweep` that reads the balance while an `ft_transfer_call` credit is in flight.
//   node scripts/race-v31.ts <invoice-id> [offset-ms]
// The invoice must be initialized and OPEN (`zi init`). Both transactions are signed first (the sweeper's `sweep`, the payer's
// `ft_transfer_call` of the full price), then sent at the same moment; a positive offset sends the payment that many ms later, a negative
// one sends the sweep later (the block alignment decides whether the race happens, so the caller may try several offsets and invoices).
// Recorded through ZI_RECORD like every other step. Exit 0 only if the sweep returned CONCURRENT_PAYMENT, the invoice is still OPEN with nothing owed
// and a retried ft_transfer_call is accepted (PAID). The payer's retry is only sent when the race happened.
import { loadConfig } from '../src/config.ts';
import { checkNetwork, viewAccount, viewInvoice, setRecordInvoice, rpcCall, accessKeyNonce, finalBlockHash } from '../src/rpc.ts';
import { sendActions } from '../src/send.ts';
import { keyPairFromSecret, signTransaction, actFunctionCall } from '../src/tx.ts';
import { parseTxStatus } from '../src/outcome.ts';
import { loadDoc, docAmountRaw } from '../src/invoice.ts';
import { utf8 } from '../src/bytes.ts';
import { GAS, actFtTransferCall, payMsg } from '../src/ft.ts';

const [id, offsetText] = process.argv.slice(2);
if (!id) throw new Error('usage: race-v31.ts <invoice-id> [offset-ms]');
const offset = Number(offsetText ?? 0);
const cfg = loadConfig();
if (!cfg.payer || !cfg.sweeper) throw new Error('set ZI_PAYER_* and ZI_SWEEPER_*');
const doc = loadDoc(cfg.invoiceDir, id);
const token = cfg.allowedTokens[0]?.accountId;
if (!token) throw new Error('no token configured');
await checkNetwork(cfg);
setRecordInvoice(doc.invoice_id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const before = await viewInvoice(cfg, doc.account_id, 'before: get_invoice');
if (before.status !== 'OPEN') throw new Error(`${id} is ${before.status}, not OPEN`);

async function presign(signer: { accountId: string; secret: string }, receiver: string, actions: Uint8Array[]) {
  const kp = keyPairFromSecret(signer.secret);
  const nonce = (await accessKeyNonce(cfg, signer.accountId, kp.publicKeyStr)) + 1n;
  const blockHash = await finalBlockHash(cfg);
  return { ...signTransaction({ signerId: signer.accountId, publicKey: kp.publicKey, nonce, receiverId: receiver, blockHash, actions }, kp), signer: signer.accountId };
}
const sweepTx = await presign(cfg.sweeper, doc.account_id, [actFunctionCall('sweep', utf8('{}'), GAS.tokenSweep, 0n)]);
const callTx = await presign(cfg.payer, token, [actFtTransferCall(doc.account_id, docAmountRaw(doc), payMsg(doc.invoice_id))]);
const send = async (tx: { signedTxBase64: string; txHash: string }, label: string) => {
  const r = await rpcCall(cfg, 'send_tx', { signed_tx_base64: tx.signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' }, `${label}: send_tx`);
  if (r.error) throw new Error(`send_tx rejected (${label} ${tx.txHash}): ${JSON.stringify(r.error)}`);
};
const t0 = Date.now();
await Promise.all([
  (async () => { if (offset < 0) await sleep(-offset); await send(sweepTx, 'sweep'); })(),
  (async () => { if (offset > 0) await sleep(offset); await send(callTx, 'pay'); })(),
]);
console.log(`SENT both in ${Date.now() - t0} ms, offset ${offset} ms (positive = payment later)`);

async function status(tx: { txHash: string; signer: string }, label: string) {
  const st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: tx.txHash, sender_account_id: tx.signer, wait_until: 'FINAL' }, `${label}: tx_status`);
  if (st.error) throw new Error(`tx_status failed (${label} ${tx.txHash}): ${JSON.stringify(st.error)}`);
  return parseTxStatus(st.result, doc.account_id);
}
async function snapshot(prefix: string) {
  await viewAccount(cfg, doc.account_id, `${prefix}: view_account`);
  return viewInvoice(cfg, doc.account_id, `${prefix}: get_invoice`);
}
const sweep = await status(sweepTx, 'sweep');
const afterSweep = await snapshot('sweep-after');
const call = await status(callTx, 'pay');
const afterCall = await snapshot('after');
const rejected = call.events.find((e) => e.event === 'payment_rejected');
console.log(`SWEEP TX ${sweepTx.txHash} success=${sweep.success} value=${String(sweep.returnValue)} ${sweep.success ? '' : JSON.stringify(sweep.failures).slice(0, 200)}`);
console.log(`CALL TX ${callTx.txHash} success=${call.success} value=${String(call.returnValue)} events=${call.events.map((e) => e.event).join(',')} reason=${rejected ? String((rejected.data[0] as Record<string, unknown>).reason) : '-'}`);
console.log(`AFTER status=${afterCall.status} owed_merchant=${afterCall.owed_merchant} owed_tax=${afterCall.owed_tax} owed_payer=${afterCall.owed_payer} paid_by=${afterCall.paid_by} busy_until_ms=${afterCall.busy_until_ms}`);
const raced = sweep.success && sweep.returnValue === 'CONCURRENT_PAYMENT' && rejected !== undefined && String((rejected.data[0] as Record<string, unknown>).reason) === 'busy';
if (!raced || afterSweep.status !== 'OPEN' || afterCall.status !== 'OPEN' || afterCall.owed_merchant !== '0' || afterCall.owed_tax !== '0' || afterCall.owed_payer !== '0') {
  console.log('RACE NOT PRODUCED (or the invoice is not OPEN with nothing owed): try another invoice and offset');
  process.exit(2);
}
console.log('RACE PRODUCED: sweep returned CONCURRENT_PAYMENT, the call was rejected busy and returned, OPEN, nothing owed');
const retry = await sendActions(cfg, cfg.payer, token, [actFtTransferCall(doc.account_id, docAmountRaw(doc), payMsg(doc.invoice_id))], 'pay', doc.account_id);
const afterRetry = await snapshot('after');
console.log(`RETRY TX ${retry.txHash} success=${retry.success} value=${String(retry.returnValue)} events=${retry.events.map((e) => e.event).join(',')} status=${afterRetry.status}`);
process.exitCode = retry.success && retry.events.some((e) => e.event === 'invoice_paid') && afterRetry.status === 'PAID' ? 0 : 1;
