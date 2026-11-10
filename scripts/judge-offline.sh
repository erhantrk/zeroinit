#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --include=dev
npm test
npm run -s zi -- vectors
# v2 (current contract): the re-recorded demo, refund cases and the three audit scenarios
npm run -s zi -- replay fixtures/demo-run.json
npm run -s zi -- replay fixtures/refund-cases.json
npm run -s zi -- replay fixtures/audit-scenarios.json
# v1 (frozen history, verify-only): the original recordings still replay
npm run -s zi -- replay fixtures/v1/demo-run.json
npm run -s zi -- replay fixtures/v1/refund-cases.json
for f in invoices/demo/*.json invoices/v1/*.json; do npm run -s zi -- verify "$(basename "$f" .json)" --offline; done
echo "JUDGE-OFFLINE: ALL PASS"
