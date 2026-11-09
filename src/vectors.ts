// Offline self-check printed by `zi vectors` (same vectors as test/vectors.test.ts).
import { fromHex, parseNear } from './bytes.ts';
import { encodeUniversalAccountId, universalStateInitBytes, deterministicStateInitBytes, deriveUniversalAccountId,
  deriveDeterministicAccountId, invoiceStateInit } from './stateinit.ts';

export function runVectors(): Array<{ name: string; ok: boolean }> {
  const out: Array<{ name: string; ok: boolean }> = [];
  const kat: Array<[Uint8Array, string]> = [
    [new Uint8Array(32), '0u0000000000000000000000000000000000000000000000000000'],
    [new Uint8Array(32).fill(255), '0uzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzg'],
    [Uint8Array.from({ length: 32 }, (_, i) => i), '0u000g40r40m30e209185gr38e1w8124gk2gahc5rr34d1p70x3rfg'],
    [Uint8Array.from({ length: 32 }, (_, i) => (7 * i) % 256), '0u003gw58w4cn32e1z8s6n8pv2d5r7ezm5hj9sn8d8nyvbvh6btbcg'],
  ];
  kat.forEach(([h, e], i) => out.push({ name: `crockford-kat-${i + 1}`, ok: encodeUniversalAccountId(h) === e }));
  const STATE = fromHex('0100000000' + '8565df94b8caab08f28cdd2ee014b800915741d4694fa840e50cca02ae5c6466' + '100e0000' + '0000000000000000' + '000000000000000000000000');
  const code = { accountId: '0sb0d7ef4f935c6ef78e08ad03569767aaec4223a3' };
  out.push({ name: 'wallet-0u', ok: deriveUniversalAccountId(universalStateInitBytes(code, [[new Uint8Array(0), STATE]])) === '0u4bfkw2qvgfzbf7zzkxykcppqymn0p2hbayjee3ygzrbhmmtyejx0' });
  out.push({ name: 'wallet-0s', ok: deriveDeterministicAccountId(deterministicStateInitBytes(code, [[new Uint8Array(0), STATE]])) === '0scdb6cfeed476fc878af9d3246768cbe803714c87' });
  const t = { invoice_id: 'INV-0001', merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: 800,
    amount: parseNear('1'), expires_at_ms: 1794700800000n, salt: 42n };
  const c = { codeHash: new Uint8Array(32).fill(0x11) };
  out.push({ name: 'example-0u', ok: invoiceStateInit('0u', c, t).accountId === '0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0' });
  out.push({ name: 'example-0s', ok: invoiceStateInit('0s', c, t).accountId === '0s36a782a21608104487f1334939347baebedfc7e1' });
  return out;
}
