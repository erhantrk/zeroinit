// The address check code: stable, 4 Crockford characters, catches every single-character change of a real invoice address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCode, checkCodeMatches, normalizeCheckCode } from '../src/checkcode.ts';

const addr = JSON.parse(readFileSync('invoices/examples/INV-0001.json', 'utf8')).account_id as string;

test('check code: 4 Crockford base32 characters, deterministic', () => {
  const c = checkCode(addr);
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(checkCode(addr), c);
  assert.ok(checkCodeMatches(addr, c.toLowerCase()));
  assert.ok(checkCodeMatches(` ${addr} `, ` ${c.slice(0, 2)}-${c.slice(2)} `));
});

test('check code: look-alike letters are read as digits', () => {
  assert.equal(normalizeCheckCode('o1l i'), '0111');
});

test('check code: every single-character change of the address changes the code', () => {
  const c = checkCode(addr);
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let changed = 0;
  for (let i = 2; i < addr.length; i++) {
    for (const ch of alphabet) {
      if (ch === addr[i]) continue;
      const typo = addr.slice(0, i) + ch + addr.slice(i + 1);
      changed++;
      assert.ok(!checkCodeMatches(typo, c), `typo at ${i} (${ch}) passes`);
    }
  }
  assert.ok(changed > 1000);
});
