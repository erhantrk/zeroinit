#!/usr/bin/env bash
# LIVE v3.2 token one-step run (docs/STABLECOIN.md §11.4 L7 on the v3.2 deployment 6YtW5oJ8…ZvMCNHJ).
# The tUSDC plain ft_transfer + sweep and the NEAR pay demos are scripts/demo-token.sh and scripts/demo.sh (suffix 1111-V32, see docs/SPIKES.md "Contract v3.2 live").
# Records fixtures/v32/tokens.json: init (state init + fund), then ft_transfer_call ({"action":"pay"}), then a second call that must be returned (not_open).
# Usage: scripts/record-v32-tokens.sh [SUFFIX]      default V32; invoice ids must be new each run
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:-V32}"
M="${ZI_SWEEPER_ACCOUNT:?set ZI_SWEEPER_ACCOUNT}"
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT}"
export ZI_RECORD=fixtures/v32/tokens.json
zi() { node src/cli.ts "$@"; }
echo "== v3.2 L7: one-step path (init, then ft_transfer_call)"
zi invoice new --id "TOK-$S-B" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
zi init "TOK-$S-B"
zi pay "TOK-$S-B"
zi verify "TOK-$S-B"
echo "== v3.2 L15: a second ft_transfer_call on a PAID invoice is returned (payment_rejected not_open)"
zi pay "TOK-$S-B" || echo "(expected: payment_rejected not_open, exit 1)"
