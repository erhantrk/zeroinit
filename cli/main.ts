// Entry of the npm package `zeroinit`: the `zi` CLI (src/cli.ts) as one bundled file, plus the recorded v3.2r run so the
// keyless commands work from any directory. Built by scripts/build-cli.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

const HELP = `zeroinit: NEAR invoice addresses computed from the invoice terms. Testnet only.

No keys needed:
  zeroinit verify INV-1111-V32R-A              read-only live check of a recorded invoice over testnet RPC
  zeroinit status INV-1111-V32R-A              its live state
  zeroinit replay fixtures/v32r/demo-run.json  the recorded live run, replayed offline
  zeroinit vectors                             the byte-encoding test vectors
  zeroinit check <0u address> <check code>     before sending from a wallet: does the address match its check code?
  zeroinit invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet \\
      --tax-bps 800 --amount 0.1 --expires-in 2h --offline
                                               issue an invoice: sends no transaction, writes ./invoices/TEST-1.json

With your own testnet accounts in the environment (ZI_PAYER_ACCOUNT, ZI_PAYER_KEY, ZI_SWEEPER_ACCOUNT, ZI_SWEEPER_KEY):
  zeroinit pay <id> | sweep <id> | refund-payer <id> | receipt <id> | token register <id> | serve --port 8787

The recorded invoices and fixtures of the current contract (v3.2r) ship with the package.
Docs: https://github.com/erhantrk/zeroinit`;

if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (args[0] === '--version' || args[0] === '-v') {
  console.log(__ZI_VERSION__);
  process.exit(0);
}
process.env.ZI_BUNDLED_INVOICE_DIR ??= join(root, 'invoices');
// `replay fixtures/v32r/…` names a file of the repo: when it is not in the current directory, use the copy in the package.
if (args[0] === 'replay' && args[1] && !existsSync(args[1])) {
  const shipped = join(root, args[1]);
  if (!args[1].includes('..') && existsSync(shipped)) process.argv[3] = shipped;
}
await import('../src/cli.ts');

declare const __ZI_VERSION__: string;
