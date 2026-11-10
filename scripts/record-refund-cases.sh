#!/usr/bin/env bash
# Records fixtures/v2/refund-cases.json live on testnet (TASKS T10) with new invoice ids "<ID>-<SUFFIX>".
# Usage: scripts/record-refund-cases.sh [SUFFIX]      default suffix V2 (v2 contract); ids must be new each run
# Writes to fixtures/v2/refund-cases.json (delete the old one first). Needs .env with payer, merchant (sweeper) and taxvault.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V2}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
export ZI_RECORD=fixtures/v2/refund-cases.json
zi() { npm run -s zi -- "$@"; }
new() { zi invoice new --id "$1" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in "$2"; }
new "REF-UNDER-$S" 2h
zi pay "REF-UNDER-$S" --amount 0.05 || echo "(expected: REFUNDED_UNDERPAID, exit 1)"
new "REF-EXPIRED-$S" 1m
sleep 75
zi pay "REF-EXPIRED-$S" || echo "(expected: REFUNDED_EXPIRED, exit 1)"
new "REF-TWICE-$S" 2h
zi pay "REF-TWICE-$S"
zi pay "REF-TWICE-$S" || echo "(expected: REFUNDED_NOT_OPEN, exit 1)"
new "REF-OVER-$S" 2h
zi pay "REF-OVER-$S" --amount 0.15
new "REF-SWEEPLOW-$S" 2h
ACC=$(node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/REF-SWEEPLOW-$S.json','utf8')).account_id)")
node scripts/plain-transfer.ts "$ACC" 0.05
zi sweep "REF-SWEEPLOW-$S" || echo "(expected: UNDERPAID revert, exit 1; the 0.05 stays parked)"
zi status "REF-SWEEPLOW-$S"
