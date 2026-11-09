// Minimal Borsh writer helpers. All integers little-endian. Strings/Vec<u8> = u32 length + bytes.
const te = new TextEncoder();

export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const u8 = (n: number): Uint8Array => Uint8Array.of(n & 0xff);
export function u16(n: number): Uint8Array { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
export function u32(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
export function u64(n: bigint | number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
export function u128(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 128n) throw new Error(`u128 out of range: ${n}`);
  const b = new Uint8Array(16); let x = n;
  for (let i = 0; i < 16; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}
export const bytesVec = (b: Uint8Array): Uint8Array => concat(u32(b.length), b);
export const str = (s: string): Uint8Array => bytesVec(te.encode(s));
export const utf8 = (s: string): Uint8Array => te.encode(s);

export function toHex(b: Uint8Array): string { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}
/** bytewise lexicographic compare, shorter prefix first (Rust Vec<u8> Ord) */
export function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** "1.5" NEAR -> yoctoNEAR bigint, exact; max 24 decimals */
export function parseNear(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(s.trim());
  if (!m) throw new Error(`bad NEAR amount: ${s}`);
  return BigInt(m[1]) * 10n ** 24n + BigInt((m[2] ?? '').padEnd(24, '0') || '0');
}
export function formatNear(y: bigint): string {
  const whole = y / 10n ** 24n; const frac = (y % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
