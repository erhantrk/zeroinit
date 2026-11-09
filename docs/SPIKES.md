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
