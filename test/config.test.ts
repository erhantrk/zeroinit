// Deployments and the token allow-list (docs/STABLECOIN.md §2, §4.7, §10).
// Run: node --test test/config.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V1_CODE_HASH, V2_CODE_HASH, V3_CODE_HASH, V31_CODE_HASH, V32_CODE_HASH, V32R_CODE_HASH, V33_CODE_HASH, DEPLOYED_CODE_HASH, HISTORICAL_TOKENS, readOnlyAllowList, KNOWN_DEPLOYMENTS, deploymentOf, deploymentLabel,
  trustedCodeHash, pinForVerification, fixesParkedFunds, fixesFinding, allowedTokens, tokenBySymbol, loadConfig, DEFAULT_TUSDC_ACCOUNT } from '../src/config.ts';
import { FOREIGN } from './helpers.ts';

test('v3.3 is the current deployment; v3.2r, v3.2, v3.1, v3, v2 and v1 are historical', () => {
  assert.equal(V33_CODE_HASH, 'CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb');
  assert.equal(V32R_CODE_HASH, 'BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry');
  assert.equal(V32_CODE_HASH, '6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ');
  assert.equal(V31_CODE_HASH, '2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX');
  assert.equal(V3_CODE_HASH, 'Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa');
  assert.equal(new Set([V33_CODE_HASH, V32R_CODE_HASH, V32_CODE_HASH, V31_CODE_HASH, V3_CODE_HASH, V2_CODE_HASH, V1_CODE_HASH]).size, 7);
  assert.equal(DEPLOYED_CODE_HASH, V33_CODE_HASH);
  assert.equal(trustedCodeHash({ codeHashB58: null }), V33_CODE_HASH);
  assert.deepEqual(KNOWN_DEPLOYMENTS.map((d) => [d.version, d.historical, d.layout]),
    [['v3.3', false, 3], ['v3.2r', true, 3], ['v3.2', true, 3], ['v3.1', true, 3], ['v3', true, 3], ['v2', true, 1], ['v1', true, 1]]);
  assert.match(deploymentLabel(V33_CODE_HASH), /^v3\.3 \(current, deployed on testnet/);
  assert.match(deploymentLabel(V32R_CODE_HASH), /^v3\.2r \(history/);
  assert.match(deploymentLabel(V32_CODE_HASH), /^v3\.2 \(history/);
  assert.match(deploymentLabel(V31_CODE_HASH), /^v3\.1 \(history/);
  assert.match(deploymentLabel(V3_CODE_HASH), /^v3 \(history/);
  assert.match(deploymentLabel(V2_CODE_HASH), /^v2 \(history/);
  assert.match(deploymentLabel(V1_CODE_HASH), /^v1 \(history/);
  assert.match(deploymentLabel(FOREIGN), /^custom/);
  assert.equal(deploymentOf(FOREIGN), null);
});

test('verification pins: every history deployment keeps its own hash, everything else follows the trusted one', () => {
  for (const h of [V1_CODE_HASH, V2_CODE_HASH, V3_CODE_HASH, V31_CODE_HASH, V32_CODE_HASH, V32R_CODE_HASH]) assert.equal(pinForVerification(V33_CODE_HASH, h), h);
  assert.equal(pinForVerification(V33_CODE_HASH, V33_CODE_HASH), V33_CODE_HASH);
  assert.equal(pinForVerification(FOREIGN, V1_CODE_HASH), V1_CODE_HASH);
  assert.equal(pinForVerification(V33_CODE_HASH, FOREIGN), V33_CODE_HASH, 'a foreign hash resolves to the trusted hash, so it FAILs');
  assert.equal(pinForVerification(FOREIGN, V33_CODE_HASH), FOREIGN, 'v3.3 is not history: an own pin overrides it');
});

test('only v3.3 counts parked funds toward the price', () => {
  assert.equal(fixesFinding(V33_CODE_HASH, 'parked-counted'), true);
  for (const h of [V32R_CODE_HASH, V32_CODE_HASH, V31_CODE_HASH, V3_CODE_HASH, V2_CODE_HASH, V1_CODE_HASH]) assert.equal(fixesFinding(h, 'parked-counted'), false);
  for (const f of KNOWN_DEPLOYMENTS.find((d) => d.version === 'v3.2r')!.fixes) assert.equal(fixesFinding(V33_CODE_HASH, f), true, `v3.3 keeps ${f}`);
});

test('history token: accepted only for read-only checks of a history deployment\'s documents', () => {
  const cfg = { allowedTokens: allowedTokens({}) };
  assert.deepEqual(readOnlyAllowList(cfg, V33_CODE_HASH, 'sm1110-tusdc.testnet'), cfg.allowedTokens, 'a current document gets the client allow-list only');
  assert.deepEqual(readOnlyAllowList(cfg, V32R_CODE_HASH, 'sm1110-tusdc.testnet'), HISTORICAL_TOKENS);
  assert.deepEqual(readOnlyAllowList(cfg, V32R_CODE_HASH, 'zeroinit-tusdc.testnet'), cfg.allowedTokens);
  assert.deepEqual(readOnlyAllowList(cfg, FOREIGN, 'sm1110-tusdc.testnet'), cfg.allowedTokens);
});

test('findings: v3 fixes the parked-funds rule and the new ones; v1 fixes none', () => {
  for (const h of [V2_CODE_HASH, V3_CODE_HASH, V31_CODE_HASH, V32_CODE_HASH, V32R_CODE_HASH]) assert.equal(fixesParkedFunds(h), true);
  assert.equal(fixesParkedFunds(V1_CODE_HASH), false);
  assert.equal(fixesParkedFunds(FOREIGN), false, 'unknown deployments stay conservative');
  for (const f of ['settling', 'owed-ledger', 'tax-extras', 'tokens']) {
    assert.equal(fixesFinding(V3_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V31_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V32_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V32R_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V2_CODE_HASH, f), false, f);
  }
  assert.equal(fixesFinding(V31_CODE_HASH, 'token-sweep-race'), true, 'v3.1 is the F1 fix for the busy rejection');
  assert.equal(fixesFinding(V32_CODE_HASH, 'token-sweep-race'), true);
  assert.equal(fixesFinding(V32R_CODE_HASH, 'token-sweep-race'), true);
  assert.equal(fixesFinding(V3_CODE_HASH, 'token-sweep-race'), false, 'v3 has the race');
  for (const f of ['token-sweep-race-all-rejections', 'late-release-by-sweep', 'paid-at-ms-first-settlement', 'status-from-promise']) {
    assert.equal(fixesFinding(V32_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V32R_CODE_HASH, f), true, f);
    assert.equal(fixesFinding(V31_CODE_HASH, f), false, `${f}: v3.1 does not have it`);
  }
});

test('the token allow-list defaults to the deployed testnet tUSDC; ZI_TUSDC_ACCOUNT overrides it, an empty value switches it off', () => {
  assert.equal(DEFAULT_TUSDC_ACCOUNT, 'zeroinit-tusdc.testnet');
  assert.deepEqual(allowedTokens({}), [{ symbol: 'tUSDC', decimals: 6, accountId: 'zeroinit-tusdc.testnet' }]);
  assert.deepEqual(allowedTokens({ ZI_TUSDC_ACCOUNT: '' }), []);
  assert.deepEqual(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), [{ symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' }]);
  assert.equal(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: '' }), 'tUSDC'), null, 'with the allow-list off every symbol is refused');
  assert.equal(tokenBySymbol(allowedTokens({}), 'USDC'), null, 'an unknown symbol is refused');
  assert.deepEqual(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), 'tUSDC'), { symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' });
  assert.equal(tokenBySymbol(allowedTokens({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }), 'USDC'), null);
});

test('loadConfig: default tUSDC and RPC, a non-testnet token account is refused, an empty ZI_TUSDC_ACCOUNT keeps the allow-list empty', () => {
  assert.deepEqual(loadConfig({}).allowedTokens, [{ symbol: 'tUSDC', decimals: 6, accountId: 'zeroinit-tusdc.testnet' }]);
  assert.equal(loadConfig({}).rpcUrl, 'https://rpc.testnet.fastnear.com');
  assert.deepEqual(loadConfig({ ZI_TUSDC_ACCOUNT: '' }).allowedTokens, []);
  assert.deepEqual(loadConfig({ ZI_TUSDC_ACCOUNT: 'tusdc.testnet' }).allowedTokens, [{ symbol: 'tUSDC', decimals: 6, accountId: 'tusdc.testnet' }]);
  assert.throws(() => loadConfig({ ZI_TUSDC_ACCOUNT: 'tusdc.near' }), /not a testnet account/);
});
