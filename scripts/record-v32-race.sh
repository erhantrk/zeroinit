#!/usr/bin/env bash
# LIVE v3.2 race on the bad_msg rejection path (audit contract-1): a token sweep while an ft_transfer_call with a wrong msg is in flight (docs/STABLECOIN.md "Live results (v3.2)").
# Whether the two transactions land in the same block decides if the race happens, so this tries fresh invoices (RACE-<suffix>-<n>) with
# different send offsets and keeps the recording of the first attempt that produced it as fixtures/v32/race.json. Every attempt is logged.
# The invoice id must be registered on the token before the payment (`zi token register`), or the ft_transfer_call itself fails (the first three attempts of the
# recorded session forgot this and failed that way; they are in docs/SPIKES.md).
# Usage: scripts/record-v32-race.sh [SUFFIX] [MAX_ATTEMPTS] [FIRST_N]      default V32, 8 and 1; ids must be new each run
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V32}"; MAX="${2:-8}"; FIRST="${3:-1}"
M="${ZI_SWEEPER_ACCOUNT:?}"; V="${ZI_TAXVAULT_ACCOUNT:?}"
OFFSETS=(0 150 -150 300 -300 450 -450 600 -600 0)
OUT="${RACE_SCRATCH:-${TMPDIR:-/tmp}}"
for ((n=FIRST; n<FIRST+MAX; n++)); do
  id="RACE-$S-$n"; off="${OFFSETS[$(( (n-FIRST) % ${#OFFSETS[@]} ))]}"
  f="$OUT/race-$id.json"; rm -f "$f"
  echo "== attempt $n: $id offset ${off} ms"
  ZI_RECORD="$f" node src/cli.ts invoice new --id "$id" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC || exit 1
  ZI_RECORD="$f" node src/cli.ts init "$id" || exit 1
  ZI_RECORD="$f" node src/cli.ts token register "$id" || exit 1
  ZI_RECORD="$f" node scripts/race-v32.ts "$id" "$off"; rc=$?
  if [ "$rc" -eq 0 ]; then R="${RACE_OUT:-fixtures/v32/race.json}"; cp "$f" "$R"; echo "RECORDED $R from $id"; exit 0; fi
  echo "attempt $n ended with exit $rc"
done
echo "no attempt produced the race"; exit 3
