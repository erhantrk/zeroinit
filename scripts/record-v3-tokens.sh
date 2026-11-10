#!/usr/bin/env bash
# LIVE v3 token runs L6-L10, L14, L16 (docs/STABLECOIN.md §11.4).
# NOT RUN YET: v3 is built but not deployed; the tUSDC account id is not known yet and the sm1110-zi3-* accounts
# do not exist. Requires ZI_TUSDC_ACCOUNT (6 decimals) and registered merchant/vault/payer/sweeper accounts.
# Records fixtures/v3-tokens.json.
# Usage: scripts/record-v3-tokens.sh [SUFFIX]      default suffix V3
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V3}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
: "${ZI_TUSDC_ACCOUNT:?set ZI_TUSDC_ACCOUNT (see docs/STABLECOIN.md §2)}"
export ZI_RECORD=fixtures/v3-tokens.json
zi() { npm run -s zi -- "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }
newtok() { local id="$1" amount="$2" exp="${3:-2h}"; shift 3 || shift $#; zi invoice new --id "$id" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount "$amount" --expires-in "$exp" --token tUSDC "$@"; }

echo "== v3 L6: the plain token path (exchange), then sweep by the sweeper"
newtok "TOK-$S-A" 1
zi token register "$(acct "TOK-$S-A")"
node scripts/plain-ft-transfer.ts "$(acct "TOK-$S-A")" 1 tUSDC
zi status "TOK-$S-A"
zi sweep "TOK-$S-A"
zi verify "TOK-$S-A"

echo "== v3 L7: one-step path (init, then ft_transfer_call)"
newtok "TOK-$S-B" 1
zi init "TOK-$S-B"
zi pay "TOK-$S-B"

echo "== v3 L8: overpay via ft_transfer_call: only the price is used, the excess comes back"
newtok "TOK-$S-C" 1
zi pay "TOK-$S-C" --amount 1.5

echo "== v3 L9: underpay via ft_transfer_call is returned whole; a plain underpay stays parked (sweep UNDERPAID)"
newtok "TOK-$S-D" 1
zi pay "TOK-$S-D" --amount 0.5 || echo "(expected: payment_rejected underpaid, exit 1)"
newtok "TOK-$S-E" 1
zi token register "$(acct "TOK-$S-E")"
node scripts/plain-ft-transfer.ts "$(acct "TOK-$S-E")" 0.5 tUSDC
zi sweep "TOK-$S-E" || echo "(expected: UNDERPAID, exit 1; the tokens stay parked)"

echo "== v3 L10: expiry via ft_transfer_call: returned whole, status EXPIRED"
newtok "TOK-$S-F" 1 1m
sleep 75
zi pay "TOK-$S-F" || echo "(expected: payment_rejected expired, exit 1)"

echo "== v3 L14: token refund_payer after the grace, merchant never registered"
# The merchant must be an account that exists and is NEVER registered on the token. record-v3-failures.sh (L13) registers
# ZI_UNREG_ACCOUNT, so this run needs its own account. --offline skips the online registration check.
# The refund is allowed after max(expiry, paid_at) + grace = about 4 minutes after issuing; a pay takes three transactions, so expiry is 3m.
zi invoice new --id "TOK-$S-G" --merchant "${ZI_UNREG2_ACCOUNT:?set ZI_UNREG2_ACCOUNT (exists on NEAR, never registered on tUSDC)}" --tax-vault "$V" --tax-bps 800 \
  --amount 1 --expires-in 3m --grace 60000ms --token tUSDC --offline
zi pay "TOK-$S-G" || echo "(expected: PAYOUT_PENDING, exit 1: the merchant share failed)"
sleep 240
zi refund-payer "TOK-$S-G"

echo "== v3 L16: NEAR attached to a token invoice is refunded (REFUNDED_WRONG_ASSET)"
echo "  call pay() with a NEAR deposit on $(acct "TOK-$S-B") by hand (near-cli-rs: call <account> pay '{}' --deposit 0.1 --gas 100)"
echo "  expected: REFUNDED_WRONG_ASSET, the deposit back, status unchanged"

echo "replay: npm run zi -- replay fixtures/v3-tokens.json"
