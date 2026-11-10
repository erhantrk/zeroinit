// Deployments and the token allow-list (docs/STABLECOIN.md §2, §4.7, §10).
// Run: node --test test/config.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V1_CODE_HASH, V2_CODE_HASH, V3_CODE_HASH, DEPLOYED_CODE_HASH, KNOWN_DEPLOYMENTS, deploymentOf, deploymentLabel,
  trustedCodeHash, pinForVerification, fixesParkedFunds, fixesFinding, allowedTokens, tokenBySymbol, loadConfig, DEFAULT_TUSDC_ACCOUNT } from '../src/config.ts';
import { FOREIGN } from './helpers.ts';

test('v3 is the current deployment; v2 and v1 are historical', () => {
  assert.equal(DEPLOYED_CODE_HASH, V3_CODE_HASH);
  assert.equal(trustedCodeHash({ codeHashB58: null }), V3_CODE_HASH);
  assert.deepEqual(KNOWN_DEPLOYMENTS.map((d) => [d.version, d.historical]), [['v3', false], ['v2', true], ['v1', true]]);
  assert.match(deploymentLabel(V3_CODE_HASH), /^v3 \(current, deployed on testnet/);
  assert.match(deploymentLabel(V2_CODE_HASH), /^v2 \(history/);
  assert.match(deploymentLabel(V1_CODE_HASH), /^v1 \(history/);
  assert.match(deploymentLabel(FOREIGN), /^custom/);
  assert.equal(deploymentOf(FOREIGN), null);
});

test('verification pins: v1 and v2 docs keep their own hash, everything else follows the trusted one', () => {
  assert.equal(pinForVerification(V3_CODE_HASH, V1_CODE_HASH), V1_CODE_HASH);
  assert.equal(pinForVerification(V3_CODE_HASH, V2_CODE_HASH), V2_CODE_HASH);
  assert.equal(pinForVerification(V3_CODE_HASH, V3_CODE_HASH), V3_CODE_HASH);
  assert.equal(pinForVerification(FOREIGN, V1_CODE_HASH), V1_CODE_HASH);
  assert.equal(pinForVerification(V3_CODE_HASH, FOREIGN), V3_CODE_HASH, 'a foreign hash resolves to the trusted hash, so it FAILs');
  assert.equal(pinForVerification(FOREIGN, V3_CODE_HASH), FOREIGN, 'v3 is not history: an own pin overrides it');
});

test('findings: v3 fixes the parked-funds rule and the new ones; v1 fixes none', () => {
  for (const h of [V2_CODE_HASH, V3_CODE_HASH]) assert.equal(fixesParkedFunds(h), true);
  assert.equal(fixesParkedFunds(V1_CODE_HASH), false);
  assert.equal(fixesParkedFunds(FOREIGN), false, 'unknown deployments stay conservative');
  for (const f of ['settling', 'owed-ledger', 'tax-extras', 'tokens']) {
    assert.equal(fixesFinding(V3_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V2_CODE_HASH, f), false, f);
  }
});

test('the token allow-list defaults to the deployed testnet tUSDC; ZI_TUSDC_ACCOUNT overrides it, an empty value switches it off', () => {
  assert.equal(DEFAULT_TUSDC_ACCOUNT, 'sm1110-tusdc.testnet');
  assert.deepEqual(allowedTokens({}), [{ symbol: 'tUSDC', decimals: 6, accountId: 'sm1110-tusdc.testnet' }]);
  assert.deepEqual(allowedTokens({ ZI_TUSDC_ACCOUNT: '' }), []);
  assert.deepEqual(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), [{ symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' }]);
  assert.equal(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: '' }), 'tUSDC'), null, 'with the allow-list off every symbol is refused');
  assert.equal(tokenBySymbol(allowedTokens({}), 'USDC'), null, 'an unknown symbol is refused');
  assert.deepEqual(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), 'tUSDC'), { symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' });
  assert.equal(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), 'USDC'), null);
});

test('loadConfig: default tUSDC and RPC, a non-testnet token account is refused, an empty ZI_TUSDC_ACCOUNT keeps the allow-list empty', () => {
  assert.deepEqual(loadConfig({}).allowedTokens, [{ symbol: 'tUSDC', decimals: 6, accountId: 'sm1110-tusdc.testnet' }]);
  assert.equal(loadConfig({}).rpcUrl, 'https://rpc.testnet.fastnear.com');
  assert.deepEqual(loadConfig({ ZI_TUSDC_ACCOUNT: '' }).allowedTokens, []);
  assert.deepEqual(loadConfig({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }).allowedTokens, [{ symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' }]);
  assert.throws(() => loadConfig({ ZI_TUSDC_ACCOUNT: 'tusdc.near' }), /not a testnet account/);
});
