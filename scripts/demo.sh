#!/usr/bin/env bash
# Usage: scripts/demo.sh <suffix>     e.g. scripts/demo.sh 1112a   (invoice ids INV-<suffix>-A/B/C must be new each run)
# Non-interactive (no TTY): the prompts are skipped. The recorded v2 run: ZI_RECORD=fixtures/v2/demo-run.json scripts/demo.sh 1111-V2 </dev/null
# The recorded v3.1 run (current contract, NEAR): ZI_RECORD=fixtures/v31/demo-run.json scripts/demo.sh 1111-V31 </dev/null
# (the v3 run, fixtures/v3/demo-run.json, used suffix 1111-V3 on the previous contract; v2 and v3 need ZI_CODE_HASH=<their hash>; the default is v3.1.)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:?give a unique suffix}"
M="${ZI_SWEEPER_ACCOUNT}"            # merchant = sweeper account in the demo
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT in .env}"
pause() { read -r -p "── $1 (enter) " _ || true; }
pause "Shot 2: merchant issues an invoice (no transaction)"
node src/cli.ts invoice new --id "INV-$S-A" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
node src/cli.ts status "INV-$S-A"
pause "Shot 3: payer pays in one transaction"
node src/cli.ts pay "INV-$S-A"
pause "Shot 4: exchange-style plain transfer"
node src/cli.ts invoice new --id "INV-$S-B" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
ACC=$(node -e "console.log(require('./invoices/INV-$S-B.json').account_id)")
if [ -t 0 ]; then
  near tokens "$ZI_PAYER_ACCOUNT" send-near "$ACC" '1 NEAR' network-config testnet sign-with-legacy-keychain send
else
  # No TTY: near-cli-rs refuses its "account does not exist" confirmation. This sends the same
  # plain Transfer action (no state init), exactly what an exchange withdrawal does.
  node scripts/plain-transfer.ts "$ACC" 1
fi
node src/cli.ts status "INV-$S-B"
node src/cli.ts sweep "INV-$S-B"
pause "Shot 5: anyone can verify; underpay is refunded"
node src/cli.ts verify "INV-$S-A"
node src/cli.ts invoice new --id "INV-$S-C" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
# An underpayment is refunded by the contract: `zi pay` exits 1 (not PAID), which is the expected demo outcome.
node src/cli.ts pay "INV-$S-C" --amount 0.5 || echo "(expected: REFUNDED_UNDERPAID, exit 1)"
