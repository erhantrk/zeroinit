#!/usr/bin/env bash
# Records fixtures/v2/audit-scenarios.json live on testnet: the three audit findings (contract-1/2/3) re-run against contract v2.
# Usage: scripts/record-audit-scenarios.sh [SUFFIX]      default suffix V2; invoice ids must be new each run
#   AUD1-<S>  contract-1: plain transfer before expiry, a zero-deposit pay after expiry, then sweep  -> the tax vault still gets its share
#   AUD3-<S>  contract-3: plain transfer, then pay with a full deposit                              -> the deposit is refunded, no double charge
#   AUD2-<S>  contract-2: the tax vault is a valid but NONEXISTENT subaccount of our own tax-vault account (nobody else can ever register
#             it), so its transfer fails: transfer_failed is recorded, the tax stays owed, a later sweep re-sends it to the vault only.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V2}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
export ZI_RECORD=fixtures/v2/audit-scenarios.json
zi() { npm run -s zi -- "$@"; }
new() { local id="$1" exp="$2" vault="${3:-$V}"; shift 3 || shift $#; zi invoice new --id "$id" --merchant "$M" --tax-vault "$vault" --tax-bps 800 --amount 0.1 --expires-in "$exp" "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }

echo "== contract-1: tax skipped after EXPIRED (fixed in v2)"
new "AUD1-$S" 1m "$V"
node scripts/plain-transfer.ts "$(acct "AUD1-$S")" 0.1     # an exchange pays before expiry; nobody sweeps
sleep 75                                                   # the invoice expires with the money parked
zi pay "AUD1-$S" --amount 0 || echo "(expected: REFUNDED_EXPIRED, exit 1: a zero-deposit pay after expiry)"
zi sweep "AUD1-$S"                                         # v1: all 0.1 to the merchant, tax vault gets 0. v2: 0.092 / 0.008, late

echo "== contract-3: pay() ignored parked funds (fixed in v2)"
new "AUD3-$S" 2h "$V"
node scripts/plain-transfer.ts "$(acct "AUD3-$S")" 0.1     # the payer first sends a plain transfer ...
zi pay "AUD3-$S"                                           # ... then runs pay: v1 charged twice. v2: deposit refunded, parked funds settled 92/8

echo "== contract-2: failed transfer after PAID (recorded in v2)"
new "AUD2-$S" 2h "unregistered.$V" --offline               # --offline: the issuance check refuses a vault that does not exist
zi pay "AUD2-$S" || echo "(expected: PAID but the tax transfer failed downstream: exit 1 with a warning)"
zi sweep "AUD2-$S" || echo "(expected: TAX_RESENT to the vault only; it fails again because the account still does not exist)"
zi status "AUD2-$S"
