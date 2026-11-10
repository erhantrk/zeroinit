// NEP-141 helpers: views, exact unit conversion and action builders for the token flows
// (docs/STABLECOIN.md §7, §10). All amounts on chain are raw u128; no floating point anywhere.
import { base64 } from '@scure/base';
import { utf8 } from './bytes.ts';
import { actFunctionCall } from './tx.ts';
import { rpcCall, decodeViewResult } from './rpc.ts';
import type { Config } from './config.ts';

const T = 1_000_000_000_000n;
export const GAS = {
  storageDeposit: 30n * T,
  ftTransfer: 30n * T,
  ftTransferCall: 200n * T,
  fund: 10n * T,
  payNear: 100n * T,
  sweepNear: 100n * T,
  tokenSweep: 200n * T,
  refundNear: 100n * T,
  refundToken: 200n * T,
} as const;

/** 1,000 yoctoNEAR: enough for hundreds of 1-yocto `ft_transfer` calls on the invoice account. */
export const FLOAT_YOCTO = 1_000n;
const U128_MAX = (1n << 128n) - 1n;

/**
 * Strict display amount -> raw units. Digits and at most one dot, no sign, no exponent, no hex, no whitespace.
 * More fraction digits than `decimals` is an error (never rounded); the result must be > 0 and fit u128 / 10000.
 */
export function parseUnits(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error(`bad decimals: ${decimals}`);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`bad token amount "${text}": use digits and one dot, e.g. 1.5`);
  const frac = m[2] ?? '';
  if (frac.length > decimals) throw new Error(`token amount "${text}" has more than ${decimals} decimals`);
  const v = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (v <= 0n) throw new Error('token amount must be > 0');
  if (v > U128_MAX / 10000n) throw new Error('token amount is too large (amount × tax_bps must fit u128)');
  return v;
}

/** Raw units -> canonical display string (trailing fraction zeros dropped, no floating point). */
export function formatUnits(v: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error(`bad decimals: ${decimals}`);
  if (v < 0n || v > U128_MAX) throw new Error(`amount out of u128 range: ${v}`);
  const d = 10n ** BigInt(decimals);
  const whole = v / d;
  const frac = (v % d).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const fnArgs = (o: object): Uint8Array => utf8(JSON.stringify(o));

export const actStorageDeposit = (accountId: string, deposit: bigint, registrationOnly = true): Uint8Array =>
  actFunctionCall('storage_deposit', fnArgs({ account_id: accountId, registration_only: registrationOnly }), GAS.storageDeposit, deposit);
export const actFtTransfer = (receiverId: string, amount: bigint): Uint8Array =>
  actFunctionCall('ft_transfer', fnArgs({ receiver_id: receiverId, amount: amount.toString() }), GAS.ftTransfer, 1n);
export const actFtTransferCall = (receiverId: string, amount: bigint, msg: string): Uint8Array =>
  actFunctionCall('ft_transfer_call', fnArgs({ receiver_id: receiverId, amount: amount.toString(), msg }), GAS.ftTransferCall, 1n);
export const actFund = (deposit = FLOAT_YOCTO): Uint8Array => actFunctionCall('fund', utf8('{}'), GAS.fund, deposit);
/** The strict msg `ft_on_transfer` accepts. */
export const payMsg = (invoiceId?: string): string =>
  JSON.stringify(invoiceId === undefined ? { action: 'pay' } : { action: 'pay', invoice_id: invoiceId });

function view(cfg: Config, token: string, method: string, args: object, label?: string): Promise<any> {
  return rpcCall(cfg, 'query', { request_type: 'call_function', finality: 'final', account_id: token, method_name: method,
    args_base64: base64.encode(utf8(JSON.stringify(args))) }, label ?? `ft: ${method}`)
    .then((r) => decodeViewResult(r));
}

export interface FtMetadata { spec?: string; name?: string; symbol: string; decimals: number }
export async function ftMetadata(cfg: Config, token: string): Promise<FtMetadata> {
  const m = await view(cfg, token, 'ft_metadata', {});
  return { ...m, symbol: String(m.symbol), decimals: Number(m.decimals) };
}
export async function ftBalanceOf(cfg: Config, token: string, accountId: string): Promise<bigint> {
  const v = await view(cfg, token, 'ft_balance_of', { account_id: accountId }, `ft: ft_balance_of ${accountId}`);
  return BigInt(String(v));
}
export async function storageBalanceOf(cfg: Config, token: string, accountId: string): Promise<{ total: bigint; available: bigint } | null> {
  const v = await view(cfg, token, 'storage_balance_of', { account_id: accountId }, `ft: storage_balance_of ${accountId}`);
  if (v === null || v === undefined) return null;
  return { total: BigInt(String(v.total)), available: BigInt(String(v.available)) };
}
export async function storageBalanceBounds(cfg: Config, token: string): Promise<{ min: bigint; max: bigint | null }> {
  const v = await view(cfg, token, 'storage_balance_bounds', {}, 'ft: storage_balance_bounds');
  return { min: BigInt(String(v.min)), max: v.max === null || v.max === undefined ? null : BigInt(String(v.max)) };
}
