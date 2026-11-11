// Build, sign, send a tx; then fetch EXPERIMENTAL_tx_status (has receipts with actions) and parse it.
import type { Config, Signer } from './config.ts';
import { rpcCall, accessKeyNonce, finalBlockHash, checkNetwork } from './rpc.ts';
import { keyPairFromSecret, signTransaction } from './tx.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';

const STATUS_POLLS = 6;
const errName = (e: any): string => String(e?.cause?.name ?? e?.name ?? '');
/** NEAR RPC answers TIMEOUT_ERROR when wait_until is not reached in time, and UNKNOWN_TRANSACTION while the tx is not yet known: both mean "maybe in flight". */
export const isInFlight = (e: any): boolean => ['TIMEOUT_ERROR', 'UNKNOWN_TRANSACTION'].includes(errName(e));

export async function sendActions(cfg: Config, signer: Signer, receiverId: string, actions: Uint8Array[], labelPrefix: string, invoiceAccountId?: string): Promise<ParsedTx> {
  await checkNetwork(cfg);   // every signing path asserts chain_id === 'testnet' before it touches a key
  const kp = keyPairFromSecret(signer.secret);
  const nonce = (await accessKeyNonce(cfg, signer.accountId, kp.publicKeyStr)) + 1n;
  const blockHash = await finalBlockHash(cfg);
  const { signedTxBase64, txHash } = signTransaction({ signerId: signer.accountId, publicKey: kp.publicKey, nonce, receiverId, blockHash, actions }, kp);
  const sent = await rpcCall(cfg, 'send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' }, `${labelPrefix}: send_tx`);
  // A timeout is not a rejection: the transaction was broadcast and may still be included. Only a definite error is "rejected".
  if (sent.error && !isInFlight(sent.error)) throw new Error(`send_tx rejected (tx ${txHash}): ${JSON.stringify(sent.error)}`);
  const tag = `${labelPrefix}: tx_status`;
  const backoffMs = Number(process.env.ZI_RPC_BACKOFF_MS ?? 1000);
  let st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signer.accountId, wait_until: 'FINAL' }, tag);
  for (let attempt = 1; st.error && isInFlight(st.error) && attempt < STATUS_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, backoffMs * attempt));
    st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signer.accountId, wait_until: 'FINAL' }, tag);
  }
  if (st.error && isInFlight(st.error)) {
    throw new Error(`tx_status: tx ${txHash} may still be included (${errName(st.error)}); check it on an explorer or with tx_status before retrying, a retry can send the funds twice`);
  }
  if (st.error) throw new Error(`tx_status failed (tx ${txHash}): ${JSON.stringify(st.error)}`);
  // A transaction sent TO the token (ft_transfer_call) has the token as receiver, but the receipts that matter ran on the
  // invoice account: pass the invoice so a failed ft_transfer on the token is a downstream failure, not a failed transaction.
  return parseTxStatus(st.result, invoiceAccountId ?? receiverId);
}
