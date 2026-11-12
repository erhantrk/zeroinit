// Run: npx tsx --test test/vectors.test.ts   (expects: all tests pass)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import * as N from 'near-api-js';
import { fromHex, toHex, concat, utf8, parseNear } from '../src/bytes.ts';
import { encodeUniversalAccountId, universalStateInitBytes, deterministicStateInitBytes, deriveUniversalAccountId,
  deriveDeterministicAccountId, invoiceStateBytes, invoiceStateInit } from '../src/stateinit.ts';
import { actCreateAccount, actAddFullAccessKey, actTransfer, actFunctionCall, actUniversalStateInit, encodeTransactionV0, signTransaction, keyPairFromSecret } from '../src/tx.ts';

test('crockford KATs (nearcore universal_account_id.rs)', () => {
  assert.equal(encodeUniversalAccountId(new Uint8Array(32)), '0u0000000000000000000000000000000000000000000000000000');
  assert.equal(encodeUniversalAccountId(new Uint8Array(32).fill(255)), '0uzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzg');
  assert.equal(encodeUniversalAccountId(Uint8Array.from({ length: 32 }, (_, i) => i)), '0u000g40r40m30e209185gr38e1w8124gk2gahc5rr34d1p70x3rfg');
  assert.equal(encodeUniversalAccountId(Uint8Array.from({ length: 32 }, (_, i) => (7 * i) % 256)), '0u003gw58w4cn32e1z8s6n8pv2d5r7ezm5hj9sn8d8nyvbvh6btbcg');
});

test('wallet-contract re-derivation vector (NEP-655 Appendix A)', () => {
  const STATE = fromHex('01' + '00000000' + '8565df94b8caab08f28cdd2ee014b800915741d4694fa840e50cca02ae5c6466' + '100e0000' + '0000000000000000' + '00000000' + '00000000' + '00000000');
  const code = { accountId: '0sb0d7ef4f935c6ef78e08ad03569767aaec4223a3' };
  const u = universalStateInitBytes(code, [[new Uint8Array(0), STATE]]);
  assert.equal(toHex(u), '0001012a00000030736230643765663466393335633665663738653038616430333536393736376161656334323233613301000000000000003d00000001000000008565df94b8caab08f28cdd2ee014b800915741d4694fa840e50cca02ae5c6466100e0000000000000000000000000000000000000000000000000000');
  assert.equal(deriveUniversalAccountId(u), '0u4bfkw2qvgfzbf7zzkxykcppqymn0p2hbayjee3ygzrbhmmtyejx0');
  assert.equal(deriveDeterministicAccountId(deterministicStateInitBytes(code, [[new Uint8Array(0), STATE]])), '0scdb6cfeed476fc878af9d3246768cbe803714c87');
});

const EXAMPLE = { invoice_id: 'INV-0001', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: 800,
  amount: parseNear('1'), expires_at_ms: 1794700800000n, salt: 42n };
const CODE = { codeHash: new Uint8Array(32).fill(0x11) };

test('ZeroInit invoice example (SPEC.md §2.3)', () => {
  const s = invoiceStateBytes(EXAMPLE);
  assert.equal(s.length, 135);
  assert.equal(toHex(s), '0108000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
  const u = invoiceStateInit('0u', CODE, EXAMPLE);
  assert.equal(u.raw.length, 191);
  assert.equal(u.accountId, '0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0');
  assert.equal(invoiceStateInit('0s', CODE, EXAMPLE).accountId, '0s36a782a21608104487f1334939347baebedfc7e1');
});

const SECRET = 'ed25519:' + base58.encode(concat(new Uint8Array(32).fill(1), keyPairFromSecret('ed25519:' + base58.encode(new Uint8Array(32).fill(1))).publicKey));
const BLOCK = new Uint8Array(32).fill(7);

test('tx encoder parity with near-api-js 7.4.0 (Transfer + FunctionCall)', () => {
  const kp = keyPairFromSecret(SECRET);
  const recv = '0u4bfkw2qvgfzbf7zzkxykcppqymn0p2hbayjee3ygzrbhmmtyejx0';
  const mine = encodeTransactionV0({ signerId: 'payer.testnet', publicKey: kp.publicKey, nonce: 5n, receiverId: recv, blockHash: BLOCK,
    actions: [actTransfer(10n ** 24n), actFunctionCall('pay', utf8('{}'), 30n * 10n ** 12n, 1n)] });
  const nk = N.KeyPair.fromString(SECRET as any);
  const t = N.createTransaction('payer.testnet', nk.getPublicKey(), recv, 5n,
    [N.actions.transfer(10n ** 24n), N.actions.functionCall('pay', {}, 30n * 10n ** 12n, 1n)], BLOCK);
  assert.equal(toHex(mine), toHex(N.encodeTransaction(t)));
});

test('tx encoder parity with near-api-js 7.4.0 (CreateAccount + Transfer + AddKey FullAccess), the sub-account creation path', () => {
  const kp = keyPairFromSecret(SECRET);
  const mine = encodeTransactionV0({ signerId: 'vault.testnet', publicKey: kp.publicKey, nonce: 9n, receiverId: 'child.vault.testnet', blockHash: BLOCK,
    actions: [actCreateAccount(), actTransfer(10n ** 23n), actAddFullAccessKey(kp.publicKey)] });
  const nk = N.KeyPair.fromString(SECRET as any);
  const t = N.createTransaction('vault.testnet', nk.getPublicKey(), 'child.vault.testnet', 9n,
    [N.actions.createAccount(), N.actions.transfer(10n ** 23n), N.actions.addFullAccessKey(nk.getPublicKey())], BLOCK);
  assert.equal(toHex(mine), toHex(N.encodeTransaction(t)));
  assert.throws(() => actAddFullAccessKey(new Uint8Array(31)), /32 bytes/);
});

test('signed pay tx vector [UniversalStateInit, FunctionCall pay 1 NEAR] (SPEC.md §4.4)', () => {
  const kp = keyPairFromSecret(SECRET);
  assert.equal(kp.publicKeyStr, 'ed25519:AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9');
  const { raw, accountId } = invoiceStateInit('0u', CODE, EXAMPLE);
  const r = signTransaction({ signerId: 'payer.testnet', publicKey: kp.publicKey, nonce: 5n, receiverId: accountId, blockHash: BLOCK,
    actions: [actUniversalStateInit(raw, 0n), actFunctionCall('pay', utf8('{}'), 50n * 10n ** 12n, 10n ** 24n)] }, kp);
  assert.equal(r.txBytes.length, 402);
  assert.equal(toHex(r.txBytes).slice(0, 40), '0d00000070617965722e746573746e6574008a88');
  assert.equal(r.signedTxBase64, 'DQAAAHBheWVyLnRlc3RuZXQAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1wFAAAAAAAAADYAAAAwdTZxNjV6cjR0eDE2OGthdDFtanY2cnN6aDhtOGprcTVhZnpjdjcydzYwOGRkOWpzYWEzajAHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwIAAAAPvwAAAAABABERERERERERERERERERERERERERERERERERERERERERAQAAAAUAAABTVEFURYcAAAABCAAAAElOVi0wMDAxEwAAAHppLW1lcmNoYW50LnRlc3RuZXQTAAAAemktdGF4dmF1bHQudGVzdG5ldCADAAAAoe3MzhvC0wAAAAAAAADwgNyhAQAAKgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIDAAAAcGF5AgAAAHt9ACA9iHktAAAAAACh7czOG8LTAAAAAAAAABnvEb08nRW/NhyVIrHuXIwTRq8njTvdStTHhDmdJBVhYzdDoFuu2lslW08nVA8CaeDD0tYfBWmKYxzeh/6now4=');
  assert.equal(r.txHash, base58.encode(fromHex('f837a322ed4cf0307bca7a9b403800b162aca9a172d2829e5a4653a5ce8981d9')));
});

test('parseNear', () => {
  assert.equal(parseNear('1'), 10n ** 24n);
  assert.equal(parseNear('0.08'), 8n * 10n ** 22n);
  assert.throws(() => parseNear('1.2.3'));
});

// docs/STABLECOIN.md §3 (v3). The hex printed in the design lost trailing zero bytes (1 and 6); the stated
// lengths 201/226 and the field layout are authoritative, so these are the same vectors padded with zeros.
const V3_NEAR_HEX = '0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a0000000000000000840c240000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
const V3_TOKEN_HEX = '0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e6574200340420f0000000000000000000000000000f080dca10100002a0000000000000000840c2400000000011500000074757364632e6578616d706c652e746573746e6574000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

test('v3 state vectors: NEAR 201 bytes and token 226 bytes (STABLECOIN.md §3)', () => {
  const v3near = { ...EXAMPLE, layout: 3 as const, grace_ms: 604800000n, token: null };
  const n = invoiceStateBytes(v3near);
  assert.equal(n.length, 201);
  assert.equal(toHex(n), V3_NEAR_HEX);
  const v3token = { ...EXAMPLE, layout: 3 as const, grace_ms: 604800000n, token: 'tusdc.example.testnet', amount: 1_000_000n };
  const t = invoiceStateBytes(v3token);
  assert.equal(t.length, 226);
  assert.equal(toHex(t), V3_TOKEN_HEX);
  // the same terms under v3 derive a different address than under v2 (new layout + new code hash)
  assert.notEqual(invoiceStateInit('0u', CODE, v3near).accountId, invoiceStateInit('0u', CODE, EXAMPLE).accountId);
  assert.notEqual(invoiceStateInit('0u', CODE, v3token).accountId, invoiceStateInit('0u', CODE, v3near).accountId);
});

test('layout 1 rejects a token or a grace; layout 3 requires a grace', () => {
  assert.throws(() => invoiceStateBytes({ ...EXAMPLE, token: 'tusdc.example.testnet' }), /needs the v3 layout/);
  assert.throws(() => invoiceStateBytes({ ...EXAMPLE, grace_ms: 1n }), /needs the v3 layout/);
  assert.throws(() => invoiceStateBytes({ ...EXAMPLE, layout: 3 }), /needs grace_ms/);
  assert.throws(() => invoiceStateBytes({ ...EXAMPLE, layout: 3, grace_ms: 1n << 64n }), /grace_ms out of u64 range/);
  assert.throws(() => invoiceStateBytes({ ...EXAMPLE, layout: 3, grace_ms: 1n, token: 'Bad..token' }), /token .* not a valid NEAR account id/);
});
