#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3 (Ut7EQhLD…reWa) on 2026-11-10. The client default is v3.1 now, so re-running it records v3.1 invoices; use the record-v31-*.sh scripts for v3.1.
# LIVE v3 runs L2-L5 (docs/STABLECOIN.md §11.4): the three v2 residuals and the new tax rule.
# Run against the deployed v3 with the operator's sm1110-zi3-* accounts (see docs/SPIKES.md "Contract v3 live").
#   L2  a merchant that does not exist yet (late.sm1110-zi3-merchant.testnet is NOT created): pay => SETTLING,
#       transfer_failed, no invoice_paid, PAYOUT_PENDING
#   L3  (not run: it needs a created account) the parent creates late.…: sweep => the merchant is paid, invoice_paid retried: true, status PAID
#   L4  short grace, merchant never created: refund_payer before the window (NOT_YET, recorded) and after it => REFUNDED
#   L5  plain 0.05, pay 0.1, sweep: the vault gets 0.012 in total, the merchant 0.138
# Records fixtures/v3/fixes.json.
# Usage: scripts/record-v3-fixes.sh [SUFFIX]      default suffix V3
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V3}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
LATE="${LATE_MERCHANT:-late.sm1110-zi3-merchant.testnet}"     # must NOT exist during L2; the parent creates it for L3
NEVER="${NEVER_MERCHANT:-never.sm1110-zi3-merchant.testnet}"  # must NEVER exist: L4 needs a merchant that stays missing
export ZI_RECORD=fixtures/v3/fixes.json
zi() { node src/cli.ts "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }

echo "== v3 L2: a merchant that does not exist yet (--offline: the issuance check would refuse it)"
zi invoice new --id "LATE-$S" --merchant "$LATE" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in 2h --offline
zi pay "LATE-$S" || echo "(expected: PAYOUT_PENDING, exit 1, status SETTLING, transfer_failed, no invoice_paid)"
zi status "LATE-$S"

echo "== v3 L3: NOT RUN. The parent account would have to create late.sm1110-zi3-merchant.testnet, and this run is not allowed to create accounts."
echo "   The same 'retry delivers the owed share' is recorded for NEAR on v2 (AUD2-V2 re-sweep) and for tokens on v3 (L13, an unregistered merchant that is registered later)."

echo "== v3 L4: short grace, merchant never created, refund_payer"
zi invoice new --id "REFUND-$S" --merchant "$NEVER" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in 1m --grace 60000ms --offline
zi pay "REFUND-$S" || echo "(expected: PAYOUT_PENDING, exit 1)"
zi refund-payer "REFUND-$S" || echo "(expected: NOT_YET, exit 1: the window has not passed)"
sleep 125
zi refund-payer "REFUND-$S"
zi status "REFUND-$S"

echo "== v3 L5: a parked part is taxed too (0.05 parked, pay 0.1, sweep)"
zi invoice new --id "TAX-$S" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in 2h
node scripts/plain-transfer.ts "$(acct "TAX-$S")" 0.05
zi pay "TAX-$S"
zi sweep "TAX-$S"
zi status "TAX-$S"

echo "replay: npm run zi -- replay fixtures/v3/fixes.json"
