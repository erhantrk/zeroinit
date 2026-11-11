#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3.1 (2prMzXHZ…DaYX) on 2026-11-10. The client default is v3.2 now: pay/sweep/init refuse a v3.1 invoice unless ZI_CODE_HASH is pinned to the v3.1 hash, and a re-run records v3.2 invoices (use record-v32-*.sh).
# LIVE L3 (docs/STABLECOIN.md §11.4), on v3.1 and on the recorded v3 invoice LATE-V3.
#  1. v3.1: LATE-V31 names late.sm1110-zi3-merchant.testnet (does not exist yet): pay => PAYOUT_PENDING, SETTLING, no invoice_paid (fixtures/v31/late.json)
#  2. the parent sm1110-zi3-merchant creates late.sm1110-zi3-merchant.testnet (scripts/create-late-merchant.ts)
#  3. sweep LATE-V31 => the owed 0.092 NEAR is delivered, invoice_paid with retried: true, PAID (fixtures/v31/late.json)
#  4. sweep the v3 invoice LATE-V3 (history; its owed 0.092 NEAR sits on the v3 invoice account) with ZI_CODE_HASH pinned to the v3 hash (fixtures/v3/late-resweep.json)
# Usage: scripts/record-v31-late.sh [SUFFIX]      default V31; the id must be new each run; late.… must not exist yet
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V31}"
V="${ZI_TAXVAULT_ACCOUNT:?}"
LATE="late.${ZI_MERCHANT_ACCOUNT:?}"
zi() { node src/cli.ts "$@"; }
echo "== L3 step 1: pay with a merchant that does not exist yet (v3.1)"
export ZI_RECORD=fixtures/v31/late.json
zi invoice new --id "LATE-$S" --merchant "$LATE" --tax-vault "$V" --tax-bps 800 --amount 0.1 --expires-in 2h --offline
zi pay "LATE-$S" || echo "(expected: PAYOUT_PENDING, exit 1, status SETTLING, transfer_failed, no invoice_paid)"
zi status "LATE-$S"
echo "== L3 step 2: the parent creates $LATE"
unset ZI_RECORD
node scripts/create-late-merchant.ts
echo "== L3 step 3: sweep LATE-$S delivers the owed merchant share"
export ZI_RECORD=fixtures/v31/late.json
zi sweep "LATE-$S"
zi status "LATE-$S"
echo "== L3 step 4: sweep the recorded v3 invoice LATE-V3 (history, pinned hash)"
export ZI_RECORD=fixtures/v3/late-resweep.json
ZI_CODE_HASH="${ZI_V3_CODE_HASH:?}" zi status LATE-V3
ZI_CODE_HASH="${ZI_V3_CODE_HASH}" zi sweep LATE-V3
ZI_CODE_HASH="${ZI_V3_CODE_HASH}" zi status LATE-V3
# The sweep was recorded without the invoice document (it was created in an earlier recording): add it and mark it as resumed for the replay.
node scripts/mark-resumed.mjs fixtures/v3/late-resweep.json invoices/v3/LATE-V3.json
