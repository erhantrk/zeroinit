# ZeroInit — Day-0 Spikes

Live testnet results and build numbers. Every tx hash recorded here is real unless marked synthetic.

**Current contract: v3.2** (code hash `6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ`, global deploy tx `GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg`), see the last
section ("Contract v3.2 live"). v3.1 (`2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, deploy tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, section "Contract v3.1 live") is recorded history. v3 (`Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`, deploy tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT`) is recorded history too (section "Contract v3 live"). v2 (`4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`, deploy tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG`) is recorded
history (sections "Contract v2 build", "Contract v2 live"). Everything above those is the **v1** log (code hash
`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`), kept as recorded history too.

**Paths:** the text is a record of the paths used on the day. The v2 contract now lives in `contract-v2/` (wasm
`contract-v2/res/`), the v2 recordings in `fixtures/v2/` and `invoices/v2/`, and the v1 recordings in `fixtures/v1/`
and `invoices/v1/`. `contract/` is the v3.2 contract (deployed), `fixtures/v32/` and `invoices/v32/` are its live recordings, `fixtures/v31/` and `invoices/v31/` the v3.1 ones, `fixtures/v3/` and `invoices/v3/` the v3 ones, and `fixtures/v3-synthetic-token.json` is a **synthetic** parser fixture (not a recording).

## T03 build

- wasm: `contract/res/zeroinit_invoice.wasm`
- size: 78,519 bytes (`wc -c`)
- `shasum -a 256` hex: `912ae75e72dd90173a8e0c6c3225927b7a68ae66788df704c8bf8979c543c3c9`
- code hash (base58 of sha256): `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`
- cargo-near version: `cargo-near-near 0.23.0`
- contract tests: `test result: ok. 7 passed; 0 failed`
- **v1 was frozen** after T05 (a rebuild = new hash = another ~8 NEAR burn). The audit later justified that burn: see "Contract v2" below.

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

That gave an unplanned but useful data point: `sweep()` on an **already-PAID** invoice (SPEC.md §5.2 last row).

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
  0.1 NEAR forwarded to the merchant (no tax split on extra funds, per SPEC.md §5.2). `paid_at_ms`/`paid_amount`
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
(SPEC.md §0), so `deposit: 0` on `UniversalStateInit` stays correct and the pre-approved 0.01 NEAR
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

- `docs/img/dashboard-pay-html-render.png` — INV-WEB-1 `PAID` after the one-tx pay (removed 2026-11-10, replaced by the
  real screenshot `docs/img/dashboard-pay.png`, see below).
- `docs/img/dashboard-sweep-html-render.png` — INV-WEB-1 and INV-WEB-2 both `PAID`; log shows the sweep tx with
  `via:"transfer"`, `paid_by=null`, and the same 0.92 / 0.08 split.

**Image method (disclosed):** this headless run has no browser (Chrome/Chromium/Playwright/Puppeteer and Quick Look are
blocked), so the PNGs are not OS screen captures and not screenshots. They are full-page rasters of the live
`zi serve` state: the same DOM/CSS of `web/index.html`, the real invoice docs and the real API responses (events, tx
hashes, transfers) captured at the two moments above, rendered with ImageMagick. Every value visible in the images is
from the live run. `docs/img/README.md` says the same. Do not present them as screen captures in `README.md`, the video
or the X post.

- [x] Live dashboard check + real screenshots (2026-11-10, contract v2, Chrome): INV-SHOT-1 (0.1 NEAR) paid from the
  dashboard's **Pay** button; `zi status INV-SHOT-1` → `status=PAID paid_by=sm1110-zi-payer.testnet`, tax 0.008 NEAR.
  Captures: `docs/img/dashboard-pay.png`, `docs/img/dashboard-invoices.png`. The sweep image is still the HTML render.
  Found and fixed during the check: the page polled every invoice's status every 3 s (overlapping requests, badges
  flashing back to `LOADING`, public RPCs answering 429). It now loads statuses on open, after each action and on a
  **Refresh statuses** click, keeps the last known badge while refreshing, and never runs two refreshes at once.

### Plan corrections (day-2 review)

- **T15 allowed edits:** the task allowed CSS/HTML text in `web/index.html` only. `src/cli.ts` also had to change: the
  `serve` branch was moved ahead of the invoice-id lookup because the documented `npm run zi -- serve --port 8787`
  exited 2 with `usage: zi serve <INVOICE_ID>`. This matches SPEC.md §7 and changes no interface. Regression test:
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
invoice ids return 400 instead of 502, and RPC/tx failures stay 502 (SPEC.md §8).

The pay/sweep endpoints wait for `EXPERIMENTAL_tx_status` FINAL, so the badge updates when the response lands
(measured 15.1 s for pay, 15.6 s for sweep in this run), not the ~5 s in the task sketch; the transaction itself was
final well before that and the UI refresh is 3 s.

## T19 buffer pass (day-3 review)

Supersedes commit `c69c4a6` ("T19: buffer pass, no failures found"). T19 has no dependencies, so the scheduler
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

- wasm: `contract-v2/res/zeroinit_invoice.wasm` (moved from `contract/res/` by the v3 rename; v1 is in git history, `git show ddf2d93:contract/res/zeroinit_invoice.wasm`)
- size: 82,942 bytes
- sha256 hex: `3562e978e6924a2c538e9906fc42d15a652947891f18f7816e3c7807d20f622f`
- code hash (base58): `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`
- Unit tests: 14 pass, including six `audit_contract_*` tests that replay the audit scenarios (the v1 behaviour they
  guard against comes from the audit's trace of the v1 code; it is not re-run as a test).
- Deployed as a global contract on 2026-11-10 ~13:20 Istanbul by the operator (Claude Opus 5.5, on Erhan's approval) from
  `sm1110-zi-deployer.testnet`: tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG` (a `DeployGlobalContract` action whose
  code hash is the sha256 above, checked read-only over RPC), burn 8.2949 NEAR for 82,942 bytes. v1 stays deployed as history.

## Contract v2 live

Run 2026-11-10 from ~13:23 Istanbul (testnet, protocol 88, accounts `sm1110-zi-payer/merchant/taxvault`, trusted hash
= v2). Three recordings with new `-V2` invoice ids; the old v1 recordings were moved to `fixtures/v1/` and still replay.
RPC: `rpc.testnet.near.org` began answering HTTP 429 ("endpoint is deprecated") during the run, so the default RPC is now
`https://test.rpc.fastnear.com` and the refund-case recording was redone from scratch on it (the two refund txs of the
aborted first attempt, `9pqhMqzYScDTN1woZWXF7cwDj4ufsrkHD5dMBNwwWR1W` and `BuKHW3wj2R7L2j8Y7o2XpUaAicF7ZQqkUYu473HNhJuH`,
are on chain but not in a fixture). `npm run` cannot spawn its shell inside the agent sandbox (`spawn EPERM`), so the
scripts ran through a shim that maps `npm run -s zi -- …` to `node src/cli.ts …`; the commands are the same.

**Demo run** (`ZI_RECORD=fixtures/demo-run.json scripts/demo.sh 1111-V2`, ids `INV-1111-V2-A/B/C`, 1 NEAR each,
`fixtures/demo-run.json`, docs in `invoices/demo/`):

| Shot | Tx | Result |
|---|---|---|
| A: pay (state init + pay in one tx) | `B7pwrVigiBoziDyFakYa5kFE1JMDkYtg8BNMm2k7XbEz` | `PAID`, 0.92 → merchant, 0.08 → tax vault, `STATE INITIALIZED status=PAID … balance=0 storage=358` |
| B: plain transfer | `FvENy8cNf5S31tgjydtYsHuYtcb15wAq5epWGJBPnTPK` | `STATE UNINITIALIZED balance=1` |
| B: sweep | `HUnCWN2kVy3HQVsVZAL3pL3VrcuJAH6XwxDQUgW8Vyig` | `PAID`, 0.92 / 0.08, `paid_by=null`, `storage=331` |
| C: underpay 0.5 | `GMB8WaGLw2UyBbPVwSPTFU3XnL6uT7FiBVToaqEV2YxH` | `REFUNDED_UNDERPAID`, 0.5 back to the payer, status `OPEN` |

`zi verify INV-1111-V2-A` (live): `PASS code-hash-trusted`, `INFO deployment v2 (current: fixes contract-1/2/3)`,
`PASS id-from-terms 0udab1xwq7vv8jx0nxbg79gabtq0y3z31822qyfwh8env9bytrpc90`, `PASS raw-from-terms`, `PASS doc-fields-from-terms`,
`PASS code-hash-onchain 4bQ61AgH…`, `PASS terms-onchain`, `PASS no-access-keys`, `INFO status=PAID`. `zi verify INV-1111-A` on the v1
invoice still passes and prints `INFO deployment v1 (history, frozen: …)`.

**Refund cases** (`scripts/record-refund-cases.sh V2`, `fixtures/refund-cases.json`, 0.1 NEAR each):

| Case | Tx | Result |
|---|---|---|
| REF-UNDER-V2 | `6X6ia7EeVVGmPshQjtWC3LJUuRq5qyhvxS6EtjshYhzr` | `REFUNDED_UNDERPAID`, 0.05 back, status `OPEN` |
| REF-EXPIRED-V2 | `Gapm9F9VRtQJwW2D3pXAVTDJ9FRyyPxvKYNd1roZ6QgH` | `REFUNDED_EXPIRED`, 0.1 back, status `EXPIRED` |
| REF-TWICE-V2 | `4QwpapDXDSHRNS4VxEjUkY65KhQsuVtMEhJNXNrK5q7E`, then `FvBz3wEEzq8tcS6PuNKtE4GA6ZkdmHL4M7cUrsuSdeKT` | `PAID` (0.092 / 0.008), then `REFUNDED_NOT_OPEN`, 0.1 back |
| REF-OVER-V2 | `8syXPJNeDYKtYUXv9cwdBXXvjWawhQTcbWEBcc7vhYvC` | `PAID`: 0.092 / 0.008 and the 0.05 excess back to the payer |
| REF-SWEEPLOW-V2 | transfer `BvKoRH5stKdjRLLMV9CEuFGraooqJnFVjEs5bUWStQvu`, sweep `2pw7QeQG8JFvzZNQ1hKGwXTwWohnsiE6Rm8Fp8bRoXJR` | sweep reverted `UNDERPAID: available 50000000000000000000000 < amount 100000000000000000000000`, 0.05 stays parked (`UNINITIALIZED`) |

**Audit scenarios** (`scripts/record-audit-scenarios.sh V2`, `fixtures/audit-scenarios.json`, 0.1 NEAR, 800 bps):

| Scenario | Txs | What it proves |
|---|---|---|
| contract-1, `AUD1-V2` (1 min expiry) | plain transfer `5CuBjV7tkVt5U6kCrmvjikvgKKcwdKwsqVED2Wyy7arH`; zero-deposit pay after expiry `678rsqwkrqP6af9EKywJqJzYPKyU9oaFqd9YmRDmjsqm` → `REFUNDED_EXPIRED` (status `EXPIRED`, balance still 0.1, storage 325); sweep `8WQr2GUmH5ojoB1zniD2G4Q6V7PiRk2zjLUyYLpB4GNg` | `PAID`, `late: true`, 0.092 → merchant, **0.008 → tax vault**, record `tax_amount` 0.008, balance 0 (v1 would give 0.1 to the merchant and 0 to the vault) |
| contract-3, `AUD3-V2` | plain transfer `4Eon125bA7ujoLgku6DYoQ6XjgrvMd1aVq4hZGfkwysK`; pay (deposit 0.1) `3YPLdAp58fc8Fz6kTinRpQfXyT28ExmVY3NGXjL3p4WX` | `PAID` via `transfer`, event `payment_refunded` reason `already_funded` 0.1, transfers 0.1 → payer, 0.092 → merchant, 0.008 → vault, balance 0 (no double charge; v1 settled the deposit too and left 0.1 parked) |
| contract-2, `AUD2-V2` | pay `ARgzUkMKTZE46DkHVrjjHMqEQUWNMRqJ4QvTT1JaRYeg`; sweep `7z45ySFYduzwEDAQVneYZHHyjyV9gkGYHQqTe2szgRqj` | tax vault `unregistered.sm1110-zi-taxvault.testnet` does not exist (a subaccount only our own tax-vault account could create, so nobody else can ever claim the bounced funds). Pay returns `PAID`, the tax transfer fails (`AccountDoesNotExist`), `transfer_failed` role tax 0.008 is emitted and 0.008 sits on the invoice (storage 429). The sweep returns `TAX_RESENT`, emits `tax_resent` 0.008 to the vault only (it fails again, same bounce) and sends nothing to the merchant. The 0.008 NEAR stays parked on that testnet invoice |

The recorder (`src/rpc.ts` `redactSignatures`) replaces every 64-byte `ed25519:` string (block approvals, block/chunk/tx signatures) by
`ed25519:REDACTED-PUBLIC-SIGNATURE` before writing a fixture: they are public chain data that replay never reads, but a secret
scanner cannot tell them from a key. The v1 fixtures were recorded before this and keep theirs.

Replay support added for these flows (`src/replay.ts`): `before-parked-account` (a pay on an invoice whose funds are
already parked), a zero-deposit refund is accepted only for `REFUNDED_EXPIRED`, `refund-already-funded` (reason, amount =
deposit, recipient = payer = signer, the exact amount transferred back, `via: transfer`), and `transfer-failures-recorded`
(every downstream failed receipt has a `transfer_failed` event). `src/outcome.ts` now reports a failed receipt that ran on
another account as `downstreamFailures` instead of failing the whole tx, and `zi pay` / `zi sweep` exit 1 with a warning when
there is one. `test/audit-scenarios.test.ts` pins each scenario from the recorded tx results and mutates each recording to
check replay catches tampering.

## Verification run for v2 (2026-11-10)

| Command | Exit | Result |
|---|---|---|
| `node --test test/*.test.ts` (= `npm test`) | 0 | `# tests 96` / `# pass 96` / `# fail 0` / `# skipped 0` |
| `cd contract && cargo test --offline` (= `npm run contract:test`) | 0 | 14 passed, 0 failed |
| `node src/cli.ts vectors` (= `npm run zi -- vectors`) | 0 | 8 `PASS` lines |
| `bash scripts/judge-offline.sh` (npm shimmed) | 0 | 309 `PASS`, 0 `FAIL`, `JUDGE-OFFLINE: ALL PASS` |

## Contract v3 live (2026-11-10)

Contract v3 (NEP-141 invoices, `SETTLING`, owed ledger, payout lock) is deployed as a global contract on testnet and was run live by the
builder (Claude Sonnet 5.5) with the operator's accounts (Claude Opus 5.5 made the accounts, the tUSDC mock, the registrations and the global
deploy). All hashes below are real testnet transactions; each run is a fixture that replays offline (`npm run zi -- replay fixtures/v3/<name>.json`).
RPC: `https://rpc.testnet.fastnear.com`. The recordings keep the account ids and tx hashes; the 64-byte signatures are redacted.

### Build and deploy (operator)

- wasm: `contract/res/zeroinit_invoice.wasm`, 161,213 bytes (local `npm run contract:build`, **not** a reproducible build), sha256
  `0724781dd2c9f4f1b8bb30abbff0602578a7ad649fc5a450d4656ffde4740b1f`, code hash (base58) `Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`.
- The operator re-checked the wasm hash and the 8 test vectors (`PASS`) before the deploy.
- Global deploy: tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT`, signer `sm1110-zi3-deployer.testnet`; the printed hash equals the code hash above.
- **Deploy cost, measured by the operator:** the deployer went from 27 to 10.8774031 NEAR, so the deploy burned about **16.1226 NEAR** including gas
  (v2: 8.2949 NEAR for 82,942 bytes; v1: 7.8526 NEAR for 78,519 bytes). Both ratios are about 0.0001 NEAR per wasm byte.
- Accounts (created by the operator through the faucet): `sm1110-zi3-deployer`, `-merchant`, `-taxvault`, `-payer`, `-sweeper`, `-unreg`, `-unreg2` (all `.testnet`).
  The faucet refused a ninth account, so the second mock token is `fake.sm1110-zi3-taxvault.testnet` (create tx `fLRNLJNAUcWKvEDrvuN3XeHpfqscR6NQpxEePcNbAWQ`,
  deploy + init `E9kXmcQPtBa3epH4tzwUENLh2K3yCEGwb3YmghKzW9Uj`).
- tUSDC: **`sm1110-tusdc.testnet`**, a mock NEP-141 (the `test-usdc` source, 6 decimals, owner = itself, deploy + init tx `2b3hMb4qHXo3XFan4y4gCG3zow5MEaQCzvg1eYrJgBDJ`,
  wasm sha256 `66d6fc0a…570c1`). It is a testnet mock: anyone who owns it can mint, it has no value and no issuer. The merchant, tax vault, payer and sweeper
  were registered on it and the payer got 100 tUSDC (minted by the owner). `sm1110-zi3-unreg` and `sm1110-zi3-unreg2` were left unregistered on purpose.

### The runs (what each proved; fixtures under `fixtures/v3/`)

Merchant = `sm1110-zi3-sweeper.testnet`, tax vault `sm1110-zi3-taxvault.testnet`, payer `sm1110-zi3-payer.testnet`, 800 bps. NEAR amounts 0.1 (1 in the demo).

| Run | Invoice | Transactions | Result |
|---|---|---|---|
| L1 pay | `INV-V3-A` | pay `H97h3dn4nDmzG4Fxx6XPwesAHNJkhhwCHtANJLJ4aUFQ` | `PAID`, 0.092 / 0.008, `invoice_paid` from `on_settled` |
| L1 plain + sweep | `INV-V3-B` | plain transfer `5yvsgk9TrQ3fUBnpoNhVa9R3kNW6j7rxxVrytzUrdFg4`, sweep `44788A1MCryaRWekWTJYcKx2iguYVegdNzVHTfyihJmZ` | `PAID`, `paid_by` null |
| L1 underpay | `INV-V3-C` | pay 0.05 `39LpcVHhi7xCqFJfo2Z3uKvGD1icxtWt7dm3uAgJkpi7` | `REFUNDED_UNDERPAID`, status stays `OPEN` |
| L1 expired | `INV-V3-D` | pay `FuVnkSmpJ1KPW5RQKSZFLvXmRvhjZaxMXsrfo3P4HMC3` | `REFUNDED_EXPIRED`, status `EXPIRED` |
| L1 double pay | `INV-V3-E` | pay `93Lz8Pcwo2dtMvMPv6b9heVFgSWTJQHJBaENT5rqMyAR`, again `5Rs6jKxDCKs7pCQt6TnUiSf9FHWZyjJhvS51WayouiRQ` | `PAID`, then `REFUNDED_NOT_OPEN` |
| L2 (fix 1) | `LATE-V3` (merchant `late.sm1110-zi3-merchant.testnet`, does not exist) | pay `Gp1zyoBYjd2T9NKUU8z68hQqCanFt7Agv3TWzjuTMXJ1` | `PAYOUT_PENDING`, `transfer_failed` (merchant), **no `invoice_paid`**, status `SETTLING`, 0.092 stays on the invoice |
| L3 | | | **not run**: it needs the parent to create `late.…`, and this run was not allowed to create accounts. The retry that delivers an owed share is shown instead by L13 (tokens, v3) and by the AUD2-V2 re-sweep (NEAR, v2) |
| L4 (fix 2) | `REFUND-V3` (merchant never created, `grace_ms` 60 s) | pay `5evLS6TvWR6jp7DDZnRDZJ2UUzJFyPQapWuFzkEiGmZW`; `refund_payer` too early `B7CN44eobZwpc4wZbcnAGiYioQxQB3XxnKRvT6KM4Hi6` (`NOT_YET: refundable after …`); after the window `EKXYxx7RnigUuLxT5AGvvmhLoDcz6diPnKw8nniZ338a` | `REFUNDED`: 0.092 back to the payer (`owed_reclaimed`); the vault kept its 0.008 |
| L5 (fix 3) | `TAX-V3` | plain 0.05 `C1brBZRjwjAyA2QiYMJcQsogo7vUMBjL3rWRm6eHde1B`, pay 0.1 `99naQTxXfGb5a6RaeveXGFk37QRsU3p4a2UsVBgcGv1a`, sweep `EMaHjcPppRp2M49Vqtc6J15HT4YVzqAbwjKfe7j6yKoJ` | pay 0.092 / 0.008, then the parked 0.05 is split 0.046 / 0.004 (`extra_swept`): the vault got 0.012 in total, nothing untaxed |
| L6 token plain path (S-F1, S-F3) | `TOK-V3-A` | register id `36oEwerP6xArKcMPo52CsDZtxhwdUjLesdCWGMVyxwks`, plain `ft_transfer` 1 tUSDC `85mQgYa15Ki8pr3P3zLhWrp5j5Wa7mU2cpNSSq82LWKo`, sweep (state init + fund + sweep in one tx) `EXpJhWoheyu3UaBDwQpvFvETSYsD5YPwe4QftE5rqZFX` | before the sweep `view_account` says `UNKNOWN_ACCOUNT` and `ft_balance_of` says 1; after it `PAID`, 0.92 / 0.08 tUSDC |
| L7 token one step | `TOK-V3-B` | init (state init + fund) `HQda1HhasWmRjX5VpC2SWNe1jvEvBJWNY69RHQmm69u1`, `ft_transfer_call` `Gx21RYXAVDcXHuah8JAPktaTpMY23unjYeaYRQo47nJQ` | `invoice_paid` via `pay`, payer recorded; the call's final value is `"1000000"` (the amount **used**) |
| L8 token overpay | `TOK-V3-C` | `ft_transfer_call` 1.5 `6coHo3fsLmoKz64ubapYSFDG4ryXmAvWGiwK4ygkaX37` | only 1 tUSDC used (0.92 / 0.08), the token refunds 0.5 (`memo: "refund"`), `excess_refunded` 500000 |
| L9 token underpay | `TOK-V3-D`, `TOK-V3-E` | `ft_transfer_call` 0.5 `FLzCdzxdZZQF6y4fHYvXuDJhAY4u1Z9tJ81F9SM3Vzse`; plain 0.5 `3whyBZSGqpyBrfajHsBcA73pUvCj9yGnDfvrqxUXmtR4` + sweep `GxbdzbvA4XzFdukMSPJDQNqcqDr9BJveicpGCp18AjFJ` | call: `payment_rejected underpaid`, all returned, status `OPEN`; plain: sweep returns `UNDERPAID`, the 0.5 stays parked |
| L9b token expiry release | `TOK-V3-I` (1 min) | plain 0.5 `5K91H9TW1dSjH8oWpPuqQRsx2Afy9JYCxiudH2wfYcFh`; sweep after the expiry time `EbHah5PmdLaFsYhJcUNCmWinMv5ZtAs5rJRjuA7ZdgdA`; late call `AJHD9sM16Lm9mdkRDYBUA6gg78tpb1wSV2wCbXKMbynJ`; sweep `HYxZbJ3AbL91AqsH6DgHdWam2qHzNFJ6vABjfhTdLLR1` | the first sweep still returns `UNDERPAID`: an expired invoice stays `OPEN` until some call touches it. The late `ft_transfer_call` is returned (`expired`) and sets `EXPIRED`; the next sweep releases the parked 0.5 pro rata, 0.46 / 0.04 (taxed) |
| L10 token expiry | `TOK-V3-F` | `ft_transfer_call` after 1 min `BQ8jLUqRjmyqWN2MSWS78w9LBjYFn6ZV1W3xtSVshY2a` | `payment_rejected expired`, all returned, status `EXPIRED` |
| L11 wrong token | `WRONGTOK-V3` | `ft_transfer_call` on `fake.sm1110-zi3-taxvault.testnet` `6tH3P22zdNKu4QnR34TKcdQbUMcyAe5CQNrK3xtvdQ1L` | `payment_rejected wrong_token` (predecessor is the fake token), all 1 returned, status `OPEN` |
| L12 wrong msg | `BADMSG-V3` | msg `""` `2KFRX9GcyRnCse8K7kiELnE5BeRaGFRFkdYasdKkU1Wg`; msg `{"action":"x"}` `Ez838LK1aVaiKhAecZ6szndw18DsGseqFe2XRQBnafzk` | both `payment_rejected bad_msg`, all returned |
| L13 unregistered receiver | `UNREG-V3` (merchant `sm1110-zi3-unreg.testnet`, not on tUSDC) | pay `E7wFzkiECvP6XcJwZoNU2Am1jj4iyF9Nepb8mYyqCZbB`; register the merchant `46K58Bbgwa5VLchuaTw2VxT7xwgcVbUNZCTWuEkzidSL`; sweep `8bPrFWhhxmQxnDUTdYGGaicZ2VLU7kBfzgTH3F1ae5T7` | the vault got 0.08, the merchant's `ft_transfer` failed: `transfer_failed`, `owed_merchant` 0.92, `SETTLING`, no `invoice_paid`; after the registration the sweep re-sends exactly 0.92 to the merchant (`owed_resent`), `invoice_paid` with `retried: true`, `PAID` |
| L14 token `refund_payer` | `TOK-V3-G` (merchant `sm1110-zi3-unreg2.testnet`, never registered) | pay `9KeHMfgvw6yr2Ngr4jfkzokvvKaMZJFYzLwarDGY9NLS`, `refund_payer` after the window `5bPgAQZchjH9roa6DogoL8kKNy3QVUrdMWquSJutYnWJ` | `SETTLING` with 0.92 owed, then `REFUNDED`: 0.92 tUSDC back to the payer (`owed_reclaimed`) |
| L15 double claim | `TOK-V3-A`, `TOK-V3-B` | second sweep `CWqG2WxQJsQf1zkJFAf5aEC8tWCmcNrFbFHyj93m81Mm`; second `ft_transfer_call` `EHWSKgoZxk2i4Vy1isDPKUPsbFvdhwkqXafiHaWNBw35` | `NOTHING_TO_SWEEP`; `payment_rejected not_open`, all returned |
| L15b two sweeps at once (**not a fixture**) | `CONC-V3` | plain 1 tUSDC `6BBCrPSkdTjvBCpTvzgrrnfUYNmWXBhzbqJ35TRqYGwe`; sweep with the sweeper key `Hkxwhtkut33JTXKPrDbKYfSMpF3E4xvQy8VWij2RVsNY`; sweep with the payer key `D8rvD86fHsf9oQPR68oPZKPxKJA9iAKQX3zw6iZ6mPVz` | one sweep paid (`PAID`, 0.92 / 0.08); the other panicked `PAYOUT_IN_FLIGHT` and rolled back. One run, one outcome: this shows the lock held once, not that it always does |
| L16 wrong asset | `TOK-V3-H` | `pay()` with 0.1 NEAR on a token invoice `FeWSRyx71BHK4cDJnoyjqnmfNE82NK8Zq9DEm2QJi2PQ` | `REFUNDED_WRONG_ASSET`, the 0.1 NEAR came back, status `OPEN` |
| L17 verify | all 26 invoices in `invoices/v3/` | `zi verify <id>` (online) | 26 of 26: `PASS code-hash-onchain`, `PASS terms-onchain`, `PASS no-access-keys` (and `token-metadata-onchain tUSDC 6` for token invoices); `NOINIT-V3` is still `NONEXISTENT` |
| L19 low gas | `LOWGAS-V3` | `ft_transfer_call` with 40 Tgas `3FEFmEbxpWUbxG44tCAAQh5zTe4EyqGcQDhgvEKr59EA` | `payment_rejected low_gas`, all returned (40 Tgas was enough for the token to call `ft_on_transfer`, not for the accept path) |
| S-F2 | `NOINIT-V3` | register the id on tUSDC `4DzU2nm5PD2pEmmtWxbLqPJizjJzwxPi67GqTTVK1J5c`, `ft_transfer_call` to the never-initialized id `fcfCcFYTGGq97EMp32QzSrhhgbvLsD3rhLTYRDjhErb` | the receipt on the nonexistent account fails (`AccountDoesNotExist`), the token refunds the whole 1 tUSDC (`memo: "refund"`), the id is still `UNKNOWN_ACCOUNT` |
| Demo (NEAR) | `INV-1111-V3-A/B/C` (1 NEAR) | pay `HojCvzGPTbCzFEpvZfg3rPWr3JbaGqk46or2odUDbj3C`; plain `DGt26eXhPeR9bWRzU6wtwEDmS4fo7M5EjKmRHMYZKuLg` + sweep `DTzcu4hxzfW958KpwRz61Liq2tRM1bxfDNGNxLEuRNqh`; underpay `5rNEKX4aMNy6WvonQkjqNpFizeQXzBgdCNfgo6s2VcoR` | 0.92 / 0.08 twice, one refund; `fixtures/v3/demo-run.json` |
| Demo (tUSDC) | `TOK-1111-V3-A` (1 tUSDC) | register `EjiUt5KwjeTKQDvo8xPuRE3yMLdp3BeosXLpqQ9DUgiW`, plain `ft_transfer` `4yuzzb42a7m2F9mZAVQAHRiYZ162i4xwSEBuErr98Pau`, sweep `D6UbC33jBrPSxnZ241KpkUEM5d35KBPhTd67oPM8VSau` | paid by a plain transfer, swept by anyone, 0.92 / 0.08 tUSDC; `fixtures/v3/token-demo-run.json` |

Spikes: **S-F1** yes (`storage_deposit` and `ft_transfer` to a never-seen `0u` id work, NEAR still says `UNKNOWN_ACCOUNT`); **S-F2** yes (the call fails and the token
returns everything); **S-F3** yes (`[UniversalStateInit, fund, sweep]` works in one transaction, `TOK-V3-A`); **S-F4** (is the state-init `deposit` credited) was **not
run**, nothing relies on it; **S-F5/S-F6** are the measurements below.

### Contract-2 evidence on v2 (the vault now exists)

`unregistered.sm1110-zi-taxvault.testnet` was created as a sub-account of `sm1110-zi-taxvault.testnet`, signed with that account's own key (the only account this
round created): tx `FWBnYH6K5J2YzB7aLUNrzT8DNjRTeoqeJvuPaPFhot6x` (`CreateAccount`, 0.1 NEAR, the parent's public key as full access key; `scripts/create-v2-unregistered-vault.ts`).
Then `AUD2-V2` was swept again, signed by the v2 sweeper: tx `HECqnmtEyo7nK7stnh9VoxPHLsmTJyJY3qX3ATUtpife`, result `TAX_RESENT`, `tax_resent` 0.008 to the vault, no failed
receipt, the invoice account went from 0.008 to 0 NEAR, and the vault holds 0.108 NEAR (0.1 funding + 0.008 tax). The call is appended to `fixtures/v2/audit-scenarios.json`
(the original first sweep, which bounced again, is still there), and `test/audit-scenarios.test.ts` pins both.

### Measured (replaces the design estimates)

Tokens burnt are the sums over all receipts of the transaction (`gas_burnt`, `tokens_burnt`); deposits are not included.

| What | Measured |
|---|---|
| NEAR `pay` creating the account (`INV-V3-A`) | 13.70 Tgas, 0.0075600 NEAR burnt (v2: 0.0077197) |
| NEAR `sweep` after a plain transfer (`INV-V3-B`, the account already existed) | 13.67 Tgas, 0.0012770 NEAR |
| refund of an underpay (`INV-V3-C`) | 12.82 Tgas, 0.0074950 NEAR (it also created the account) |
| NEAR `pay` with a failed merchant payout (`LATE-V3`) | 21.03 Tgas, 0.0075510 NEAR |
| `refund_payer` (NEAR / token) | 4.70 / 6.36 Tgas, 0.000402 / 0.000568 NEAR |
| token init: `[UniversalStateInit, fund]` (`TOK-V3-B`) | 9.96 Tgas, 0.0072530 NEAR (includes the account creation charge) |
| token `ft_transfer_call` that settles (`TOK-V3-B`) | 13.13 Tgas, 0.0011780 NEAR, with 200 Tgas attached |
| token `ft_transfer_call` that is rejected (`TOK-V3-D`) | 6.92 Tgas, 0.000625 NEAR |
| token `ft_transfer_call` with a failed payout (`TOK-V3-G`) | 20.22 Tgas, 0.0011460 NEAR |
| token sweep: state init + fund + sweep (`TOK-V3-A`) | 21.99 Tgas, 0.0083450 NEAR, with 200 Tgas attached |
| token sweep that re-sends an owed share (`UNREG-V3`) | 10.32 Tgas, 0.000920 NEAR |
| NEP-145 registration of one account | 0.00125 NEAR deposit (kept by the token) + 2.04 Tgas, 0.000182 NEAR |
| `storage_usage`, NEAR invoice | 421 B after `pay` (0.1 NEAR), 426 B (1 NEAR), 393 B after plain transfer + sweep, 426 to 429 B with an owed merchant share, 457 B after `refund_payer` |
| `storage_usage`, token invoice | 417 B initialized and open, 416 to 422 B after a plain-transfer sweep, 445 B after a paid `ft_transfer_call`, 443 to 444 B with an owed share, 472 B after `refund_payer` (the largest seen) |

All of these are below the 770 B zero-balance limit; the design's worst-case bound is 696 B. The 1,000-yocto float is enough: after every settlement the invoice
account still held 998 to 999 yocto. These are single measurements from one run each, not an average.

### Findings of the live runs (each fixed, with a test that fails without the fix)

1. **`ft_transfer_call` returns the amount used, not the unused amount.** The design (and the first replay rule) said the final value of the transaction is the unused
   amount. The token (NEP-141 `ft_resolve_transfer`) returns what the receiver used: `"1000000"` for a settled 1 tUSDC payment, `"0"` for every rejected one. The replay
   rule `ft-rejected-<reason>` and the synthetic fixture were wrong for real recordings; the rule now proves the refund from the token's own `ft_transfer` events with
   `memo: "refund"` (`ft-call-accounting`, `ft-rejected-*`, `ft-excess-refunded`).
2. **The NEAR replay rules did not exist for v3.** `ft-split-*` ran on NEAR invoices (summing zero token payouts), a second pay on an initialized invoice failed
   `before-unknown-account`, and a `transfer-path` snapshot after the first transaction failed. Now: `split-merchant` / `split-vault` for NEAR, `split-matches-terms`
   (tax = floor(amount x bps / 10000) from the invoice's own terms) for both assets, only the first snapshot is checked, and setup transactions (init, registration)
   no longer expect "after" snapshots. A malformed `invoice_paid` event is a `FAIL`, not a crash.
3. **`zi pay` said "the deposit was refunded" after `PAYOUT_PENDING`.** The payment was accepted and a payout failed; it now says `NOT PAID (yet): PAYOUT_PENDING`.
4. **`zi token register` printed `RESULT [object Object]`** (the token answers `storage_deposit` with an object); it now prints the JSON.

### Not run

L3 (needs an account to be created), S-F4, a reproducible wasm build, a browser walk-through of the dashboard (no browsers here), the wallet-side checks, and anything on mainnet.

### Verification run (this round, 2026-11-10)

| Command | Result |
|---|---|
| `node --test test/*.test.ts` (= `npm test`) | `# tests 155` / `# pass 155` / `# fail 0` |
| `cd contract && cargo test --offline` | 64 passed, 0 failed |
| `cd contract-v2 && cargo test --offline` | 14 passed, 0 failed |
| `node src/cli.ts vectors` | 8 `PASS` |
| `scripts/judge-offline.sh` with `npm run -s zi --` mapped to `node src/cli.ts` (npm printed no CLI output in the sandbox) | 0 `FAIL`, `JUDGE-OFFLINE: ALL PASS` |
| `zi verify <id>` (online) on the 26 invoices of `invoices/v3/` | 26 of 26 pass |

The slot wrapper (`$CONDUCTOR_BIN slot run`) exited 255 without output here, so `npm test` and `cargo test` were run directly.

## Contract v3.1 live (2026-11-10)

Contract v3.1 is v3 plus the final-review fix F1 (a token `sweep` that reads the balance while an `ft_transfer_call` is in flight plans nothing and returns `CONCURRENT_PAYMENT`).
It was deployed by the operator (Claude Opus 5.5) and run live by Claude Sonnet 5.5 with the operator's accounts. All hashes below are real testnet transactions; each run is a
fixture that replays offline (`npm run zi -- replay fixtures/v31/<name>.json`). RPC `https://rpc.testnet.fastnear.com`; signing with the repo's own encoder (parity-tested against
near-api-js 7.4.0), keys from `.env`, never printed. Recordings keep ids and tx hashes; the 64-byte signatures are redacted.

### Build and deploy (operator)

- wasm: `contract/res/zeroinit_invoice.wasm`, 163,771 bytes (local `npm run contract:build` from commit `d1c185a`, **not** a reproducible build), sha256
  `1b1dcc7515f2b9d6bada0540ed20833dd3050d074e155fb8d489ac2afe01e278`, code hash (base58) `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`. This run re-checked the sha256 of the committed file
  (`sha256sum`: the same digest) and ran `zi verify`, which compares the on-chain `global_contract_hash` of every invoice below with that code hash (all `PASS code-hash-onchain`).
- Global deploy: tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`. Deployer burn **about 16.38 NEAR**: deployer balance 17.8774031 → 1.4989866 NEAR across the deploy tx, gas included (cross-checked on chain on 2026-11-11: 16.378417 NEAR).
- Accounts as in "Contract v3 live". New in this round: `late.sm1110-zi3-merchant.testnet`, created by its parent (L3, below).

### The runs (fixtures under `fixtures/v31/`)

Merchant = `sm1110-zi3-sweeper.testnet`, tax vault `sm1110-zi3-taxvault.testnet`, payer `sm1110-zi3-payer.testnet`, 800 bps, tUSDC `sm1110-tusdc.testnet`.

| Run | Invoice | Transactions | Result |
|---|---|---|---|
| NEAR demo: pay | `INV-1111-V31-A` (1 NEAR) | pay `8gYZVNFT9DBk9PTZ7jqbe7w2iz4Fnewo4fudVYAzAwFF` | `PAID`, 0.92 / 0.08, `invoice_paid` from `on_settled` (`scripts/demo.sh 1111-V31`) |
| NEAR demo: plain + sweep | `INV-1111-V31-B` | plain transfer `AzASJAvoViqMhFcUX38MtJvMGijdwAc3xCi2rtA3qujd`, sweep `CNoLGGbaUAaYZKcCyrATmU6SHgY9hzWUJx2uykBSLVgR` | `PAID`, `paid_by` null, 0.92 / 0.08 |
| NEAR demo: underpay | `INV-1111-V31-C` | pay 0.5 `CAs1exvFhRwcRT5wCKK8HYoijbpQkdRwoCNPWCqfqhRg` | `REFUNDED_UNDERPAID`, status `OPEN` |
| tUSDC demo: plain `ft_transfer` + sweep | `TOK-1111-V31-A` (1 tUSDC) | register the id `A3LGRoPeaWNXb6oC4UW1eo7v413E5ahftLoB4qJkKuFV`, plain `ft_transfer` `6bj1B77NHBnK8jwfRfKvVEqNw9HMUpnQQmPrqfRgBXCM`, sweep (state init + fund + sweep) `HnN8YwYDG9R8rap34fuTibAVEDcdUpc8xa7jrouY7efK` | before the sweep NEAR says `NONEXISTENT` and `tokens_parked=1 tUSDC`; after it `PAID`, 0.92 / 0.08 tUSDC (`scripts/demo-token.sh 1111-V31`) |
| tUSDC one-step | `TOK-V31-B` | init (state init + fund) `66x7f5Dm8jWoRBCka7FTc3T8Un1cj4pcRJjsc9uccc4X`, register the id `BUzVpsAJo8vUJnXcx7bBXpJiaMJq9FNo4smH1oHK3b96`, `ft_transfer_call` `2P3iTieD2Sg5gxz4ANANKALLW358CKHUqapv3EdopY8i`, second call `Au6JXELexV8LiARqrU9GLwwxZZYSk5YwSzDthPwqK9rL` | `invoice_paid` via `pay`, payer recorded, the call's final value is `"1000000"` (amount used); the second call `payment_rejected not_open`, final value `"0"` (`scripts/record-v31-tokens.sh`) |
| **F1 race** | `RACE-V31-4` | init `47Jujj8fmLSRPfSx1F6j5nrMBHMUZmaSTfFJEmnDjm3g`, register the id `AsEDHLUXYHGoVPb7TZx42uLR8m8g7vcB4aevSaUwS9zc`, sweep `8vtV5twiaxVdUvTUopcs2eUAG2hzANxdeMWSSqoYJZ9Y` and `ft_transfer_call` `7BZsoa9Sc5wCe9pbWvJhs3Pc7QuZcKZWR1sQRtvZoKQe` sent at the same moment (offset 0 ms), then the retry `3GuRUGcm8CMUHsqhu55thgU8NARadEjYD57JwkarWgpK` | the sweep returned **`CONCURRENT_PAYMENT`** (no payout, no event, success); the payment got `payment_rejected busy`, final value `"0"`, and the token's `ft_transfer` with `memo: "refund"` returned the whole 1 tUSDC to the payer; the invoice stayed `OPEN`, nothing owed, `paid_by` null, `busy_until_ms` 0; the retried call was accepted: `PAID`, 0.92 / 0.08 tUSDC (`scripts/record-v31-race.sh`, `scripts/race-v31.ts`) |
| L2 (v3.1) | `LATE-V31` (merchant `late.sm1110-zi3-merchant.testnet`, not yet created) | pay `8FS68syB7ETYjMEXzRHRrePhyxcMEPnSFS5K1Nzo5jTC` | `PAYOUT_PENDING`, `transfer_failed` (merchant, `AccountDoesNotExist`), status `SETTLING`, **no `invoice_paid`**, 0.092 NEAR stays on the invoice |
| **L3** (account created) | | `sm1110-zi3-merchant.testnet` creates `late.sm1110-zi3-merchant.testnet` with its own key (`CreateAccount` + 0.1 NEAR + the parent's public key as full access key): `6eX2vJwSSZ1n8wB7VtzUvzfADXPZhseik4uupNGpPq6v` | the account exists |
| **L3** on v3.1 | `LATE-V31` | sweep (sweeper key) `4nXzCkeCZxyvW5rN3kx55jG39RDj8VqSfyfPPxq647jJ` | `PAID`; `owed_resent` of exactly 0.092 NEAR to `late.…`, `invoice_paid` with `retried: true`, one Transfer receipt, invoice balance 0 |
| **L3** on the recorded v3 invoice | `LATE-V3` (its 0.092 NEAR was owed on the v3 account since the first v3 round) | sweep (sweeper key, `ZI_CODE_HASH` pinned to the v3 hash `Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`), tx `DracoGyTgSuxYAqHH35ySGbnRXmfETrt1Z5TuKTjF6y1` | `PAID`, `owed_resent` 0.092 to `late.…`, `invoice_paid` `retried: true`; recorded as `fixtures/v3/late-resweep.json` (the first v3 recording is unchanged) |
| **S-F4** | `SF4-V31` (NEAR, 0.1) | `UniversalStateInit` with a **0.02 NEAR** deposit and nothing else, signed by the sweeper: `ENrFCa9DS1yUpPukQ6qSkAPcheNs3JH12DyEKnx5dXee` | **not credited**: the new account held 0 NEAR (storage 392 B); the system sent a `Transfer` of 0.02 NEAR back to the signer, who lost only gas (0.0071190411 NEAR). Evidence: `fixtures/v31/sf4.json` (not a replay fixture). Nothing relied on the deposit; `fund` stays |

**Failed attempts, kept on purpose.** Attempts 1 to 3 of the race (`RACE-V31-1..3`, not fixtures) forgot to register the invoice id on tUSDC. Each attempt's init is
`5vvgpfeCMW945FFfCPvXU5RN2wKWLYL4X9iRohbosp2N`, `GQMuDdEouVNqdAHzDHqkJuxqJizKaxK1roqdkbSxk72f`, `5mgn5UAcBx27QEjgpCfdmusP5JTDSBzY1bbQkxi1i3kJ`; the sweeps
(`49e4QJjLsB8AUS6dMVTNScEKiNSQ7sYuC9rtvaruHSrP`, `J5ihqzFyuk4MnRquTL7MdX42zfv1ZSumRAFNYfyhcUbn`, `6bN79ceNF43RoiUXsXq5xx4xQcUw5rLKrhnbTm4vSKz5`) returned `UNDERPAID` (nothing parked), and the
`ft_transfer_call`s (`5myRS7ExYhapRGLQFfYuedT5PygtPTm24Q4tRHrSgMRT`, `GzxZFhrqDip912oL2VRArKHQdHhQcXqGgvgATPz6p9ma`, `6Wh6NJtg72x52Jg4YreZNFFaUzXoi1fZsMTdoVUmYaqV`) failed in the token with
`The account … is not registered`; nothing moved. The script now registers the id first. The fourth attempt, the first with the registration, produced the race at once (offsets
0 / 150 / -150 ms were tried for attempts 1 to 3, 0 ms for attempt 4); with a single success the chance of hitting the alignment is not known.
No other transaction of this round failed or was retried.

How the race works on chain (why the sweep and the payment must share a block): both are executed on the first block after they are included. The payment credits the invoice on the token and
sends `ft_on_transfer` one block later; the sweep takes the lock in block N and reads `ft_balance_of` in block N+1, which already sees the credit; `ft_on_transfer` arrives in block N+1
while the lock is held and is rejected as `busy`; the callback in N+2 sees the changed lock value and returns `CONCURRENT_PAYMENT`. This explanation is inferred from the recorded receipts, not
from block numbers.

### Measured on v3.1 (single runs; tokens burnt = sum over all receipts, deposits not included)

| What | Measured |
|---|---|
| NEAR `pay` creating the account (`INV-1111-V31-A`) | 13.70 Tgas, 0.007561 NEAR (v3: 0.0075600) |
| token init `[UniversalStateInit, fund]` (`TOK-V31-B`) | 9.96 Tgas, 0.007253 NEAR |
| token `ft_transfer_call` that settles (`TOK-V31-B`, retry in `RACE-V31-4`) | 13.14 Tgas, 0.001179 / 0.001180 NEAR |
| token `ft_transfer_call` that is rejected `busy` (`RACE-V31-4`) | 6.93 Tgas, 0.000626 NEAR |
| token sweep that returned `CONCURRENT_PAYMENT` (`RACE-V31-4`) | 5.58 Tgas, 0.000491 NEAR |
| token sweep: state init + fund + sweep (`TOK-1111-V31-A`) | 22.04 Tgas, 0.008349 NEAR, 200 Tgas attached |
| NEAR `pay` with a failed merchant payout (`LATE-V31`) | 21.04 Tgas, 0.007552 NEAR |
| NEAR `sweep` that delivers an owed share (`LATE-V31` / `LATE-V3`) | 4.93 Tgas, 0.000426 / 0.000425 NEAR |
| `storage_usage` after a NEAR `pay` / after plain + sweep / token initialized / token paid by `ft_transfer_call` | 427 B / 399 B / 418 B / 446 B (limit 770 B) |

### Verification run (this round, 2026-11-10)

| Command | Result |
|---|---|
| `node --test test/*.test.ts` (= `npm test`) | `# tests 169` / `# pass 169` / `# fail 0` |
| `cd contract && cargo test --offline` | 65 passed, 0 failed |
| `cd contract-v2 && cargo test --offline` | 14 passed, 0 failed |
| `node src/cli.ts vectors` | 8 `PASS` |
| `scripts/judge-offline.sh` with `npm run -s zi --` mapped to `node src/cli.ts` and without its `npm ci` / `npm test` lines (those were run separately) | 0 `FAIL`, `JUDGE-OFFLINE: ALL PASS` |
| `zi verify <id>` (online) on the 8 invoices of `invoices/v31/` and on `LATE-V3` | 0 `FAIL`; each `PASS code-hash-onchain` against its own deployment's hash |

### Not run

A reproducible wasm build, a browser walk-through of the dashboard, wallet checks, an audit, mainnet, and a repeat of the race (one success is recorded; the alignment is chance, so it
was not run again). The slot wrapper `$CONDUCTOR_BIN slot run` was not used: nothing here was heavy (`cargo test` and `node --test` ran directly).

## Contract v3.2 live (2026-11-11)

Contract v3.2 is v3.1 plus the final audit's contract fixes (contract-1 HIGH: the sweep-vs-payment race closed on every rejection path; contract-2, -3, -4; `docs/HISTORY.md` "v3.1 → v3.2").
It was built and deployed by the operator (Claude Opus 5.5) and run live by Claude Sonnet 5.5 with the operator's accounts. All hashes below are real testnet transactions; each run is a
fixture that replays offline (`npm run zi -- replay fixtures/v32/<name>.json`). RPC `https://rpc.testnet.fastnear.com`; every transaction was signed with the repo's own encoder (parity-tested against
near-api-js 7.4.0) and the keys from `.env`, never printed. In this sandbox Node needed `NODE_USE_ENV_PROXY=1` for fetch; near-cli was not used. Recordings keep ids and tx hashes; the 64-byte signatures are redacted.

### Build and deploy (operator)

- wasm: `contract/res/zeroinit_invoice.wasm`, 164,040 bytes (local `npm run contract:build` from HEAD `2a57328`, **not** a reproducible build), sha256
  `016bf5ba27ae4e10022458d158cc070167b8b7eabc84cdd35ab2bd7c69f5e63d`, code hash (base58) `6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ`. In this run we re-computed the sha256 of the committed file and its base58 (same
  values), read the on-chain bytes with `view_global_contract_code` for that hash (164,040 bytes, **identical** to the committed file), and ran `zi verify` on every invoice below (all `PASS code-hash-onchain`).
- Global deploy: tx `GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg`, signer `sm1110-zi32-deployer.testnet` (one `DeployGlobalContract` action, status `SuccessValue`). Burn **about 16.4053 NEAR**: the operator reported the deployer balance 17 → 0.5946814 NEAR
  across the tx; we re-read the balance on 2026-11-11 (0.5946814 NEAR) and the tx's `tokens_burnt` from RPC (16.405318 NEAR). The deployer has one `FullAccess` key (`view_access_key_list`).
- Accounts as in "Contract v3 live" (`sm1110-zi3-*`, tUSDC `sm1110-tusdc.testnet`); nothing new was created this round.

### The runs (fixtures under `fixtures/v32/`)

Merchant = `sm1110-zi3-sweeper.testnet`, tax vault `sm1110-zi3-taxvault.testnet`, payer `sm1110-zi3-payer.testnet`, 800 bps, tUSDC `sm1110-tusdc.testnet`. Scripts: `scripts/demo.sh 1111-V32`, `scripts/demo-token.sh 1111-V32`,
`scripts/record-v32-tokens.sh`, `scripts/record-v32-race.sh` (all with `ZI_RECORD` set to the fixture).

| Run | Invoice | Transactions | Result |
|---|---|---|---|
| NEAR demo: pay | `INV-1111-V32-A` (1 NEAR, `0ue8ts6v…s62g`) | pay `5429mVJRFRoocYM8NoWMgzwJvF5Bm9SV8q1DudCPikTV` | `PAID`, 0.92 / 0.08, `invoice_paid` from `on_settled` |
| NEAR demo: plain + sweep | `INV-1111-V32-B` | plain transfer `9uDgwNmgD7GhnvLiCVjqfSSb65j62pqJLi5ntQEdGDfb`, sweep `EYnZsmvDFywiKGbsYgisxoo3RtA6qaSVpu9gpt3jS6RD` | `PAID`, `paid_by` null, 0.92 / 0.08 |
| NEAR demo: underpay | `INV-1111-V32-C` | pay 0.5 `FAmP6Tex6DZ2fMCCtppTfuyqBwsp1qiXqYL41dDFcHRt` | `REFUNDED_UNDERPAID`, status `OPEN`, 0.5 NEAR back to the payer |
| tUSDC demo: plain `ft_transfer` + sweep | `TOK-1111-V32-A` (1 tUSDC) | register the id `5D2YNnw2JK3M6yitqyLDnSscfdCEP6t4DbRM7ic4H5W9`, plain `ft_transfer` `81AaAHTuKnXVTX5D5NYv8RgcXKsqajhmFoJiEXPfTiKd`, sweep (state init + fund + sweep) `49CH4p2wTbiauGgW91nu6XwBBg7vHVsrRZmTQYW1SxRn` | before the sweep NEAR says `NONEXISTENT` and `tokens_parked=1 tUSDC`; after it `PAID`, 0.92 / 0.08 tUSDC |
| tUSDC one-step | `TOK-V32-B` | init (state init + fund) `4uLyLPLqZJHwQytBG6CWAzzd23hRuMUxbbpz8N9D2s1V`, register the id `c6hssuq5ZYdkmd4H7zJutdQFAk77Hh1nGsVQsKM5f4z`, `ft_transfer_call` `5675fC47kRnffiZsEpLzQszsGiAEQeeFYfUHRjubwTbT`, second call `36PxGeGUxYhg7UTX4AjrRX13xfbRwWDqJazXNbTKgRae` | `invoice_paid` via `pay`, payer recorded, final value `"1000000"` (amount used); the second call `payment_rejected not_open`, final value `"0"` |
| **Race on the `bad_msg` path** | `RACE-V32-1` | init `JC7yFPjq74dzQyGJsrcjY5gsZaPXBtvNZAEQQDdgSHRx`, register the id `BmmpffkDzat2bKnqpL2ZuRJWUnyerf5pVjSnFFCn6t3y`, sweep `4yJfVi5u7xovrd4oS9oRogzsGQ6bZQjYUqjY7MpMH18H` and `ft_transfer_call` with `msg` `{"action":"x"}` `3mT71ThnrkXoMXqBVhrBwafTDJPNkzQiL4L5DL58jtag` sent at the same moment (offset 0 ms), then the retry with the right msg `6GDR43PSW3XvrKvL2HEtFKeyd46g8ERnAEomtW4SM6HR` | the sweep returned **`CONCURRENT_PAYMENT`** (success, no payout, no event); the call got `payment_rejected bad_msg`, final value `"0"`, the token returned the whole 1 tUSDC to the payer; the invoice stayed `OPEN` (owed 0, `paid_by` null, lock 0); the retry was accepted: `"1000000"`, `invoice_paid`, 0.92 / 0.08 tUSDC, `PAID` |

**What the race run does and does not show.** It is the first attempt of the recorder (`RACE-V32-1`, offset 0 ms); no attempt failed and nothing was retried except the intended payer retry. The sweep took the lock, read `ft_balance_of`
while the wrong-`msg` credit was on the invoice, and the callback found the lock value changed by the rejection and planned nothing. That is exactly the path v3.1 did not protect (v3.1 raised the lock only for `busy`).
It is **one run that hit the right block alignment, not a rate**. We did **not** run the same sequence on v3.1, so the testnet evidence shows v3.2 behaving correctly, not v3.1 failing; that v3.1 had the hole rests on the Rust test.
The `expired` and `not_open` variants of the race were not produced on testnet (the unit tests cover them); the contract-2/3/4 fixes were not run live either.

### Measured on v3.2 (single runs; tokens burnt = sum over all receipts, deposits not included)

| What | Measured |
|---|---|
| NEAR `pay` creating the account (`INV-1111-V32-A`) | 13.71 Tgas, 0.007562 NEAR (v3.1: 0.007561) |
| token init `[UniversalStateInit, fund]` (`TOK-V32-B`) | 9.96 Tgas, 0.007254 NEAR |
| token `ft_transfer_call` that settles (`TOK-V32-B`; the retry in `RACE-V32-1`) | 13.15 / 13.14 Tgas, 0.001181 NEAR |
| token `ft_transfer_call` rejected `not_open` (`TOK-V32-B`) / rejected `bad_msg` (`RACE-V32-1`) | 6.94 / 6.92 Tgas, 0.000627 / 0.000625 NEAR |
| token sweep that returned `CONCURRENT_PAYMENT` (`RACE-V32-1`) | 5.59 Tgas, 0.000492 NEAR |
| token sweep: state init + fund + sweep (`TOK-1111-V32-A`) | 22.04 Tgas, 0.008350 NEAR, 200 Tgas attached |
| NEAR sweep after a plain transfer, with state init (`INV-1111-V32-B`) | 13.69 Tgas, 0.001279 NEAR (the plain transfer itself, 8.37 Tgas, 0.007095 NEAR, created the uninitialized account) |
| NEP-145 registration of the invoice id | 2.05 Tgas, 0.000183 NEAR (plus the 0.00125 NEAR deposit kept by the token) |
| `storage_usage` after a NEAR `pay` / after plain + sweep / token initialized / token paid by `ft_transfer_call` / token paid by plain + sweep | 427 B / 399 B / 418 B / 446 B / 423 B (limit 770 B) |

### Verification run (this round, 2026-11-11)

| Command | Result |
|---|---|
| `node --test test/*.test.ts` (= `npm test`) | `# tests 218` / `# pass 218` / `# fail 0` |
| `cd contract && cargo test --offline` | 94 passed, 0 failed |
| `cd contract-v2 && cargo test --offline` | 14 passed, 0 failed |
| `node src/cli.ts vectors` | 8 `PASS` |
| `zi replay` of every fixture of `scripts/judge-offline.sh` (v32, v31, v3, v2, v1: 21 files) and offline `zi verify` of every invoice in `invoices/v32`, `v31`, `v3`, `v2`, `v1`, run as a shell loop (not the script itself) | 0 failures |
| `zi verify <id>` (online) on the 6 invoices of `invoices/v32/` | exit 0 for each; `PASS code-hash-onchain 6YtW5oJ8…vMCNHJ`, `PASS no-access-keys` |
| `zi replay fixtures/v32/{demo-run,token-demo-run,tokens,race}.json` | 62 / 31 / 45 / 46 `PASS`, 0 `FAIL` |

### Not run

A reproducible wasm build, a browser walk-through of the dashboard, wallet checks, an independent audit, mainnet, the `expired` / `not_open` race variants on testnet, the contract-2/3/4 fixes on testnet, and a repeat of the race (one success is recorded).
`$CONDUCTOR_BIN slot run -- npm test` exited 255 with no output here, so `node --test` and `cargo test` were run directly (nothing was heavy). The invoice documents are `invoices/v32/*.json`; none contain secrets.

## Contract v3.2r live (2026-11-12)

v3.2r is the **same source as v3.2**, built reproducibly and published as a global contract by hash (`docs/HISTORY.md` "v3.2 → v3.2r"). Nothing about the contract changed, so these runs repeat the v3.2 runs on the new hash.
All hashes below are real testnet transactions; each run is a fixture that replays offline (`npm run zi -- replay fixtures/v32r/<name>.json`). RPC `https://rpc.testnet.fastnear.com`; transactions were signed with the repo's own encoder
and the keys from `.env`, never printed. In this sandbox Node needed `NODE_USE_ENV_PROXY=1` for fetch.

### Build and publish

- wasm: `contract/res/v3.2r/zeroinit_invoice.wasm`, 163,788 bytes, from `cd contract && cargo near build reproducible-wasm` at commit `4116e69` (image `sourcescan/cargo-near:0.23.0-rust-1.99.1`, pinned by digest), sha256
  `9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92`, code hash (base58) `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`. The build records its commit in the contract metadata: a later commit gives a different hash.
  The build and the publish were done by the operator before this run; in this run we re-read the on-chain `view_global_contract_code` bytes of the hash (163,788 bytes, sha256 identical to the committed file). We did not re-run the reproducible build in this run.
- Global publish: tx `DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs`, signer `sm1110-zi-deployer.testnet`, funded by three transfers from the retired v2 accounts. We did not read back the burn.
- Accounts as in "Contract v3 live" (`sm1110-zi3-*`, tUSDC `sm1110-tusdc.testnet`); nothing new was created this round.

### The runs (fixtures under `fixtures/v32r/`)

Merchant = `sm1110-zi3-sweeper.testnet`, tax vault `sm1110-zi3-taxvault.testnet`, payer `sm1110-zi3-payer.testnet`, 800 bps, tUSDC `sm1110-tusdc.testnet`. Scripts: `scripts/demo.sh 1111-V32R`, `scripts/demo-token.sh 1111-V32R`,
`scripts/record-v32-tokens.sh V32R` (with `ZI_RECORD_OUT=fixtures/v32r/tokens.json`), `scripts/record-v32-race.sh V32R 4` (with `RACE_OUT=fixtures/v32r/race.json`); the demos with `ZI_RECORD` set to the fixture.

| Run | Invoice | Transactions | Result |
|---|---|---|---|
| NEAR demo: pay | `INV-1111-V32R-A` (1 NEAR, `0u7hdnpr…4ppg`) | pay `GwnQFSjpCqcPZeSHiTmiu6t5ZMkhM6NQ8vh4NjDzDpWE` | `PAID`, 0.92 / 0.08, `invoice_paid` from `on_settled` |
| NEAR demo: plain + sweep | `INV-1111-V32R-B` | plain transfer `8vg2gkVxnYpKMqf75gTVx4eCXRqMn46edWz27BNNmPFL`, sweep `DKFQDCKQ6xNK1PeRHPDf372nj6zMJ9cPhPxYkLeCroXv` | `PAID`, `paid_by` null, 0.92 / 0.08 |
| NEAR demo: underpay | `INV-1111-V32R-C` | pay 0.5 `6824mNU425kmYZavKrmBQwurjJP9oVWnSqvxiDQiy3cH` | `REFUNDED_UNDERPAID`, status `OPEN`, 0.5 NEAR back to the payer |
| tUSDC demo: plain `ft_transfer` + sweep | `TOK-1111-V32R-A` (1 tUSDC) | register the id `8yXZ9S7TLX5dF5ih6wbjHALN982GwiJcqPjPxSNMaHzW`, plain `ft_transfer` `9TJ3YwAt8XQX12BC36hP9yzGyUj3jPb7qRB7uCGbjWWG`, sweep (state init + fund + sweep) `EmQYXvDFSsTX3ekgP3QLUxPVQW4TvLmhT5VVA8uvx4Q2` | before the sweep NEAR says `NONEXISTENT` and `tokens_parked=1 tUSDC`; after it `PAID`, 0.92 / 0.08 tUSDC |
| tUSDC one-step | `TOK-V32R-B` | init `EbGZTsHvDVA4s1Zo5i1L7cHQQS5r7YfPVUZuMbZdVabV`, register the id `2247afwRmXCHD6DDQeY1SahqC6yRjbpo3vF3m5zwcVfr`, `ft_transfer_call` `GZGNu2t2zShtUVbXxhKRvvB4bhueAD8TmGhr4dyBpGCJ`, second call `CHdcrrGrCTjCV1r9sBNN14rTWpC8RLA4NTZubjCksYH9` | `invoice_paid` via `pay`, payer recorded, final value `"1000000"`; the second call `payment_rejected not_open`, final value `"0"` |
| **Race on the `bad_msg` path** | `RACE-V32R-1` | init `AH8wQ5bcKFe8EDerhXAPgKLbMwpt65uTDS1XFG3TUjDG`, register the id `BWBs3MC14GWVHgAPfvvGXCSCSUEpqRB6VoNfhkkfTyv9`, sweep `mRNSLvycnnRCHh626BkMgUQTxvvqMdnBP3ns46hecDB` and `ft_transfer_call` with `msg` `{"action":"x"}` `5BMHSgs24N21yr3ux3L3b73ppX4qQcL37rMfTgi1DcQK` sent at the same moment (offset 0 ms), then the retry `8SpKRh4HEriaTJvCYJ1oY8s2Y8RE7SLghWkw7BHbvLQE` | the sweep returned `CONCURRENT_PAYMENT` (success, no payout, no event); the call got `payment_rejected bad_msg`, final value `"0"`; the invoice stayed `OPEN` (owed 0, `paid_by` null); the retry was accepted: `"1000000"`, `invoice_paid`, `PAID` |

**What the race run does and does not show.** First attempt of the recorder (offset 0 ms); one run that hit the right block alignment, **not a rate**. As on v3.2, we did not run the sequence on v3.1, and the `expired` / `not_open` race variants and the contract-2/3/4 fixes were not run live.
The invoice documents are `invoices/v32r/*.json` (6 files).

### Measured on v3.2r (single runs; tokens burnt = sum over all receipts, deposits not included)

| What | Measured |
|---|---|
| NEAR `pay` creating the account (`INV-1111-V32R-A`) | 13.70 Tgas, 0.0075612 NEAR (v3.2: 13.71 Tgas, 0.007562) |
| NEAR underpay refunded (`INV-1111-V32R-C`) | 12.83 Tgas, 0.0074963 NEAR |
| NEAR sweep after a plain transfer, with state init (`INV-1111-V32R-B`) | 13.68 Tgas, 0.0012789 NEAR (the plain transfer itself, 8.37 Tgas, 0.0070946 NEAR) |

The token figures were not re-measured on v3.2r (see "Measured on v3.2").

### Verification run (2026-11-12)

| Command | Result |
|---|---|
| `npm test` | `# tests 226` / `# pass 226` / `# fail 0` |
| `cd contract && cargo test` | 94 passed, 0 failed |
| `bash scripts/judge-offline.sh` | last line `JUDGE-OFFLINE: ALL PASS` |
| `zi verify <id>` (online) on the 6 invoices of `invoices/v32r/` | exit 0 for each, no `FAIL`; `PASS code-hash-onchain BQLSk5ca…zCFry`, `PASS no-access-keys` |
| `zi replay fixtures/v32r/{demo-run,token-demo-run,tokens,race}.json` | 62 / 31 / 45 / 46 `PASS`, 0 `FAIL` (the same counts as the v3.2 recordings) |
