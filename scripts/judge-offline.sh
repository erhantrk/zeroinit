#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm test
npm run -s zi -- vectors
npm run -s zi -- replay fixtures/demo-run.json
npm run -s zi -- replay fixtures/refund-cases.json
for f in invoices/demo/*.json; do npm run -s zi -- verify "$(basename "$f" .json)" --offline; done
echo "JUDGE-OFFLINE: ALL PASS"
