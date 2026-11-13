#!/usr/bin/env bash
# LIVE v3.3 runs on testnet (contract CrwuvfSL…aVsb): the cases v3.3 changes, each recorded as a fixture that replays offline.
#   fixtures/v33/parked.json   funds parked by a plain transfer count toward the price
#     PARK-<S>-N   NEAR: plain transfer 0.3, then pay 1 -> settled once, 0.3 back to the payer, no payer recorded
#     PARK-<S>-T   tUSDC: plain ft_transfer 0.4, then ft_transfer_call 1 -> 0.4 returned, settled once
#     PARK-<S>-F   tUSDC: plain ft_transfer 1 (the full price), then ft_transfer_call 1 -> the whole call returned, the parked 1 settled
#     PARK-<S>-U   tUSDC: plain ft_transfer 0.3, then ft_transfer_call 0.5 -> underpaid, the 0.5 returned, invoice stays OPEN
#   fixtures/v33/tokens.json   one-step token payment
#     TOK-<S>-B    tUSDC: the id registered in the same transaction as ft_transfer_call; a second call is returned (not_open);
#                  then a direct call of the private callback on_pay_balance must fail
# The NEAR and tUSDC demos are scripts/demo.sh 1111-<S> and scripts/demo-token.sh 1111-<S> (with ZI_RECORD=fixtures/v33/demo-run.json /
# token-demo-run.json). Usage: scripts/record-v33.sh [SUFFIX]      default V33; invoice ids must be new each run.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V33}"
M="${ZI_MERCHANT_ACCOUNT:?set ZI_MERCHANT_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
mkdir -p fixtures/v33
zi() { node src/cli.ts "$@"; }
acc() { node -e "console.log(require('./invoices/$1.json').account_id)"; }

export ZI_RECORD="${ZI_RECORD_PARKED:-fixtures/v33/parked.json}"
echo "== NEAR: 0.3 parked by a plain transfer, then pay() with the full price"
zi invoice new --id "PARK-$S-N" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h
node scripts/plain-transfer.ts "$(acc "PARK-$S-N")" 0.3
zi status "PARK-$S-N"
zi pay "PARK-$S-N"
zi verify "PARK-$S-N"
echo "== tUSDC: 0.4 parked by a plain ft_transfer, then ft_transfer_call of the full price"
zi invoice new --id "PARK-$S-T" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi pay "PARK-$S-T" --plain --amount 0.4
zi status "PARK-$S-T"
zi pay "PARK-$S-T"
zi verify "PARK-$S-T"
echo "== tUSDC: the full price parked, then ft_transfer_call: the call comes back whole, the parked tokens settle"
zi invoice new --id "PARK-$S-F" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi pay "PARK-$S-F" --plain
zi status "PARK-$S-F"
zi pay "PARK-$S-F"
zi verify "PARK-$S-F"
echo "== tUSDC: 0.3 parked, then a call of 0.5: still short, the 0.5 comes back and the invoice stays OPEN"
zi invoice new --id "PARK-$S-U" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi pay "PARK-$S-U" --plain --amount 0.3
zi pay "PARK-$S-U" --amount 0.5 || echo "(expected: payment_rejected underpaid, exit 1)"
zi status "PARK-$S-U"

export ZI_RECORD="${ZI_RECORD_TOKENS:-fixtures/v33/tokens.json}"
echo "== tUSDC one-step: init, then [storage_deposit, ft_transfer_call] in one transaction"
zi invoice new --id "TOK-$S-B" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi pay "TOK-$S-B"
zi verify "TOK-$S-B"
echo "== a second ft_transfer_call on the PAID invoice is returned (payment_rejected not_open)"
zi pay "TOK-$S-B" || echo "(expected: payment_rejected not_open, exit 1)"
echo "== on_pay_balance is private: a direct call fails"
node scripts/live-call.ts private-callback "TOK-$S-B"
