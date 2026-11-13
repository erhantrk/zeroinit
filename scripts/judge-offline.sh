#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --include=dev
npm test
npm run -s zi -- vectors
# v3.3 (current contract: parked funds count toward the price; reproducible build of commit 7727a1c): the live recordings of 2026-11-13 (NEAR demo, tUSDC demo,
# payments on top of parked funds, the one-step ft_transfer_call with registration in the same transaction, the bad_msg race, two payments at the same moment)
for f in demo-run token-demo-run parked tokens race two-payments; do npm run -s zi -- replay "fixtures/v33/$f.json"; done
# v3.2r (history since v3.3: the v3.2 source built reproducibly, commit 4116e69): the live recordings of 2026-11-12 (NEAR demo, tUSDC demo, one-step ft_transfer_call, the bad_msg race)
for f in demo-run token-demo-run tokens race; do npm run -s zi -- replay "fixtures/v32r/$f.json"; done
# v3.2 (history since v3.2r, the same source, a non-reproducible build; the audit fixes): the live recordings of 2026-11-11 (NEAR demo, tUSDC demo, one-step ft_transfer_call, the bad_msg race)
for f in demo-run token-demo-run tokens race; do npm run -s zi -- replay "fixtures/v32/$f.json"; done
# v3.1 (history since v3.2; the sweep-race fix for the busy rejection only): the live recordings of 2026-11-10 (NEAR demo, tUSDC demo, one-step ft_transfer_call, the F1 race, the L3 late merchant)
for f in demo-run token-demo-run tokens race late; do npm run -s zi -- replay "fixtures/v31/$f.json"; done
# v3 (history since v3.1: NEAR + tUSDC, has the token-sweep race): the live recordings of 2026-11-10, incl. the later re-sweep of LATE-V3
for f in demo-run token-demo-run near fixes tokens failures late-resweep; do npm run -s zi -- replay "fixtures/v3/$f.json"; done
# v2 (history): the re-recorded demo, refund cases and the three audit scenarios (incl. the AUD2-V2 re-sweep)
npm run -s zi -- replay fixtures/v2/demo-run.json
npm run -s zi -- replay fixtures/v2/refund-cases.json
npm run -s zi -- replay fixtures/v2/audit-scenarios.json
# v1 (frozen history, verify-only): the original recordings still replay
npm run -s zi -- replay fixtures/v1/demo-run.json
npm run -s zi -- replay fixtures/v1/refund-cases.json
for f in invoices/v33/*.json invoices/v32r/*.json invoices/v32/*.json invoices/v31/*.json invoices/v3/*.json invoices/v2/*.json invoices/v1/*.json; do npm run -s zi -- verify "$(basename "$f" .json)" --offline; done
echo "JUDGE-OFFLINE: ALL PASS"
