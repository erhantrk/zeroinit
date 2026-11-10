// The exchange path for a token invoice: register the receiver on the token (NEP-145) if needed, then send
// a bare `ft_transfer` (no state init, no ft_transfer_call). Signed with the payer key.
// Usage: node scripts/plain-ft-transfer.ts <receiver-account> <amount> [token-symbol]
import { loadConfig, tokenBySymbol } from '../src/config.ts';
import { checkNetwork } from '../src/rpc.ts';
import { sendActions } from '../src/send.ts';
import { actFtTransfer, actStorageDeposit, ftBalanceOf, formatUnits, parseUnits, storageBalanceBounds, storageBalanceOf } from '../src/ft.ts';

const [receiver, amountText, symbol = 'tUSDC'] = process.argv.slice(2);
if (!receiver || !amountText) { console.error('usage: node scripts/plain-ft-transfer.ts <receiver> <amount> [token-symbol]'); process.exit(2); }
const cfg = loadConfig();
const entry = tokenBySymbol(cfg.allowedTokens, symbol);
if (!entry) throw new Error(`token ${symbol} is not on the allow-list (set ZI_TUSDC_ACCOUNT)`);
if (!cfg.payer) throw new Error('set ZI_PAYER_ACCOUNT and ZI_PAYER_KEY');
await checkNetwork(cfg);
const amount = parseUnits(amountText, entry.decimals);
const before = await ftBalanceOf(cfg, entry.accountId, cfg.payer.accountId).catch(() => null);
if (before !== null && before < amount) {
  console.error(`payer has ${formatUnits(before, entry.decimals)} ${entry.symbol}, needs ${amountText}`);
  process.exit(1);
}
if ((await storageBalanceOf(cfg, entry.accountId, receiver)) === null) {
  const bounds = await storageBalanceBounds(cfg, entry.accountId);
  const reg = await sendActions(cfg, cfg.payer, entry.accountId, [actStorageDeposit(receiver, bounds.min)], 'register');
  console.log(`REGISTER ${reg.success ? 'SUCCESS' : 'FAILED'} ${receiver} on ${entry.accountId}`);
  if (!reg.success) process.exit(1);
}
const p = await sendActions(cfg, cfg.payer, entry.accountId, [actFtTransfer(receiver, amount)], 'ft-transfer');
console.log(`TX ${p.txHash}`);
console.log(`RESULT ${p.success ? 'SUCCESS' : 'FAILED ' + JSON.stringify(p.failures)}`);
console.log(`FT_TRANSFER ${receiver} ${amountText} ${entry.symbol}`);
process.exitCode = p.success ? 0 : 1;
