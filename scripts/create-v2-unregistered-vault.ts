// Creates the ONE extra testnet account the contract-2 re-check needs: unregistered.<ZI_V2_TAXVAULT_ACCOUNT>, a sub-account of the v2 tax
// vault, signed with that account's own key (from .env, never printed). The v2 invoice AUD2-V2 names this id as its tax vault; it did not exist
// when the invoice was paid, so the tax transfer failed and 0.008 NEAR stayed owed. Once it exists, `zi sweep AUD2-V2` can deliver it.
// The new account gets the parent's PUBLIC key as a full-access key (so the parent owner controls it); no new secret is created.
// Usage: node scripts/create-v2-unregistered-vault.ts            (refuses if the account already exists)
import { loadConfig } from '../src/config.ts';
import { checkNetwork, viewAccount } from '../src/rpc.ts';
import { sendActions } from '../src/send.ts';
import { keyPairFromSecret, actCreateAccount, actTransfer, actAddFullAccessKey } from '../src/tx.ts';
import { parseNear, formatNear } from '../src/bytes.ts';

const parent = process.env.ZI_V2_TAXVAULT_ACCOUNT;
const secret = process.env.ZI_V2_TAXVAULT_KEY;
if (!parent || !secret) throw new Error('set ZI_V2_TAXVAULT_ACCOUNT and ZI_V2_TAXVAULT_KEY');
const child = `unregistered.${parent}`;
if (child !== 'unregistered.sm1110-zi-taxvault.testnet') throw new Error(`refusing to create ${child}: this script creates exactly unregistered.sm1110-zi-taxvault.testnet`);
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
