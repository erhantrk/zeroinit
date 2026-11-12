// "Committed wasm = deployed code": each committed wasm hashes to the code hash the client pins for that deployment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { base58 } from '@scure/base';
import { V32_CODE_HASH, V32R_CODE_HASH } from '../src/config.ts';

const hashOf = (f: string) => base58.encode(createHash('sha256').update(readFileSync(f)).digest());

test('contract/res/v3.2/ is the v3.2 wasm and contract/res/v3.2r/ the v3.2r wasm (the reproducible build of commit 4116e69)', () => {
  assert.equal(hashOf('contract/res/v3.2/zeroinit_invoice.wasm'), V32_CODE_HASH);
  assert.equal(hashOf('contract/res/v3.2r/zeroinit_invoice.wasm'), V32R_CODE_HASH);
  const r = readFileSync('contract/res/v3.2r/zeroinit_invoice.wasm');
  assert.equal(r.length, 163788);
  assert.equal(createHash('sha256').update(r).digest('hex'), '9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92');
  assert.equal(readFileSync('contract/res/v3.2/zeroinit_invoice.wasm').length, 164040);
});
