# Verify ZeroInit yourself

Two paths, neither needs a key or a `.env`:

- [The offline judge path](#the-offline-judge-path): install, tests and replays of the recorded testnet runs. No network after `npm ci`.
- [Live read-only checks](#live-read-only-checks): a few RPC reads against NEAR testnet.

Then: [all claims](#all-claims) with the command and the expected output for each.
Whether the deployed wasm is built from this source is a separate check: [REPRODUCE.md](REPRODUCE.md).

## The offline judge path

Node 22 (`package.json` asks for `>=22.22.0 <23`). `npm ci --include=dev` needs the npm registry once.

1. `npm ci --include=dev` → installs the 3 runtime packages (`@noble/hashes`, `@noble/curves`, `@scure/base`) and the dev packages:
   `near-api-js` 7.4.0 (one encoder-parity test) and the MCP build tools. The flag matters: with `NODE_ENV=production` in the environment a plain `npm ci`
   skips devDependencies and the parity test cannot import `near-api-js`.

2. `npm test` → 254 tests, all pass: byte vectors from nearcore 2.14 and the frozen examples, units, deployments, `/1` and `/2` invoice documents, encoder parity with
   near-api-js 7.4.0, outcome/replay/CLI/dashboard/MCP tests, the check code, and the recorded fixtures of every version, each with tamper tests.

   ```
   # tests 254
   # pass 254
   # fail 0
   # skipped 0
   ```

3. `npm run zi -- vectors` → 8 lines, all `PASS` (`crockford-kat-1..4`, `wallet-0u`, `wallet-0s`, `example-0u`, `example-0s`).

4. `npm run zi -- replay fixtures/v33/demo-run.json` → the NEAR demo recorded live on the current contract (invoice ids `INV-1111-V33-A/B/C`, 1 NEAR each): 62 `PASS`, 0 `FAIL`, exit 0. Among them:

   ```
   INFO deployment v3.3 (current, deployed on testnet: parked funds count toward the price; reproducible build of commit 7727a1c) CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb
   PASS before-unknown-account INV-1111-V33-A NONEXISTENT
   PASS pay-tx-success INV-1111-V33-A GFzvAw8t95XhN1JnvSNY4K9sThv7HQahLp9AnJ2SHQLe []
   PASS invoice-paid-after-callback INV-1111-V33-A
   PASS split-merchant INV-1111-V33-A 0.92
   PASS split-vault INV-1111-V33-A 0.08
   PASS transfer-path-uninitialized INV-1111-V33-B 1
   PASS sweep-tx-result INV-1111-V33-B 2j8vbU6kcaXu5mmP9ZMnYVMcwsAXmzrit8ZUapQzaxGU result=PAID
   ```

   `INV-1111-V33-A` is paid by one transaction; `INV-1111-V33-B` by a plain transfer and a later sweep; `INV-1111-V33-C` is an underpayment that is refunded.

5. `npm run zi -- replay fixtures/v33/token-demo-run.json` → a **tUSDC** invoice (a testnet mock token), 30 `PASS`. The payer sends one transaction to the token that registers the
   invoice id (`storage_deposit`, 0.00125 NEAR) and makes a plain `ft_transfer` (the part an exchange does; an exchange would not register the id, so for tokens someone must),
   then anyone sweeps it in one transaction (state init + fund + sweep):

   ```
   PASS plain-transfer-tx-success TOK-1111-V33-A 8Z7Zk7pzQRUE8DfFuMdFZevZhJKMbSurxwuGt2GBfAca []
   PASS ft-parked-balance TOK-1111-V33-A 1
   PASS sweep-tx-result TOK-1111-V33-A DPngLpZB8cGBC9Vs8kk7STyTwdC5kVXCF1VntjgR9dVR result=PAID
   PASS ft-split-merchant TOK-1111-V33-A 0.92
   PASS ft-split-vault TOK-1111-V33-A 0.08
   ```

6. `npm run zi -- replay fixtures/v33/parked.json` → **payments on top of parked funds**, 109 `PASS`. A plain transfer parks part of the price, then a normal payment follows; the
   contract counts the parked part, takes only the rest and sends back what is left (NEAR `PARK-V33-N`, tUSDC `PARK-V33-T`). `PARK-V33-F` parks the full price first: the
   payment comes back whole and the parked tokens settle. `PARK-V33-U` parks 0.3 and pays 0.5: too little, returned as `underpaid`. None of them records a payer.

   ```
   PASS pay-parked-applied PARK-V33-N deposit 1 + parked 0.3 = settled 1000000000000000000000000 + excess 300000000000000000000000; 0.3 back to zeroinit-payer.testnet
   PASS paid-by-signer PARK-V33-N payer null, signer zeroinit-payer.testnet
   PASS ft-parked-applied PARK-V33-T used 600000 + parked 400000 = amount 1000000, refunded 400000 = excess 400000, topped up by zeroinit-payer.testnet
   PASS ft-call-accounting PARK-V33-F sent 1000000 = used 0 + refunded 1000000
   PASS ft-rejected-underpaid PARK-V33-U used 0, 500000 of 500000 returned to zeroinit-payer.testnet
   ```

7. `npm run zi -- replay fixtures/v33/tokens.json` → the one-step token path, 41 `PASS`: `zi init`, then one transaction with the registration and the `ft_transfer_call` that settles,
   a second call that is returned (`not_open`), and a direct call of the private callback `on_pay_balance` by the payer, which fails (`PASS private-callback-refused TOK-V33-B E19huFfX… refused`).

8. `npm run zi -- replay fixtures/v33/race.json` → the **race on the `bad_msg` rejection path**, 46 `PASS`: a token sweep sent in the same moment as an `ft_transfer_call`
   with a wrong `msg`. The sweep plans nothing, the token returns the payment whole, and the payer's retry settles
   (background: [HISTORY.md "v3.1 → v3.2"](HISTORY.md#v31--v32)):

   ```
   PASS sweep-tx-result RACE-V33-2 DCpUvQYnaUyinL3GT9mhdoUvs9juKqZAPx8U8A15DNnp result=CONCURRENT_PAYMENT
   PASS concurrent-payment-plans-nothing RACE-V33-2 0 payout(s), 0 event(s), 0 failure(s)
   PASS ft-rejected-bad_msg RACE-V33-2 used 0, 1000000 of 1000000 returned to zeroinit-payer.testnet
   PASS ft-split-merchant RACE-V33-2 0.92
   ```

9. `npm run zi -- replay fixtures/v33/two-payments.json` → **two token payments at the same moment**, from two accounts, 46 `PASS`. Both are returned in full as `busy`, then one retry pays
   ([HISTORY.md "v3.2r → v3.3"](HISTORY.md#v32r--v33) explains why):

   ```
   PASS ft-rejected-busy TWO-V33-2 used 0, 1000000 of 1000000 returned to zeroinit-payer.testnet
   PASS ft-rejected-busy TWO-V33-2 used 0, 1000000 of 1000000 returned to zeroinit-sweeper.testnet
   PASS pay-tx-success TWO-V33-2 7Xon5ck4qqCvbnc5D3fTSd2CmpwmTAbi5bN48pzLsKvA []
   PASS single-invoice-paid TWO-V33-2 1 invoice_paid event(s) in the recording
   ```

**The whole path in one command:** `bash scripts/judge-offline.sh` runs `npm ci --include=dev`, `npm test`, `vectors`, the six v3.3 replays, the four v3.2r replays, the four v3.2 replays, the five v3.1 replays,
the seven v3 replays, the three v2 replays, the two v1 replays and an offline `verify` of every invoice document in `invoices/v33`, `v32r`, `v32`, `v31`, `v3`, `v2` and `v1`.
It stops at the first failure; its last line is `JUDGE-OFFLINE: ALL PASS`. The older recordings replay under their own code hashes: [HISTORY.md "Replaying the earlier recordings"](HISTORY.md#replaying-the-earlier-recordings).

## Live read-only checks

The invoices under `invoices/v33/` were paid on testnet (protocol 88) on 2026-11-13. These commands only read RPC and work from a clean clone.
The default endpoint is `https://rpc.testnet.fastnear.com`; set `ZI_RPC_URL` to use another one (`https://rpc.testnet.near.org` answers HTTP 429 "endpoint is deprecated").

**The default RPC is not archival.** It keeps about 1.5 days of transactions, so a transaction lookup there fails with `UNKNOWN_TRANSACTION` once the transaction is older
than that (every transaction in this repo was sent between 2026-11-09 and 2026-11-13). State-based checks keep working (`zi verify`, `zi status`, `view_global_contract_code`),
and so does every offline replay. For a transaction lookup use the archival endpoint `https://archival-rpc.testnet.fastnear.com` (set `ZI_ARCHIVAL_RPC_URL`;
`zi receipt <ID> --tx <hash>` falls back to it by itself on the default RPC, for example `npm run zi -- receipt INV-1111-V33-A --tx GFzvAw8t95XhN1JnvSNY4K9sThv7HQahLp9AnJ2SHQLe`; it writes `invoices/<ID>.receipt.json`, which is gitignored) or nearblocks. The recorded fixtures under `fixtures/` are the durable evidence.

1. `npm run zi -- verify INV-1111-V33-A` → the address and the state-init bytes are recomputed from the terms and the pinned code hash (`ZI_CODE_HASH`, default v3.3
   `CrwuvfSL…aVsb`, never the invoice file's own `code_hash`), then compared with the chain. Any `FAIL` makes the command exit 1. Output, exit 0:

   ```
   PASS code-hash-trusted CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb
   INFO deployment v3.3 (current, deployed on testnet: parked funds count toward the price; reproducible build of commit 7727a1c)
   PASS format-matches-deployment zeroinit-invoice/2
   PASS id-from-terms 0us40y0dm1767jkzzxynmwjer15h4xy5wc96rg3xv5hfgs8fx421ag
   PASS raw-from-terms
   PASS doc-fields-from-terms
   PASS code-hash-onchain CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb
   PASS terms-onchain
   PASS no-access-keys
   INFO status=PAID
   ```

   `npm run zi -- verify TOK-1111-V33-A` does the same for the tUSDC invoice and adds `PASS token-allowed tUSDC zeroinit-tusdc.testnet`, `PASS token-metadata-onchain tUSDC 6`
   and `INFO token-balance 0 tUSDC`. `verify` of an older invoice (`INV-1111-V32R-A`, `INV-1111-V2-A`, `INV-1111-A`) checks it against its own historical hash; `zi pay`, `zi sweep` and `zi init` refuse historical invoices.

   The address check code works offline: `npm run zi -- check 0us40y0dm1767jkzzxynmwjer15h4xy5wc96rg3xv5hfgs8fx421ag MVNC` prints `PASS check-code 0us40y0d…`; any other code prints `FAIL check-code …` and exits 1.

2. Open <https://testnet.nearblocks.io/txns/GFzvAw8t95XhN1JnvSNY4K9sThv7HQahLp9AnJ2SHQLe> → one transaction with exactly two actions, `UniversalStateInit` + `pay`,
   receiver `0us40y0dm1767jkzzxynmwjer15h4xy5wc96rg3xv5hfgs8fx421ag`, result `PAID`, transfers of 0.92 NEAR to `zeroinit-merchant.testnet` and
   0.08 NEAR to `zeroinit-taxvault.testnet`, and `invoice_paid` logged by the `on_settled` callback. If nearblocks renders `0u…` ids poorly, the RPC `tx` method on the
   archival endpoint returns the same JSON, and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-V33-B` → the invoice that was paid by a plain transfer (no state init) and swept later:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=396
   ```

   Plain-transfer tx `6yU8ac2g9JpqDdQk2ia9PTo7oZppCZiYX8dCoAjwuJqQ`, sweep tx `2j8vbU6kcaXu5mmP9ZMnYVMcwsAXmzrit8ZUapQzaxGU`. `paid_by=null` is expected on this path:
   `sweep()` does not know who transferred the funds. `npm run zi -- status TOK-1111-V33-A` shows the tUSDC one (`status=PAID`, `tokens=0 tUSDC`, nothing owed); one tx
   `8Z7Zk7pzQRUE8DfFuMdFZevZhJKMbSurxwuGt2GBfAca` registered its id and made the plain `ft_transfer`, the sweep was `DPngLpZB8cGBC9Vs8kk7STyTwdC5kVXCF1VntjgR9dVR` (0.92 / 0.08 tUSDC).

4. Contract integrity: `shasum -a 256 contract/res/v3.3/zeroinit_invoice.wasm` → `b03c1b08a2b45b9f87163c9b9412e081a221fbb06b229dae26deecc416512a8e` (170,344 bytes). That digest,
   read as base58, is the code hash `CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb`; `zi verify` checks that the invoice account's on-chain `global_contract_hash` equals it, and the
   on-chain bytes (`view_global_contract_code`) equal the committed file (`test/wasm-files.test.ts` checks the file-to-hash step offline). This proves the committed wasm *is* the
   deployed code; that it is built from this source is [REPRODUCE.md](REPRODUCE.md).

5. Keys: the RPC call in [LIMITS.md "Who holds keys"](LIMITS.md#who-holds-keys) lists the keys of any account; an invoice account answers `"keys":[]`.

## All claims

| Claim | Command | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in; without `--offline` it also checks over RPC that merchant and tax vault exist) | `INVOICE` / `ACCOUNT` / `PAY` / `FILE` lines; no RPC call (it works with the network off) |
| The address commits to the terms and the code | `npm run zi -- verify INV-1111-V33-A --offline` | `PASS code-hash-trusted CrwuvfSL…`, `INFO deployment v3.3 (current…`, `PASS id-from-terms 0us40y0d…421ag`, `PASS raw-from-terms`, `PASS doc-fields-from-terms` |
| One transaction creates the account, pays and splits (NEAR) | `npm run zi -- replay fixtures/v33/demo-run.json` (or the nearblocks link above) | `PASS pay-tx-success INV-1111-V33-A GFzvAw8t… []`, `PASS split-merchant INV-1111-V33-A 0.92`, `PASS split-vault INV-1111-V33-A 0.08`, `PASS invoice-paid-after-callback INV-1111-V33-A` |
| Plain transfers are safe before the account exists | `npm run zi -- replay fixtures/v33/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-V33-B 1`, `PASS sweep-tx-result INV-1111-V33-B 2j8vbU6k… result=PAID` |
| A token invoice (tUSDC, a testnet mock) is paid by a plain `ft_transfer` and swept by anyone | `npm run zi -- replay fixtures/v33/token-demo-run.json` | `PASS ft-parked-balance TOK-1111-V33-A 1`, `PASS ft-split-merchant TOK-1111-V33-A 0.92`, `PASS ft-split-vault TOK-1111-V33-A 0.08` |
| A payment on top of parked funds is charged once (NEAR and tokens); a settlement that used parked funds records no payer | `npm run zi -- replay fixtures/v33/parked.json` | `PASS pay-parked-applied PARK-V33-N …`, `PASS ft-parked-applied PARK-V33-T …`, `PASS paid-by-signer PARK-V33-N payer null, …`, `PASS single-invoice-paid PARK-V33-T 1 invoice_paid event(s) in the recording` |
| The client registers the token id in the same transaction as the payment, and only the contract itself can call `on_pay_balance` | `npm run zi -- replay fixtures/v33/tokens.json` | `PASS pay-tx-success TOK-V33-B Gn9eax3j… []`, `PASS settled-covers-price TOK-V33-B 1 of 1 via pay`, `PASS private-callback-refused TOK-V33-B E19huFfX… refused` |
| A token `sweep` that races an in-flight `ft_transfer_call` plans nothing, whatever the rejection reason (only the `busy` reason on v3.1; every reason since v3.2) | `npm run zi -- replay fixtures/v33/race.json` (`bad_msg`, v3.3) and `npm run zi -- replay fixtures/v31/race.json` (`busy`, v3.1) | `PASS sweep-tx-result RACE-V33-2 DCpUvQYn… result=CONCURRENT_PAYMENT`, `PASS concurrent-payment-plans-nothing RACE-V33-2 0 payout(s), 0 event(s), 0 failure(s)`, `PASS ft-rejected-bad_msg RACE-V33-2 used 0, 1000000 of 1000000 returned …`, then the retry settles (`PASS ft-split-merchant RACE-V33-2 0.92`). One run each, not a rate: the block alignment is chance |
| Two token payments at the same moment are both returned in full; a retry then pays once | `npm run zi -- replay fixtures/v33/two-payments.json` | two `PASS ft-rejected-busy TWO-V33-2 used 0, 1000000 of 1000000 returned …` lines (payer and sweeper), then `PASS single-invoice-paid TWO-V33-2 1 invoice_paid event(s) in the recording`. One run |
| Nobody holds keys to **invoice** accounts (other accounts do: [LIMITS.md "Who holds keys"](LIMITS.md#who-holds-keys)) | `npm run zi -- verify INV-1111-V33-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| The deployed code is the committed wasm, and the reproducible build of commit `7727a1c` produces it | `shasum -a 256 contract/res/v3.3/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-V33-A`; the rebuild: [REPRODUCE.md](REPRODUCE.md) | digest `b03c1b08…2a8e` = base58 `CrwuvfSL…aVsb`; `PASS code-hash-onchain` |
| The check code catches a mistyped address (for a payer who checks) | `npm run zi -- check 0us40y0dm1767jkzzxynmwjer15h4xy5wc96rg3xv5hfgs8fx421ag MVNC`, then the same with another code | `PASS check-code 0us40y0d…`; with a wrong code `FAIL check-code …: the code does not match this address; do not send funds to it`, exit 1 |

More claims, checked on the v3 and v3.1 recordings (late merchant, token rejections, owed and refunded payouts, taxed partial parks, refunds on `pay()`) and the v2/v1 fixes:
[HISTORY.md "Older claims and how to verify them"](HISTORY.md#older-claims-and-how-to-verify-them).
