// Build, sign, send a tx; then fetch EXPERIMENTAL_tx_status (has receipts with actions) and parse it.
import type { Config, Signer } from './config.ts';
import { rpcCall, accessKeyNonce, finalBlockHash, checkNetwork } from './rpc.ts';
import { keyPairFromSecret, signTransaction } from './tx.ts';
import { parseTxStatus, type ParsedTx } from './outcome.ts';

export async function sendActions(cfg: Config, signer: Signer, receiverId: string, actions: Uint8Array[], labelPrefix: string, invoiceAccountId?: string): Promise<ParsedTx> {
  await checkNetwork(cfg);   // every signing path asserts chain_id === 'testnet' before it touches a key
  const kp = keyPairFromSecret(signer.secret);
  const nonce = (await accessKeyNonce(cfg, signer.accountId, kp.publicKeyStr)) + 1n;
  const blockHash = await finalBlockHash(cfg);
  const { signedTxBase64, txHash } = signTransaction({ signerId: signer.accountId, publicKey: kp.publicKey, nonce, receiverId, blockHash, actions }, kp);
  const sent = await rpcCall(cfg, 'send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' }, `${labelPrefix}: send_tx`);
  if (sent.error) throw new Error(`send_tx rejected (tx ${txHash}): ${JSON.stringify(sent.error)}`);
  const st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signer.accountId, wait_until: 'FINAL' }, `${labelPrefix}: tx_status`);
  if (st.error) throw new Error(`tx_status failed (tx ${txHash}): ${JSON.stringify(st.error)}`);
  // A transaction sent TO the token (ft_transfer_call) has the token as receiver, but the receipts that matter ran on the
  // invoice account: pass the invoice so a failed ft_transfer on the token is a downstream failure, not a failed transaction.
  return parseTxStatus(st.result, invoiceAccountId ?? receiverId);
}
