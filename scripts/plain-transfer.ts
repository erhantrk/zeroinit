// Spike S-D path B: a plain Transfer (no state init) from the payer, exactly what a wallet/exchange sends.
// Usage: node scripts/plain-transfer.ts <receiver-account> <near-amount>
import { parseNear } from '../src/bytes.ts';
import { actTransfer } from '../src/tx.ts';
import { loadConfig } from '../src/config.ts';
import { sendActions } from '../src/send.ts';

const [receiver, amountNear] = process.argv.slice(2);
if (!receiver || !amountNear) { console.error('usage: node scripts/plain-transfer.ts <receiver> <near>'); process.exit(2); }
const cfg = loadConfig();
if (!cfg.payer) throw new Error('set ZI_PAYER_ACCOUNT and ZI_PAYER_KEY');
const p = await sendActions(cfg, cfg.payer, receiver, [actTransfer(parseNear(amountNear))], 'transfer');
console.log(`TX ${p.txHash}`);
console.log(`RESULT ${p.success ? 'SUCCESS' : 'FAILED ' + JSON.stringify(p.failures)}`);
process.exitCode = p.success ? 0 : 1;
