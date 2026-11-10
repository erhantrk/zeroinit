# ZeroInit — Day-0 Spikes

Live testnet results and build numbers. Every tx hash recorded here is real unless marked synthetic.

## T03 build

- wasm: `contract/res/zeroinit_invoice.wasm`
- size: 78,519 bytes (`wc -c`)
- `shasum -a 256` hex: `912ae75e72dd90173a8e0c6c3225927b7a68ae66788df704c8bf8979c543c3c9`
- code hash (base58 of sha256): `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`
- cargo-near version: `cargo-near-near 0.23.0`
- contract tests: `test result: ok. 7 passed; 0 failed`
- **The contract is now frozen.** Do not rebuild after T05 unless the owner approves; a rebuild = new hash = another ~8 NEAR burn.

## S-B deploy

Done by the operator (Claude, on Erhan's approval) on 2026-11-10 01:19 Istanbul.

- Command: `near contract deploy-as-global use-file contract/res/zeroinit_invoice.wasm as-global-hash sm1110-zi-deployer.testnet network-config testnet sign-with-legacy-keychain send`
- Global code hash: `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` (= `ZI_CODE_HASH` from T03)
- Tx: `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h` (https://testnet.nearblocks.io/txns/DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h)
- Deployer balance: 10 NEAR before, 2.1474 NEAR after. Burn (tx fee) = 7.8526 NEAR for a 78,519-byte wasm (≈ 0.0001 NEAR/byte, as expected).

## S-A/S-B/S-C

Run 2026-11-10 ~01:22 Istanbul (testnet, protocol 88), accounts `sm1110-zi-*`, global code hash
`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` (T03/T05).

Commands:
```bash
set -a; source .env; set +a
npm run zi -- invoice new --id SMOKE-1 --merchant sm1110-zi-merchant.testnet --tax-vault sm1110-zi-taxvault.testnet \
  --tax-bps 800 --amount 0.1 --expires-in 2h
npm run zi -- status SMOKE-1
npm run zi -- pay SMOKE-1
npm run zi -- verify SMOKE-1
```

Result: **PASS**. One tx created the invoice account from the global code by hash, ran `pay()` and split the money 92/8.

- **S-A derivation:** the chain accepted our locally derived `0u` id
  `0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g` (no `InvalidUniversalStateInitReceiver`).
- **S-B global deploy + account:** the created account's on-chain `global_contract_hash` is
  `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` (the T05 global deploy) and it has no access keys.
- **S-C batch in one tx:** `[UniversalStateInit, FunctionCall pay]` in a single transaction succeeded.
- PAY tx: `3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV`
  (https://testnet.nearblocks.io/txns/3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV)
- storage_usage after `pay()` = 352 B (≤ 770), so `deposit: 0` on the state-init action was correct; no
  `LackBalanceForState` change was needed.

Invoice doc: `invoices/SMOKE-1.json` (merchant `sm1110-zi-merchant.testnet`, tax vault `sm1110-zi-taxvault.testnet`,
tax_bps 800, amount 0.1 NEAR, expires 2026-11-10T00:22:48.844Z, salt random).

Full output (the `…` parts of the task's expected block resolved to the values below):

```
INVOICE SMOKE-1
ACCOUNT 0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g
PAY 0.1 NEAR before 2026-11-10T00:22:48.844Z
FILE invoices/SMOKE-1.json
STATE NONEXISTENT
TX 3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV
RESULT PAID
EVENT invoice_paid {"invoice_id":"SMOKE-1","account_id":"0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g","via":"pay","payer":"sm1110-zi-payer.testnet","amount":"100000000000000000000000","merchant_amount":"92000000000000000000000","tax_amount":"8000000000000000000000","excess_refunded":"0","late":false}
TRANSFER sm1110-zi-merchant.testnet 0.092
TRANSFER sm1110-zi-taxvault.testnet 0.008
LINK https://testnet.nearblocks.io/txns/3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV
STATE INITIALIZED status=PAID paid_by=sm1110-zi-payer.testnet balance=0 storage=352
PASS id-from-terms 0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g
PASS raw-from-terms
PASS code-hash-onchain Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
PASS terms-onchain
PASS no-access-keys
INFO status=PAID
```

## S-D

Run 2026-11-10 ~01:30 Istanbul (testnet, protocol 88). Question: does a plain transfer (no state init, like a wallet or
exchange sends) to a nonexistent `0u…` address create an UNINITIALIZED account, and can `zi sweep` split it?

Result: **PASS — path B works.** The chain accepted the plain transfer, parked the funds in an uninitialized account,
and one `[UniversalStateInit, sweep]` tx materialized the account and split 92/8.

Invoice: `SMOKE-2`, account `0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g`
(merchant `sm1110-zi-merchant.testnet`, tax vault `sm1110-zi-taxvault.testnet`, tax_bps 800, amount 0.1 NEAR,
expires 2026-11-10T00:30:32.481Z, doc `invoices/SMOKE-2.json`).

```bash
npm run zi -- invoice new --id SMOKE-2 --merchant sm1110-zi-merchant.testnet --tax-vault sm1110-zi-taxvault.testnet \
  --tax-bps 800 --amount 0.1 --expires-in 2h
# INVOICE SMOKE-2
# ACCOUNT 0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g
# PAY 0.1 NEAR before 2026-11-10T00:30:32.481Z
# FILE invoices/SMOKE-2.json
npm run zi -- status SMOKE-2
# STATE NONEXISTENT
```

### Transfer: near-cli-rs refuses without a TTY, RPC-level fallback used

`near tokens sm1110-zi-payer.testnet send-near 0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g '0.1 NEAR'
network-config testnet sign-with-legacy-keychain send` exits 1: near-cli-rs warns
`<0u5wsc…> does not exist on <testnet>` and then fails with `0: The input device is not a TTY` (it wants an interactive
"proceed anyway?" confirmation). That is the case T07 anticipates, so the transfer went through the RPC-level fallback
`scripts/plain-transfer.ts`, which is just
`sendActions(cfg, cfg.payer, <ACCOUNT>, [actTransfer(parseNear('0.1'))], 'transfer')`:

```bash
node scripts/plain-transfer.ts 0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g 0.1
# TX AyX3nvAWC5Rw8XJPSHdaVEr4MMfqXdQKRU9eCXN1myiv
# RESULT SUCCESS
```

- **Plain-transfer tx:** `AyX3nvAWC5Rw8XJPSHdaVEr4MMfqXdQKRU9eCXN1myiv`
  (https://testnet.nearblocks.io/txns/AyX3nvAWC5Rw8XJPSHdaVEr4MMfqXdQKRU9eCXN1myiv)
- After the transfer: `npm run zi -- status SMOKE-2` → `STATE UNINITIALIZED balance=0.1`

Raw `view_account` (exact curl response):

```json
{"jsonrpc":"2.0","result":{"amount":"100000000000000000000000","block_hash":"6wTJzo5rntuYj6SXiqqVS1nFtARf8cSZVEPCRG931Dcv","block_height":276981979,"bootstrap_nonce":276981936000000,"code_hash":"11111111111111111111111111111111","locked":"0","state":"uninitialized","storage_paid_at":0,"storage_usage":100},"id":"zi"}
```

### Sweep

```bash
npm run zi -- sweep SMOKE-2
```
```
TX 7gDy75A4gvZRw4rQxHVZskDJzcuF8ChMdiSUF9C3YpsX
RESULT PAID
EVENT invoice_paid {"invoice_id":"SMOKE-2","account_id":"0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g","via":"transfer","payer":null,"amount":"100000000000000000000000","merchant_amount":"92000000000000000000000","tax_amount":"8000000000000000000000","excess_refunded":"0","late":false}
TRANSFER sm1110-zi-merchant.testnet 0.092
TRANSFER sm1110-zi-taxvault.testnet 0.008
LINK https://testnet.nearblocks.io/txns/7gDy75A4gvZRw4rQxHVZskDJzcuF8ChMdiSUF9C3YpsX
STATE INITIALIZED status=PAID paid_by=null balance=0 storage=325
```

- **Sweep tx:** `7gDy75A4gvZRw4rQxHVZskDJzcuF8ChMdiSUF9C3YpsX`
  (https://testnet.nearblocks.io/txns/7gDy75A4gvZRw4rQxHVZskDJzcuF8ChMdiSUF9C3YpsX)

near-cli-rs's "does not exist" warning is cosmetic (its account-id parser does not know `0u` ids); the chain itself
accepts the plain Transfer, so PLAN §3 MUST item 4 (plain-transfer path) stays a MUST.

### Second 0.1 NEAR after the sweep: traced, then `EXTRA_SWEPT`

A later `npm run zi -- status SMOKE-2` showed `balance=0.1` again. Traced with an RPC block/chunk scan: the state change
is first visible at block **276982291**, and the transaction itself is in block **276982290**.

- **Extra transfer tx:** `8FZhDmcsC4GPuVEEj3rt16moH1roRLfo8FrKvhNrmtwC`
  (https://testnet.nearblocks.io/txns/8FZhDmcsC4GPuVEEj3rt16moH1roRLfo8FrKvhNrmtwC), block 276982290,
  2026-11-09T22:35:15 UTC (01:35:15 Istanbul), signer `sm1110-zi-payer.testnet`, exactly one `Transfer` action of
  `100000000000000000000000` yocto, `status: {"SuccessValue": ""}`.
- **Who sent it:** the Conductor acceptance checker re-ran the T07 report's
  `node scripts/plain-transfer.ts 0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g 0.1` at ~01:34:10 Istanbul.
  It is not a builder run, and the checker no longer re-runs live commands. The account stayed initialized
  (`global_contract_hash` unchanged) with `status=PAID`, `paid_by=null`, `paid_amount=0.1`, `storage=325`.

That gave an unplanned but useful data point: `sweep()` on an **already-PAID** invoice (INTERFACES §5.2 last row).

```bash
npm run zi -- sweep SMOKE-2
```
```
TX GToSvGaCs9eAKrVydxjgsi3RuvDotqPGF5zh3eTUYafm
RESULT EXTRA_SWEPT
EVENT extra_swept {"invoice_id":"SMOKE-2","account_id":"0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g","amount":"100000000000000000000000","to":"sm1110-zi-merchant.testnet"}
TRANSFER sm1110-zi-merchant.testnet 0.1
LINK https://testnet.nearblocks.io/txns/GToSvGaCs9eAKrVydxjgsi3RuvDotqPGF5zh3eTUYafm
STATE INITIALIZED status=PAID paid_by=null balance=0 storage=325
```

- **Extra sweep tx:** `GToSvGaCs9eAKrVydxjgsi3RuvDotqPGF5zh3eTUYafm`
  (https://testnet.nearblocks.io/txns/GToSvGaCs9eAKrVydxjgsi3RuvDotqPGF5zh3eTUYafm). Signer
  `sm1110-zi-merchant.testnet`, return value `"EXTRA_SWEPT"`, one `extra_swept` event, and **100 %** of the extra
  0.1 NEAR forwarded to the merchant (no tax split on extra funds, per INTERFACES §5.2). `paid_at_ms`/`paid_amount`
  were not rewritten. `tokens_burnt` 82,740,528,600,500,000,000 yocto (0.0000827 NEAR), paid by the sweeper.
- **Final state:** `{"amount":"0", "global_contract_hash":"Amg4WXKy…GW6k", "storage_usage":325}` at block 276984385 —
  the account is empty again, so no PAID invoice is left holding funds.

## S-E — storage bytes, payer cost, deploy burn

Run 2026-11-10 ~01:40 Istanbul (testnet, protocol 88).

### Storage after materialization

```bash
npm run zi -- status SMOKE-1 --json
```
```json
{"kind":"INITIALIZED","amount":"0","storageUsage":352,"globalContractHash":"Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k","globalContractAccountId":null,"invoice":{"v":1,"account_id":"0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g","invoice_id":"SMOKE-1","merchant":"sm1110-zi-merchant.testnet","tax_vault":"sm1110-zi-taxvault.testnet","tax_bps":800,"amount":"100000000000000000000000","expires_at_ms":"1794270168844","salt":"9037609756393658036","status":"PAID","paid_by":"sm1110-zi-payer.testnet","paid_at_ms":"1794263023290","paid_amount":"100000000000000000000000","tax_amount":"8000000000000000000000"}}
```

`storageUsage` = **352 B**. The task expected ≈ 330; 352 is far below the 770 B zero-balance limit
(INTERFACES §0), so `deposit: 0` on `UniversalStateInit` stays correct and the pre-approved 0.01 NEAR
deposit (T06 error table) is **not** needed. Raw `view_account` for the same account:

```json
{"jsonrpc":"2.0","result":{"amount":"0","block_hash":"73Wp5GDe64PnHdfuNF6qMQh4EEzmxqTdeUDbGvPw3xAf","block_height":276982849,"code_hash":"11111111111111111111111111111111","global_contract_hash":"Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k","locked":"0","storage_paid_at":0,"storage_usage":352},"id":"zi"}
```

The plain-transfer path ends at **325 B** after `sweep` (S-D above), also well under 770.

### Payer cost of one materialization (SMOKE-3)

New invoice `SMOKE-3`, amount 0.1 NEAR, account `0ub2381yvc3ajvdhzx6hwxsxrakmjygnjxswx6srqmjr0m0qt0q2jg`
(doc `invoices/SMOKE-3.json`, gitignored).

| Point | Payer `sm1110-zi-payer.testnet` balance | Block |
|---|---|---|
| before `zi pay SMOKE-3` | `9.6847289421768805 NEAR` | #276982642 |
| after `zi pay SMOKE-3` | `9.577367157378761 NEAR` | #276982767 |

Cost = 9.6847289421768805 − 9.577367157378761 − 0.1 = **0.0073617847981195 NEAR**
(7,361,784,798,119,500,000,000 yocto), i.e. 7.36% of the 0.1 NEAR invoice and well inside the expected 0.007–0.01 NEAR.

That equals the transaction's total `tokens_burnt` exactly, so the balance delta is all gas + the protocol's
0.007 NEAR account-creation charge:

- Pay tx: `AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M`
  (https://testnet.nearblocks.io/txns/AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M)
- Actions: `UniversalStateInit{deposit:"0", state_init:"AAEAkSrn…"}` + `FunctionCall{pay, deposit:"100000000000000000000000", gas:50000000000000}`
- `status: {"SuccessValue":"IlBBSUQi"}` = `PAID`; the invoice's `paid_at_ms` advanced to the block timestamp.
- Tokens burnt: tx outcome 82,730,991,857,500,000,000 yocto (0.0000827309918575 NEAR); the `pay` receipt
  7,234,417,293,762,000,000,000 yocto (0.007234417293762 NEAR, of which 0.007 is the creation charge); four
  refund/gas receipts at 22,318,256,250,000,000,000 yocto each. Total **0.0073617847981195 NEAR**.
- Transfers in the outcome: `0.092` → merchant, `0.008` → tax vault, gas refunds → payer.

So: **one materialization costs the payer ≈ 0.00736 NEAR** on top of the invoice amount, matching PLAN §7.

### Deploy burn (measured in T05, restated here)

The one-time global deploy burned **7.8526 NEAR** for the 78,519-byte wasm (deployer 10 NEAR → 2.1474 NEAR),
tx `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`. The contract is frozen; this is not a per-invoice cost.

## Spike summary and GO/NO-GO

| Spike | Result | Evidence (tx hash / output) |
|---|---|---|
| S-A derivation | PASS | PAY tx `3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV` created `0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g`; no `InvalidUniversalStateInitReceiver`; `PASS id-from-terms` |
| S-B global deploy + account | PASS | deploy tx `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`, burn 7.8526 NEAR; created account's `global_contract_hash` = same hash; `PASS code-hash-onchain`, `PASS no-access-keys` |
| S-C one-tx create+pay+split | PASS | tx `3Wou3fRW3TZcPF5927ohzfT7ut9GfqGFs6nXjw2y6PmV`: one tx with `[UniversalStateInit, FunctionCall pay]` → `RESULT PAID`, `TRANSFER sm1110-zi-merchant.testnet 0.092`, `TRANSFER sm1110-zi-taxvault.testnet 0.008` |
| S-D plain transfer → uninitialized → sweep | PASS | transfer tx `AyX3nvAWC5Rw8XJPSHdaVEr4MMfqXdQKRU9eCXN1myiv` → `"state":"uninitialized"`, balance 0.1, `storage_usage:100`; sweep tx `7gDy75A4gvZRw4rQxHVZskDJzcuF8ChMdiSUF9C3YpsX` → `RESULT PAID`, 0.092/0.008 split |
| S-E storage bytes / payer cost / deploy burn | 352 B / 0.0073617847981195 NEAR / 7.8526 NEAR | `status SMOKE-1 --json` → `storageUsage:352` (≤ 770, no 0.01 NEAR deposit needed); payer 9.6847289421768805 → 9.577367157378761 minus 0.1 = 0.0073617847981195, equal to SMOKE-3 pay tx `AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M` total `tokens_burnt`; deploy burn from S-B |

**Decision: GO (0u, one-tx).** All five Day-0 spikes pass on testnet protocol 88. `0u` derivation matches the
chain, the global contract is deployed and reused by hash, `[UniversalStateInit, FunctionCall pay]` creates, pays
and splits in one transaction, a plain wallet transfer parks funds in an uninitialized account that `sweep`
materializes, and the measured numbers are inside the plan's limits (storage 352 ≤ 770, payer 0.00736 NEAR per
materialization). No fallback (`0s`, two-step, 0.01 NEAR deposit) is needed. Proceed to Day 1 (T10+).

## T10 refund cases

Recorded live on testnet with `ZI_RECORD=fixtures/refund-cases.json` on 2026-11-10 ~01:02–01:07 UTC (protocol 88,
accounts `sm1110-zi-*`, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`). All five invoices use merchant
`sm1110-zi-merchant.testnet`, tax vault `sm1110-zi-taxvault.testnet`, `tax_bps 800`, amount 0.1 NEAR. Docs were copied
to `invoices/demo/`; `npm run zi -- replay fixtures/refund-cases.json` prints only PASS lines.

| Case | What happened | Tx | Result |
|---|---|---|---|
| REF-UNDER | paid 0.05 against 0.1 | `6xJeA9v3jWpaKBS374YkE61X43fw3v7XmeBCyKQsdYkc` | `REFUNDED_UNDERPAID`, 0.05 refunded to payer, status stays `OPEN` (storage 327) |
| REF-EXPIRED | paid after the 1m expiry | `GzCoQKHS31QwBQUjRoop5S3cJdncXhRsi8aHp5xRjmce` | `REFUNDED_EXPIRED`, 0.1 refunded, status `EXPIRED` (storage 329) |
| REF-TWICE (1st) | paid 0.1 exactly | `GyHHFM3s8GGrNgR2qVnHRxDKJV8JiUWm3VaPpA6cNqmH` | `PAID`, split 0.092 / 0.008 |
| REF-TWICE (2nd) | paid again after `PAID` | `6xSPUeJPudhtV1CgTNsy4C5fAdUP4ovMG9XZwHtLkGo3` | `REFUNDED_NOT_OPEN`, 0.1 refunded |
| REF-OVER | paid 0.15 against 0.1 | `FGUt27MFkqGkNxVnpW5EiPJkQcWwcf8fLP7SdMmn9a8M` | `PAID`, split 0.092 / 0.008, excess 0.05 refunded to payer |
| REF-SWEEPLOW (transfer) | plain transfer of 0.05 to the `0u…` id | `BCWEnPwuNDo41LVyGcygQFvzExY8r76Uzq79BKjKjBj1` | account `UNINITIALIZED`, balance 0.05 |
| REF-SWEEPLOW (sweep) | sweep with only 0.05 parked vs 0.1 amount | `6DGQAdk46AnRxJuN8ZHgjxBw7vkJeMxesGgDj2KNd7sW` | **expected failure**: receipt reverts with `UNDERPAID: available 50000000000000000000000 < amount 100000000000000000000000`; account stays `UNINITIALIZED` with 0.05, nothing lost |

`near tokens … send-near 0u4173bq… '0.05 NEAR'` hit the same non-TTY confirmation wall as S-D (`The input device is not
a TTY`), so the plain transfer used the RPC-level `scripts/plain-transfer.ts` fallback documented in S-D.

Replay (`npm run zi -- replay fixtures/refund-cases.json`) includes:
`PASS refund-event REF-UNDER REFUNDED_UNDERPAID`, `PASS refund-event REF-EXPIRED REFUNDED_EXPIRED`,
`PASS refund-event REF-TWICE REFUNDED_NOT_OPEN`, `PASS split-merchant REF-OVER 0.092`,
`PASS transfer-path-uninitialized REF-SWEEPLOW 0.05`, `PASS sweep-underpaid-reverted REF-SWEEPLOW 6DGQAdk46AnRxJuN8ZHgjxBw7vkJeMxesGgDj2KNd7sW`.

## T11 verify + receipt on the smoke invoices

Run 2026-11-10 ~02:10 Istanbul (testnet, protocol 88), commands exactly as T11. Every line is `PASS` or `INFO`.

```bash
for id in SMOKE-1 SMOKE-2 REF-OVER; do npm run zi -- verify $id; done
npm run zi -- receipt SMOKE-1
node -e "const r=require('./invoices/SMOKE-1.receipt.json');console.log(r.checks)"
```

| Invoice | Account | verify result |
|---|---|---|
| SMOKE-1 | `0uy1ebvnvd4cd0nen8fq0de0sen9habjraqcsn80zz4cmfykr2945g` | `PASS id-from-terms`, `PASS raw-from-terms`, `PASS code-hash-onchain Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`, `PASS terms-onchain`, `PASS no-access-keys`, `INFO status=PAID` |
| SMOKE-2 | `0u5wsc27xcsnx61qnynjpmw29bnq751v91kywgphr44b7q94p09c3g` | same five `PASS` lines, `INFO status=PAID` |
| REF-OVER | `0u4zj4m9bypmktwvv3k6qdf3jdxae5ygetvd9m3zr616v0zj1352qg` | same five `PASS` lines, `INFO status=PAID` |

`npm run zi -- receipt SMOKE-1` wrote `invoices/SMOKE-1.receipt.json` and printed the receipt table
(`Status PAID`, `0.1 NEAR` paid by `sm1110-zi-payer.testnet`, merchant `0.092`, tax `0.008`). The checks object is exactly
the expected one:

```
{ id_matches_terms: true, code_hash_matches: true, terms_match_onchain: true, status: 'PAID' }
```

The receipt nests the invoice doc and the live `get_invoice`/`view_account` results (`storage_usage` 352,
`global_contract_hash` `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`). It lives under `invoices/*.receipt.json`, which
the frozen `.gitignore` excludes, so the command regenerates it on demand rather than committing it.

## T14 demo run (`fixtures/demo-run.json`)

Recorded 2026-11-10 01:29–01:31 UTC (testnet, protocol 88) with
`ZI_RECORD=fixtures/demo-run.json scripts/demo.sh 1111`. The plain transfer used `scripts/plain-transfer.ts`
(the non-TTY fallback documented in S-D). Invoice docs copied to `invoices/demo/INV-1111-*.json`.

| Invoice | Account | Step | Tx hash | Result |
|---|---|---|---|---|
| INV-1111-A | `0u4kwsbdsf5s5dfzp6wjaeq5ces9sajpv8hwmsp52a9e5bz30ave60` | `zi pay` (1 NEAR, one tx with state init) | `BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA` | `PAID`, 0.92 merchant / 0.08 vault, storage 355 |
| INV-1111-B | `0utxj6evg2181sh8vwev5epp31d35a7dqpmrr16k51hkgbpgcev0gg` | plain Transfer (wallet/exchange style) | `2eXsHhHMnLcRgdyNW1Eyc6mvaGLtCggP13XLYrYErngC` | account `UNINITIALIZED`, 1 NEAR parked |
| INV-1111-B | same | `zi sweep` | `5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa` | `PAID`, `paid_by=null`, 0.92 / 0.08, storage 328 |
| INV-1111-C | `0u97723pqzyx0zqkcxy11mc1shet2xhkgq47e6t5sy5fwzk2mjrzhg` | `zi pay --amount 0.5` against 1 NEAR | `DSbTpzE2cPMgoYav23oBGpxEVY46caLPYdewBfzvUwDJ` | `REFUNDED_UNDERPAID`, 0.5 refunded, status stays `OPEN`, storage 328 |

`npm run zi -- replay fixtures/demo-run.json` → only `PASS` lines, exit 0, among them
`PASS before-unknown-account INV-1111-A`, `PASS pay-tx-success INV-1111-A BdzRBcFf… result=PAID`,
`PASS split-merchant INV-1111-A 0.92`, `PASS split-vault INV-1111-A 0.08`,
`PASS transfer-path-uninitialized INV-1111-B 1`, `PASS sweep-tx-success INV-1111-B 5P2rkpk… result=PAID`,
`PASS refund-event INV-1111-C REFUNDED_UNDERPAID`. `npm test` → `# tests 26`, `# pass 26`, `# fail 0`, `# skipped 0`
(17 before the day-2 review; `test/demo-run.test.ts` now pins the seven checks above).

## T15 dashboard on real accounts

Run 2026-11-10 02:36–02:38 Istanbul (2026-11-09 23:36–23:38 UTC), testnet protocol 88, accounts `sm1110-zi-*`,
code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`.

```bash
npm run zi -- serve --port 8787
# SERVE http://127.0.0.1:8787
```

The server was started with `ZI_INVOICE_DIR` pointing at a scratch directory so the dashboard listed only the two
invoices created for this shot; the resulting docs were then copied to `invoices/demo/`. The pages were driven with the
same HTTP requests the buttons make (`POST /api/invoices`, `POST /api/invoices/:id/pay`, `GET …/status`,
`POST …/sweep`) while the server signed with the real payer/sweeper keys from `.env`.

| Invoice | Account | Step | Tx hash | Result |
|---|---|---|---|---|
| INV-WEB-1 | `0uh8dpzj0t01vkjyate1r3afffrxk02rvmp9nckeakv442hcvdhtr0` | create (no tx) → `NONEXISTENT`; **Pay** | `7Wr1vhFPHfR9VZb3W3C4oiiWkVWwKvNSGrgT9YAiSCQ1` | `PAID`, one tx `[UniversalStateInit, pay]`, 0.92 / 0.08, storage 354 |
| INV-WEB-2 | `0ubm7gg12pnhwge64nyd7cv2g4bprmhpxe0t8hx1ddyg6z2qxrdmtg` | create (no tx) → `NONEXISTENT` | — | — |
| INV-WEB-2 | same | plain Transfer (near-cli path) | `AZDbMcD4Nr7D2wjvwgFYaue9gsXrxSkjLGTbQREhZY9S` | `UNINITIALIZED`, 1 NEAR parked |
| INV-WEB-2 | same | **Sweep** | `8X2wMK44pywVho3u4cZe4iymzncxPi7eR5cuLvLNmh92` | `PAID`, `via:"transfer"`, `paid_by=null`, 0.92 / 0.08, storage 327 |

`near tokens sm1110-zi-payer.testnet send-near <0u…> '1 NEAR' …` again printed
`<0u…> does not exist on <testnet>` and then failed with `The input device is not a TTY`, exactly as in S-D, so the
plain transfer used the documented RPC-level fallback `scripts/plain-transfer.ts` (same single `Transfer` action).

Final read-only check after the run:

```bash
npm run zi -- status INV-WEB-1
# STATE INITIALIZED status=PAID paid_by=sm1110-zi-payer.testnet balance=0 storage=354
npm run zi -- status INV-WEB-2
# STATE INITIALIZED status=PAID paid_by=null balance=0 storage=327
```

Images — **HTML renders, not live screenshots** (both show the green `PAID` badge):

- `docs/img/dashboard-pay-html-render.png` — INV-WEB-1 `PAID` after the one-tx pay; log shows the real `PAID` event,
  transfers 0.92 / 0.08 and tx hash.
- `docs/img/dashboard-sweep-html-render.png` — INV-WEB-1 and INV-WEB-2 both `PAID`; log shows the sweep tx with
  `via:"transfer"`, `paid_by=null`, and the same 0.92 / 0.08 split.

**Image method (disclosed):** this headless run has no browser (Chrome/Chromium/Playwright/Puppeteer and Quick Look are
blocked), so the PNGs are not OS screen captures and not screenshots. They are full-page rasters of the live
`zi serve` state: the same DOM/CSS of `web/index.html`, the real invoice docs and the real API responses (events, tx
hashes, transfers) captured at the two moments above, rendered with ImageMagick. Every value visible in the images is
from the live run. `docs/img/README.md` says the same. Do not present them as screen captures in `README.md`, the video
or the X post.

- [ ] live dashboard check + real screenshots (T19 buffer): run `node src/cli.ts serve --port 8787` in a real browser,
  follow the T15 click path, and overwrite `docs/img/dashboard-pay-html-render.png` /
  `docs/img/dashboard-sweep-html-render.png` with real captures.

### Plan corrections (day-2 review)

- **T15 allowed edits:** the task allowed CSS/HTML text in `web/index.html` only. `src/cli.ts` also had to change: the
  `serve` branch was moved ahead of the invoice-id lookup because the documented `npm run zi -- serve --port 8787`
  exited 2 with `usage: zi serve <INVOICE_ID>`. This matches INTERFACES §7 and changes no interface. Regression test:
  `test/cli-serve.test.ts` (spawns `node src/cli.ts serve --port <free>`, waits for `SERVE http://127.0.0.1:<port>`,
  then `GET /api/invoices` → 200 JSON array).
- **T15 images:** the two PNGs are HTML renders, not screenshots; they are named `*-html-render.png` and the real
  captures are the unticked item above.
- **T14 regression coverage:** `test/demo-run.test.ts` pins the seven T14 acceptance checks by name, id and detail
  (`before-unknown-account INV-1111-A` … `refund-event INV-1111-C REFUNDED_UNDERPAID`) and fails when the fixture is
  missing, so a truncated or re-recorded fixture can no longer pass replay silently.
- **Dashboard state coverage:** the badge/state functions of `web/index.html` moved to `web/state.js` (served at
  `/state.js`) and are pinned by `test/dashboard-state.test.ts`; `test/server.test.ts` covers the localhost API.
- `web/index.html` CSS: the result log `pre` max-height 240 → 560 px so the pay/sweep JSON is visible in the image.

Server hardening (same review): `zi serve` binds `127.0.0.1` only (already did), POST requires
`Content-Type: application/json` (400 otherwise), a present `Origin` must be `http://127.0.0.1:<port>` or
`http://localhost:<port>` (403 otherwise; requests without `Origin`, e.g. curl, are allowed), bad JSON and unknown
invoice ids return 400 instead of 502, and RPC/tx failures stay 502 (INTERFACES §8).

The pay/sweep endpoints wait for `EXPERIMENTAL_tx_status` FINAL, so the badge updates when the response lands
(measured 15.1 s for pay, 15.6 s for sweep in this run), not the ~5 s in the task sketch; the transaction itself was
final well before that and the UI refresh is 3 s.

## T19 buffer pass (day-3 review)

Supersedes commit `ea3f9d4` ("T19: buffer pass, no failures found"). T19 has no dependencies, so the scheduler
started it on day 0, before T06–T18 had produced anything: there were no fixtures, README, demo script or
dashboard to break, so "no failures found" was vacuous. The real buffer work is in the `fix: day0 review`,
`fix: day1 review`, `fix: day2 review` and this `fix: day3 review` commits. This section is the actual buffer
pass, run on the finished tree 2026-11-10 03:18 Istanbul (2026-11-10 00:18 UTC).

| Command | Exit | Result |
|---|---|---|
| `npm test` | 0 | `# tests 26` / `# pass 26` / `# fail 0` / `# skipped 0` |
| `npm run zi -- vectors` | 0 | 8 `PASS` lines (`crockford-kat-1` … `example-0s`) |
| `npm run zi -- replay fixtures/demo-run.json` | 0 | 20 `PASS` lines, no `FAIL` |
| `npm run zi -- replay fixtures/refund-cases.json` | 0 | 33 `PASS` lines, no `FAIL` |
| `bash scripts/judge-offline.sh` | 0 | 81 `PASS` lines, last line `JUDGE-OFFLINE: ALL PASS` |
| `npm run zi -- verify INV-1111-A` (live, read-only) | 0 | 5 `PASS` + `INFO status=PAID` |
| `npm run zi -- status INV-1111-B` (live, read-only) | 0 | `STATE INITIALIZED status=PAID paid_by=null balance=0 storage=328` |

Live check output:

```text
PASS id-from-terms 0u4kwsbdsf5s5dfzp6wjaeq5ces9sajpv8hwmsp52a9e5bz30ave60
PASS raw-from-terms
PASS code-hash-onchain Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
PASS terms-onchain
PASS no-access-keys
INFO status=PAID
STATE INITIALIZED status=PAID paid_by=null balance=0 storage=328
```

### Failure found and fixed

`scripts/judge-offline.sh` (T16) used a bare `npm ci`. With `NODE_ENV=production` in the environment npm omits
devDependencies, so only 3 packages were installed and `npm test` failed in `test/vectors.test.ts`:

```text
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'near-api-js' imported from .../test/vectors.test.ts
not ok 8 - test/vectors.test.ts
# tests 21
# pass 20
# fail 1
```

Fix: `npm ci --include=dev` in `scripts/judge-offline.sh`. Re-run in the same `NODE_ENV=production` shell:
`added 68 packages, and audited 69 packages`, `# tests 26` / `# pass 26` / `# fail 0` / `# skipped 0`,
`JUDGE-OFFLINE: ALL PASS`, exit 0.

### T17 fix (same review)

The README "AI use disclosure" now states what actually ran (operator run record): the plan, byte-level
reference code and tests were drafted with Claude (Anthropic); the implementation was written by DeepSeek v4.1
Flash (`deepseek/deepseek-v4.1-flash`, max effort) in Command Code agent sessions, orchestrated by Conductor
(a Claude Code based orchestrator); daily review by Claude Sonnet 5.5, fixes by DeepSeek, final review by
Claude Opus 5.5; the T04/T05 testnet accounts, funding and global deploy were done by Claude Opus 5.5 acting as
operator. Human: Erhan. It no longer claims the implementation was written in
Claude sessions or reviewed by a human, which did not match the run record or the git author (Erhan Türker).

## Contract v2 build (audit contract-1/2/3)

- wasm: `contract/res/zeroinit_invoice.wasm` (v2; v1 is in git history, deployed hash `Amg4WXKy…GW6k`)
- size: 82,942 bytes
- sha256 hex: `3562e978e6924a2c538e9906fc42d15a652947891f18f7816e3c7807d20f622f`
- code hash (base58): `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`
- Not deployed; `ZI_CODE_HASH`, `src/config.ts` and the fixtures are unchanged. Unit tests: 14 pass; the five
  `audit_contract_*` tests fail against v1 (checked with a v1 copy plus stubs).
