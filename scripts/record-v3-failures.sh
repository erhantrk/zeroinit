#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3 (Ut7EQhLD…reWa) on 2026-11-10. The client default is v3.1 now, so re-running it records v3.1 invoices; use the record-v31-*.sh scripts for v3.1.
# LIVE v3 failure runs L11-L13, L19 (docs/STABLECOIN.md §11.4).
# Requires a second mock token (ZI_FAKE_TOKEN_ACCOUNT, same test-usdc source) and an account that exists on NEAR but is not
# registered on tUSDC (ZI_UNREG_ACCOUNT).
# Records fixtures/v3/failures.json.
# Usage: scripts/record-v3-failures.sh [SUFFIX]      default suffix V3
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V3}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
: "${ZI_TUSDC_ACCOUNT:?set ZI_TUSDC_ACCOUNT}"
FAKE="${ZI_FAKE_TOKEN_ACCOUNT:?set ZI_FAKE_TOKEN_ACCOUNT (a second test-usdc instance)}"
UNREG="${ZI_UNREG_ACCOUNT:?set ZI_UNREG_ACCOUNT (exists on NEAR, not registered on tUSDC)}"
export ZI_RECORD=fixtures/v3/failures.json
zi() { node src/cli.ts "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }

echo "== v3 L13: an unregistered receiver records the failed share and a later sweep delivers it"
zi invoice new --id "UNREG-$S" --merchant "$UNREG" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC --offline
zi init "UNREG-$S"
zi pay "UNREG-$S" || echo "(expected: the merchant share failed; the tax was paid, status SETTLING)"
zi token register "$UNREG"            # once registered, the retry can deliver
zi sweep "UNREG-$S"

echo "== v3 L11: the wrong token is returned (payment_rejected wrong_token)"
# The fake token is not on the client allow-list, so the call is built by scripts/live-call.ts; the invoice names tUSDC, so ft_on_transfer
# sees predecessor != token and returns the amount.
zi invoice new --id "WRONGTOK-$S" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "WRONGTOK-$S"
node scripts/live-call.ts ft-call "$FAKE" "WRONGTOK-$S" 1 pay 200 wrong-token

echo "== v3 L12: a wrong msg is returned (empty, then an unknown action) on a fresh token invoice"
zi invoice new --id "BADMSG-$S" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "BADMSG-$S"
node scripts/live-call.ts ft-call "$ZI_TUSDC_ACCOUNT" "BADMSG-$S" 1 empty 200 bad-msg-empty
node scripts/live-call.ts ft-call "$ZI_TUSDC_ACCOUNT" "BADMSG-$S" 1 bad 200 bad-msg-action

echo "== v3 L19: ft_transfer_call with little gas (${LOWGAS:-40} Tgas); record what the chain says"
zi invoice new --id "LOWGAS-$S" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "LOWGAS-$S"
node scripts/live-call.ts ft-call "$ZI_TUSDC_ACCOUNT" "LOWGAS-$S" 1 pay "${LOWGAS:-40}" low-gas || echo "(see the output: the chain decides)"

echo "replay: npm run zi -- replay fixtures/v3/failures.json"
