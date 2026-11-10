// Issuance rejects malformed merchant / tax_vault account ids (they would make STATE undeserializable).
// Run: node --test test/issuance-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceDoc, isValidNearAccountId } from '../src/invoice.ts';
import { parseNear } from '../src/bytes.ts';

const CODE_HASH = '4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA';
const terms = (merchant: string, tax_vault: string) => ({ invoice_id: 'INV-V-1', merchant, tax_vault, tax_bps: 800,
  amount: parseNear('1'), expires_at_ms: 1794700800000n, salt: 1n });

test('valid NEAR account ids are accepted', () => {
  for (const id of ['zi-merchant.testnet', 'sm1110-zi-taxvault.testnet', 'a.b.c', 'ab', 'a_b-c.near', '0'.repeat(64)]) assert.ok(isValidNearAccountId(id), id);
  assert.equal(createInvoiceDoc('0u', CODE_HASH, terms('zi-merchant.testnet', 'zi-taxvault.testnet')).account_id.startsWith('0u'), true);
});

test('invalid NEAR account ids are rejected', () => {
  for (const id of ['Not A Valid!!', 'ALSO..BAD', 'a', '', 'x'.repeat(65), 'a..b', '.a', 'a.', '-a', 'a-', 'a--b', 'a b', 'UPPER.testnet']) assert.equal(isValidNearAccountId(id), false, id);
  assert.throws(() => createInvoiceDoc('0u', CODE_HASH, terms('Not A Valid!!', 'zi-taxvault.testnet')), /merchant .* not a valid NEAR account id/);
  assert.throws(() => createInvoiceDoc('0u', CODE_HASH, terms('zi-merchant.testnet', 'ALSO..BAD')), /tax_vault .* not a valid NEAR account id/);
});

// ---- token issuance (docs/STABLECOIN.md §7.1, §10): registration and metadata are checked online ----
import { fakeRpc, statusResult, viewResult } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { assertAccountsUsable } from '../src/invoice.ts';

const TOKEN = 'tusdc.example.testnet';
const tokenChain = (opts: { symbol?: string; decimals?: number; merchantRegistered?: boolean; vaultRegistered?: boolean } = {}) => ({
  status: () => statusResult('testnet'),
  query: (p: any) => {
    if (p.request_type === 'view_account') return { amount: '1', storage_usage: 1, global_contract_hash: null };
    if (p.request_type === 'call_function') {
      if (p.method_name === 'ft_metadata') return viewResult({ spec: 'ft-1.0.0', name: 'Test USDC', symbol: opts.symbol ?? 'tUSDC', decimals: opts.decimals ?? 6 });
      if (p.method_name === 'storage_balance_of') {
        const account = JSON.parse(Buffer.from(p.args_base64, 'base64').toString('utf8')).account_id;
        const registered = account === 'zi-merchant.testnet' ? (opts.merchantRegistered ?? true) : (opts.vaultRegistered ?? true);
        return viewResult(registered ? { total: '1250000000000000000000', available: '0' } : null);
      }
    }
    return { __error: { name: 'HANDLER_ERROR', cause: { name: 'METHOD_NOT_FOUND' }, message: p.method_name } };
  },
});
const cfgFor = (url: string) => loadConfig({ ZI_RPC_URL: url, ZI_TUSDC_ACCOUNT: TOKEN });

test('token issuance: both recipients must be registered, and ft_metadata must match the allow-list', async () => {
  const ok = await fakeRpc(tokenChain());
  try {
    await assertAccountsUsable(cfgFor(ok.url), { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6 });
  } finally { await ok.close(); }
  const merchant = await fakeRpc(tokenChain({ merchantRegistered: false }));
  try {
    await assert.rejects(assertAccountsUsable(cfgFor(merchant.url), { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6 }), /merchant .* not registered on token .*zi token register/);
  } finally { await merchant.close(); }
  const vault = await fakeRpc(tokenChain({ vaultRegistered: false }));
  try {
    await assert.rejects(assertAccountsUsable(cfgFor(vault.url), { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6 }), /tax_vault .* not registered on token/);
  } finally { await vault.close(); }
  const decimals = await fakeRpc(tokenChain({ decimals: 8 }));
  try {
    await assert.rejects(assertAccountsUsable(cfgFor(decimals.url), { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6 }), /reports 8 decimals/);
  } finally { await decimals.close(); }
  const symbol = await fakeRpc(tokenChain({ symbol: 'USDC' }));
  try {
    await assert.rejects(assertAccountsUsable(cfgFor(symbol.url), { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', token: TOKEN, token_symbol: 'tUSDC', token_decimals: 6 }), /reports symbol "USDC"/);
  } finally { await symbol.close(); }
});
