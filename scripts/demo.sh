#!/usr/bin/env bash
# Usage: scripts/demo.sh <suffix>     e.g. scripts/demo.sh 1112a   (invoice ids must be new each run)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:?give a unique suffix}"
M="${ZI_SWEEPER_ACCOUNT}"            # merchant = sweeper account in the demo
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT in .env}"
pause() { read -r -p "── $1 (enter) " _ || true; }
pause "Shot 2: merchant issues an invoice (no transaction)"
npm run -s zi -- invoice new --id "INV-$S-A" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
npm run -s zi -- status "INV-$S-A"
pause "Shot 3: payer pays in one transaction"
npm run -s zi -- pay "INV-$S-A"
pause "Shot 4: exchange-style plain transfer"
npm run -s zi -- invoice new --id "INV-$S-B" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
ACC=$(node -e "console.log(require('./invoices/INV-$S-B.json').account_id)")
if [ -t 0 ]; then
  near tokens "$ZI_PAYER_ACCOUNT" send-near "$ACC" '1 NEAR' network-config testnet sign-with-legacy-keychain send
else
  # No TTY: near-cli-rs refuses its "account does not exist" confirmation. This sends the same
  # plain Transfer action (no state init), exactly what an exchange withdrawal does.
  node scripts/plain-transfer.ts "$ACC" 1
fi
npm run -s zi -- status "INV-$S-B"
npm run -s zi -- sweep "INV-$S-B"
pause "Shot 5: anyone can verify; underpay is refunded"
npm run -s zi -- verify "INV-$S-A"
npm run -s zi -- invoice new --id "INV-$S-C" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
npm run -s zi -- pay "INV-$S-C" --amount 0.5
