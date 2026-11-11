#!/usr/bin/env bash
# HISTORY: this recorder ran against contract v3.1 (2prMzXHZ…DaYX) on 2026-11-10. The client default is v3.2 now: pay/sweep/init refuse a v3.1 invoice unless ZI_CODE_HASH is pinned to the v3.1 hash, and a re-run records v3.2 invoices (use record-v32-*.sh).
# LIVE v3.1 token one-step run (docs/STABLECOIN.md §11.4 L7 on the v3.1 deployment 2prMzXHZ…DaYX).
# The tUSDC plain ft_transfer + sweep and the NEAR pay demos are scripts/demo-token.sh and scripts/demo.sh (suffix 1111-V31, see docs/SPIKES.md "Contract v3.1 live").
# Records fixtures/v31/tokens.json: init (state init + fund), then ft_transfer_call ({"action":"pay"}), then a second call that must be returned (not_open).
# Usage: scripts/record-v31-tokens.sh [SUFFIX]      default V31; invoice ids must be new each run
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V31}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
export ZI_RECORD=fixtures/v31/tokens.json
zi() { node src/cli.ts "$@"; }
echo "== v3.1 L7: one-step path (init, then ft_transfer_call)"
zi invoice new --id "TOK-$S-B" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "TOK-$S-B"
zi pay "TOK-$S-B"
zi verify "TOK-$S-B"
echo "== v3.1 L15: a second ft_transfer_call on a PAID invoice is returned (payment_rejected not_open)"
zi pay "TOK-$S-B" || echo "(expected: payment_rejected not_open, exit 1)"
