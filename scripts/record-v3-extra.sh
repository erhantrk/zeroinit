#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3 (Ut7EQhLD…reWa) on 2026-11-10. The client default is v3.2 now, so re-running it records v3.2 invoices; use the record-v32-*.sh scripts (and demo.sh / demo-token.sh) for v3.2.
# LIVE v3 extras (docs/STABLECOIN.md §11.4), run after the main recorders:
#   S-F2   ft_transfer_call to an invoice id that was never initialized (registered on the token, no account on NEAR): the token gets the call
#          to a nonexistent receiver, which fails, and the token refunds everything. Appended to fixtures/v3/failures.json.
#   L9b    a plain underpay of 0.5 tUSDC, the invoice expires, sweep releases what is parked pro rata (taxed). Appended to fixtures/v3/tokens.json.
#   L15b   two sweeps of one parked token invoice sent at the same time (sweeper key and payer key). NOT recorded as a fixture (two
#          processes cannot share one recording file); the output is kept in the log of the run.
# Usage: scripts/record-v3-extra.sh [SUFFIX]      default suffix V3
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V3}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
zi() { node src/cli.ts "$@"; }
acct() { node -e "console.log(JSON.parse(require('fs').readFileSync('invoices/$1.json','utf8')).account_id)"; }
newtok() { local id="$1" amount="$2" exp="$3"; zi invoice new --id "$id" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount "$amount" --expires-in "$exp" --token tUSDC; }

if [ -z "${SKIP_SF2:-}" ]; then
echo "== v3 S-F2: ft_transfer_call to an uninitialized invoice id is returned whole"
export ZI_RECORD=fixtures/v3/failures.json
newtok "NOINIT-$S" 1 2h
node scripts/live-call.ts ft-call "$ZI_TUSDC_ACCOUNT" "NOINIT-$S" 1 pay 200 uninitialized-call || echo "(expected: the receipt on the nonexistent account fails, the token refunds the amount)"
fi

echo "== v3 L9b: expired, underpaid by a plain transfer: sweep releases the parked 0.5 tUSDC pro rata"
export ZI_RECORD=fixtures/v3/tokens.json
newtok "TOK-$S-I" 1 1m
node scripts/plain-ft-transfer.ts "$(acct "TOK-$S-I")" 0.5 tUSDC
sleep 75
zi sweep "TOK-$S-I" || echo "(see the output: the chain decides)"

echo "== v3 L15b: two sweeps at the same time (not recorded)"
unset ZI_RECORD
newtok "CONC-$S" 1 2h
node scripts/plain-ft-transfer.ts "$(acct "CONC-$S")" 1 tUSDC
( zi sweep "CONC-$S" > "${TMPDIR:-/tmp}/conc-a.log" 2>&1; echo "sweeper-key sweep exit $?" >> "${TMPDIR:-/tmp}/conc-a.log" ) &
( ZI_SWEEPER_ACCOUNT="$ZI_PAYER_ACCOUNT" ZI_SWEEPER_KEY="$ZI_PAYER_KEY" zi sweep "CONC-$S" > "${TMPDIR:-/tmp}/conc-b.log" 2>&1; echo "payer-key sweep exit $?" >> "${TMPDIR:-/tmp}/conc-b.log" ) &
wait
echo "--- sweep with the sweeper key"; grep -E "^(TX|RESULT|EVENT|ERROR|WARNING|SWEEP|STATE|sweeper)" "${TMPDIR:-/tmp}/conc-a.log" | cut -c1-300
echo "--- sweep with the payer key"; grep -E "^(TX|RESULT|EVENT|ERROR|WARNING|SWEEP|STATE|payer)" "${TMPDIR:-/tmp}/conc-b.log" | cut -c1-300
