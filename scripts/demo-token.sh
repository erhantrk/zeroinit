#!/usr/bin/env bash
# The tUSDC demo (v3.2): an invoice in tUSDC paid by a PLAIN ft_transfer (what an exchange does), then swept by anyone.
# Usage: scripts/demo-token.sh <suffix>     e.g. scripts/demo-token.sh 1111-V3   (invoice id TOK-<suffix>-A must be new each run)
# The recorded run: ZI_RECORD=fixtures/v32/token-demo-run.json scripts/demo-token.sh 1111-V32 </dev/null (the v3.1 run is fixtures/v31/token-demo-run.json, suffix 1111-V31; the v3 run is fixtures/v3/token-demo-run.json, suffix 1111-V3)
# tUSDC is a testnet mock token (see docs/STABLECOIN.md and docs/LIMITS.md); the payer needs tUSDC and the merchant and tax vault must be registered on it.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
S="${1:?give a unique suffix}"
M="${ZI_MERCHANT_ACCOUNT:-$ZI_SWEEPER_ACCOUNT}"   # the merchant account (the v3.2r and older runs used the sweeper account)
V="${ZI_TAXVAULT_ACCOUNT:?set ZI_TAXVAULT_ACCOUNT in .env}"
pause() { read -r -p "── $1 (enter) " _ || true; }
pause "Shot 2: the merchant issues a tUSDC invoice (no transaction)"
node src/cli.ts invoice new --id "TOK-$S-A" --merchant "$M" --tax-vault "$V" --tax-bps 800 --amount 1 --expires-in 2h --token tUSDC
node src/cli.ts status "TOK-$S-A"
pause "Shot 3: an exchange-style plain ft_transfer (registers the invoice id on the token, then a bare ft_transfer)"
node src/cli.ts pay "TOK-$S-A" --plain
node src/cli.ts status "TOK-$S-A"
pause "Shot 4: anyone sweeps: state init + fund + sweep in one transaction, 0.92 / 0.08 tUSDC"
node src/cli.ts sweep "TOK-$S-A"
node src/cli.ts verify "TOK-$S-A"
