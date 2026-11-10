#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --include=dev
npm test
npm run -s zi -- vectors
# v3 (current contract, NEAR + tUSDC): the live recordings of 2026-11-10
for f in demo-run token-demo-run near fixes tokens failures; do npm run -s zi -- replay "fixtures/v3/$f.json"; done
# v2 (history): the re-recorded demo, refund cases and the three audit scenarios (incl. the AUD2-V2 re-sweep)
npm run -s zi -- replay fixtures/v2/demo-run.json
npm run -s zi -- replay fixtures/v2/refund-cases.json
npm run -s zi -- replay fixtures/v2/audit-scenarios.json
# v1 (frozen history, verify-only): the original recordings still replay
npm run -s zi -- replay fixtures/v1/demo-run.json
npm run -s zi -- replay fixtures/v1/refund-cases.json
for f in invoices/v3/*.json invoices/v2/*.json invoices/v1/*.json; do npm run -s zi -- verify "$(basename "$f" .json)" --offline; done
echo "JUDGE-OFFLINE: ALL PASS"
