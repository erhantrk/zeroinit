#!/usr/bin/env bash
# LIVE v3 failure runs L11-L13, L19 (docs/STABLECOIN.md §11.4).
# NOT RUN YET: v3 is built but not deployed. Requires a second mock token (sm1110-zi3-fake.testnet, same test-usdc
# source) and an account that exists on NEAR but is not registered on tUSDC (sm1110-zi3-unreg.testnet).
# Records fixtures/v3-failures.json.
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
export ZI_RECORD=fixtures/v3-failures.json
zi() { npm run -s zi -- "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }

echo "== v3 L13: an unregistered receiver records the failed share and a later sweep delivers it"
zi invoice new --id "UNREG-$S" --merchant "$UNREG" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC --offline
zi init "UNREG-$S"
zi pay "UNREG-$S" || echo "(expected: the merchant share failed; the tax was paid, status SETTLING)"
zi token register "$UNREG"            # once registered, the retry can deliver
zi sweep "UNREG-$S"

echo "== v3 L11: the wrong token is returned (payment_rejected wrong_token)"
# The fake token is not on the client allow-list, so this step uses a hand-built ft_transfer_call via plain-ft-transfer
# against the fake token; the invoice names tUSDC, so ft_on_transfer rejects it.
zi invoice new --id "WRONGTOK-$S" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "WRONGTOK-$S"
echo "  now send a plain ft_transfer_call on $FAKE to $(acct "WRONGTOK-$S") with msg '{\"action\":\"pay\"}' (near-cli-rs or the mock token UI)"
echo "  expected: the whole amount returned, payment_rejected wrong_token"

echo "== v3 L12: a wrong msg is returned"
echo "  ft_transfer_call on $ZI_TUSDC_ACCOUNT with msg '' and '{\"action\":\"x\"}' to a fresh token invoice"
echo "  expected: the whole amount returned, payment_rejected bad_msg"

echo "== v3 L19: 40 Tgas ft_transfer_call is returned whole"
echo "  build the same ft_transfer_call with 40 Tgas (near-cli-rs --gas 40) and send it"
echo "  expected: payment_rejected low_gas, the amount back"

echo "replay: npm run zi -- replay fixtures/v3-failures.json"
