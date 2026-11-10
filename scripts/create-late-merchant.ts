// Creates late.<ZI_MERCHANT_ACCOUNT> (a sub-account of the v3 merchant, "L3" in docs/STABLECOIN.md §11.4), signed with the parent's own key from .env
// (never printed). The invoices LATE-V3 and LATE-V31 name this id as their merchant; it did not exist when they were paid, so the merchant's share
// is owed on the invoice account. Once it exists, `zi sweep` delivers it. The new account gets the parent's PUBLIC key as a full-access key.
// Usage: node scripts/create-late-merchant.ts            (refuses if the account already exists)
import { loadConfig } from '../src/config.ts';
import { checkNetwork, viewAccount } from '../src/rpc.ts';
import { sendActions } from '../src/send.ts';
import { keyPairFromSecret, actCreateAccount, actTransfer, actAddFullAccessKey } from '../src/tx.ts';
import { parseNear, formatNear } from '../src/bytes.ts';

const parent = process.env.ZI_MERCHANT_ACCOUNT;
const secret = process.env.ZI_MERCHANT_KEY;
if (!parent || !secret) throw new Error('set ZI_MERCHANT_ACCOUNT and ZI_MERCHANT_KEY');
const child = `late.${parent}`;
if (child !== 'late.sm1110-zi3-merchant.testnet') throw new Error(`refusing to create ${child}: this script creates exactly late.sm1110-zi3-merchant.testnet`);
const cfg = loadConfig();
await checkNetwork(cfg);
const state = await viewAccount(cfg, child);
if (state.kind !== 'NONEXISTENT') { console.error(`${child} already exists (${state.kind}); nothing to do`); process.exit(1); }
const kp = keyPairFromSecret(secret);
const funding = parseNear('0.1');
const p = await sendActions(cfg, { accountId: parent, secret }, child, [actCreateAccount(), actTransfer(funding), actAddFullAccessKey(kp.publicKey)], 'create-account');
console.log(`TX ${p.txHash}`);
console.log(`RESULT ${p.success ? 'SUCCESS' : 'FAILED ' + JSON.stringify(p.failures)}`);
console.log(`CREATED ${child} funded ${formatNear(funding)} NEAR, full-access key = the parent's public key`);
console.log(`LINK https://testnet.nearblocks.io/txns/${p.txHash}`);
process.exitCode = p.success ? 0 : 1;
