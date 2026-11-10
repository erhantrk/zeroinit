// Audit fixes cli-server-secrets-2 and -7: scripts/plain-transfer.ts checks the network before signing and exits 1 on a failed transfer.
// Run: node --test test/plain-transfer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { tempDir, throwawaySigner, fakeRpc, statusResult, runCli } from './helpers.ts';

const env = (url: string) => { const s = throwawaySigner(); return { ZI_RPC_URL: url, ZI_INVOICE_DIR: tempDir(), ZI_PAYER_ACCOUNT: s.account, ZI_PAYER_KEY: s.secret }; };
const chain = (chainId: string, txResult: unknown) => ({
  status: () => statusResult(chainId),
  query: () => ({ nonce: 3 }),
  block: () => ({ header: { hash: base58.encode(new Uint8Array(32).fill(2)) } }),
  send_tx: () => ({}),
  EXPERIMENTAL_tx_status: () => txResult,
});

test('plain-transfer refuses a non-testnet chain before touching the key (only `status` is called)', async () => {
  const rpc = await fakeRpc(chain('mainnet', {}));
  try {
    const r = await runCli(['x'.repeat(64), '1'], env(rpc.url), 'scripts/plain-transfer.ts');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /chain_id is mainnet/);
    assert.deepEqual(rpc.calls.map((c) => c.method), ['status']);
  } finally { await rpc.close(); }
});

test('plain-transfer exits 1 when the transfer failed, 0 when it succeeded', async () => {
  const failed = { status: { Failure: { ActionError: { kind: 'LackBalanceForState' } } }, transaction: { hash: 'H', receiver_id: 'r', actions: [] }, receipts_outcome: [], receipts: [] };
  const okTx = { status: { SuccessValue: '' }, transaction: { hash: 'H', receiver_id: 'r', actions: [] }, receipts_outcome: [], receipts: [] };
  for (const [tx, code, re] of [[failed, 1, /RESULT FAILED/], [okTx, 0, /RESULT SUCCESS/]] as const) {
    const rpc = await fakeRpc(chain('testnet', tx));
    try {
      const r = await runCli(['receiver.testnet', '1'], env(rpc.url), 'scripts/plain-transfer.ts');
      assert.equal(r.code, code, r.stdout + r.stderr);
      assert.match(r.stdout, re);
    } finally { await rpc.close(); }
  }
});
