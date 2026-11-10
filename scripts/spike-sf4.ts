// Spike S-F4 (docs/STABLECOIN.md §12): is the UniversalStateInit `deposit` credited to the new account, or refunded to the signer?
//   node scripts/spike-sf4.ts <invoice-id> <deposit-in-NEAR>
// The invoice must be a NEAR invoice that does not exist yet (`zi invoice new`). One transaction, signed by the sweeper key:
// [UniversalStateInit{raw, deposit}] and nothing else. Prints what the chain did with the deposit and writes the evidence to fixtures/v31/sf4.json.
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { checkNetwork, viewAccount, rpcCall, accessKeyNonce, finalBlockHash } from '../src/rpc.ts';
import { keyPairFromSecret, signTransaction, actUniversalStateInit } from '../src/tx.ts';
import { loadDoc } from '../src/invoice.ts';
import { invoiceStateInit, } from '../src/stateinit.ts';
import { termsFromDoc } from '../src/invoice.ts';
import { base58 } from '@scure/base';
import { parseNear, formatNear } from '../src/bytes.ts';

const [id, depText] = process.argv.slice(2);
if (!id || !depText) throw new Error('usage: spike-sf4.ts <invoice-id> <deposit-in-NEAR>');
const cfg = loadConfig();
if (!cfg.sweeper) throw new Error('set ZI_SWEEPER_*');
await checkNetwork(cfg);
const doc = loadDoc(cfg.invoiceDir, id);
const before = await viewAccount(cfg, doc.account_id);
if (before.kind !== 'NONEXISTENT') throw new Error(`${doc.account_id} already exists (${before.kind})`);
const { raw, accountId } = invoiceStateInit(doc.scheme, { codeHash: base58.decode(doc.code_hash) }, termsFromDoc(doc));
if (accountId !== doc.account_id) throw new Error('document does not re-derive');
const deposit = parseNear(depText);
const signer = cfg.sweeper;
const kp = keyPairFromSecret(signer.secret);
const bal = async () => BigInt((await rpcCall(cfg, 'query', { request_type: 'view_account', finality: 'final', account_id: signer.accountId })).result.amount);
const signerBefore = await bal();
const nonce = (await accessKeyNonce(cfg, signer.accountId, kp.publicKeyStr)) + 1n;
const { signedTxBase64, txHash } = signTransaction({ signerId: signer.accountId, publicKey: kp.publicKey, nonce, receiverId: doc.account_id, blockHash: await finalBlockHash(cfg), actions: [actUniversalStateInit(raw, deposit)] }, kp);
const sent = await rpcCall(cfg, 'send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' });
if (sent.error) throw new Error(JSON.stringify(sent.error));
const st = await rpcCall(cfg, 'EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: signer.accountId, wait_until: 'FINAL' });
if (st.error) throw new Error(JSON.stringify(st.error));
const r = st.result;
const after = await viewAccount(cfg, doc.account_id);
const signerAfter = await bal();
const receipts = (r.receipts ?? []).map((x: any) => ({ receiver: x.receiver_id, predecessor: x.predecessor_id, actions: (x.receipt?.Action?.actions ?? []).map((a: any) => Object.keys(a)[0] + (a.Transfer ? ` ${formatNear(BigInt(a.Transfer.deposit))}` : '')) }));
const burnt = [r.transaction_outcome, ...(r.receipts_outcome ?? [])].reduce((s: bigint, o: any) => s + BigInt(o.outcome.tokens_burnt), 0n);
const evidence = {
  what: 'S-F4: UniversalStateInit deposit credited or refunded', tx_hash: txHash, signer: signer.accountId, invoice: doc.invoice_id, account_id: doc.account_id, deposit_near: formatNear(deposit),
  status: r.status, account_after: after.kind === 'INITIALIZED' ? { kind: after.kind, amount_near: formatNear(after.amount), storage_usage: after.storageUsage } : { kind: after.kind },
  signer_delta_near: formatNear(signerBefore - signerAfter), tokens_burnt_near: formatNear(burnt), receipts,
};
writeFileSync('fixtures/v31/sf4.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
const credited = after.kind === 'INITIALIZED' && after.amount >= deposit;
console.log(credited ? 'CREDITED: the deposit is in the new account' : 'NOT CREDITED: the new account does not hold the deposit');
