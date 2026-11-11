#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3 (Ut7EQhLD…reWa) on 2026-11-10. The client default is v3.2 now, so re-running it records v3.2 invoices; use the record-v32-*.sh scripts (and demo.sh / demo-token.sh) for v3.2.
# LIVE v3 run L1 (docs/STABLECOIN.md §11.4): NEAR parity on the v3 deployment.
# Run against the deployed v3 (Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa) with the operator's sm1110-zi3-* accounts from .env.
# Records fixtures/v3/near.json: pay, plain transfer + sweep by the sweeper, underpay, expired, double pay.
# Usage: scripts/record-v3-near.sh [SUFFIX]      default suffix V3; invoice ids must be new each run
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V3}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
export ZI_RECORD=fixtures/v3/near.json
zi() { node src/cli.ts "$@"; }
new() { local id="$1" exp="$2"; shift 2 || shift $#; zi invoice new --id "$id" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in "$exp" "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }

echo "== v3 L1: pay in one transaction (SETTLING -> PAID from on_settled)"
new "INV-${S}-A" 2h
zi status "INV-${S}-A"
zi pay "INV-${S}-A"
zi verify "INV-${S}-A"
zi receipt "INV-${S}-A"

echo "== v3 L1: plain transfer, then sweep by the third-party sweeper"
new "INV-${S}-B" 2h
node scripts/plain-transfer.ts "$(acct "INV-${S}-B")" 0.1
zi status "INV-${S}-B"
zi sweep "INV-${S}-B"

echo "== v3 L1: underpay is refunded, status stays OPEN"
new "INV-${S}-C" 2h
zi pay "INV-${S}-C" --amount 0.05 || echo "(expected: REFUNDED_UNDERPAID, exit 1)"

echo "== v3 L1: expired pay is refunded, status EXPIRED"
new "INV-${S}-D" 1m
sleep 75
zi pay "INV-${S}-D" || echo "(expected: REFUNDED_EXPIRED, exit 1)"

echo "== v3 L1: a second pay is REFUNDED_NOT_OPEN"
new "INV-${S}-E" 2h
zi pay "INV-${S}-E"
zi pay "INV-${S}-E" || echo "(expected: REFUNDED_NOT_OPEN, exit 1)"

echo "replay: npm run zi -- replay fixtures/v3/near.json"
