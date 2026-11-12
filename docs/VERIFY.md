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

2. `npm test` → 242 tests, all pass: byte vectors from nearcore 2.14 and the frozen examples, units, deployments, `/1` and `/2` invoice documents, encoder parity with
   near-api-js 7.4.0, outcome/replay/CLI/dashboard/MCP tests, and the recorded fixtures of every version, each with tamper tests.

   ```
   # tests 242
   # pass 242
   # fail 0
   # skipped 0
   ```

3. `npm run zi -- vectors` → 8 lines, all `PASS` (`crockford-kat-1..4`, `wallet-0u`, `wallet-0s`, `example-0u`, `example-0s`).

4. `npm run zi -- replay fixtures/v32r/demo-run.json` → the NEAR demo recorded live on the current contract (invoice ids `INV-1111-V32R-A/B/C`, 1 NEAR each): 62 `PASS`, 0 `FAIL`, exit 0. Among them:

   ```
   INFO deployment v3.2r (current, deployed on testnet: the v3.2 source built reproducibly, rebuild commit 4116e69) BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry
   PASS before-unknown-account INV-1111-V32R-A NONEXISTENT
   PASS pay-tx-success INV-1111-V32R-A GwnQFSjpCqcPZeSHiTmiu6t5ZMkhM6NQ8vh4NjDzDpWE []
   PASS invoice-paid-after-callback INV-1111-V32R-A
   PASS split-merchant INV-1111-V32R-A 0.92
   PASS split-vault INV-1111-V32R-A 0.08
   PASS transfer-path-uninitialized INV-1111-V32R-B 1
   PASS sweep-tx-result INV-1111-V32R-B DKFQDCKQ6xNK1PeRHPDf372nj6zMJ9cPhPxYkLeCroXv result=PAID
   ```

   `INV-1111-V32R-A` is paid by one transaction; `INV-1111-V32R-B` by a plain transfer and a later sweep; `INV-1111-V32R-C` is an underpayment that is refunded.

5. `npm run zi -- replay fixtures/v32r/token-demo-run.json` → a **tUSDC** invoice (a testnet mock token), 31 `PASS`. The payer first registers the invoice id on the token
   (one `storage_deposit` transaction, 0.00125 NEAR; an exchange would not do this, so for tokens someone must), then sends a plain `ft_transfer` (the part an exchange does),
   then anyone sweeps it in one transaction (state init + fund + sweep):

   ```
   PASS register-tx-success TOK-1111-V32R-A 8yXZ9S7TLX5dF5ih6wbjHALN982GwiJcqPjPxSNMaHzW []
   PASS plain-transfer-tx-success TOK-1111-V32R-A 9TJ3YwAt8XQX12BC36hP9yzGyUj3jPb7qRB7uCGbjWWG []
   PASS ft-parked-balance TOK-1111-V32R-A 1
   PASS sweep-tx-result TOK-1111-V32R-A EmQYXvDFSsTX3ekgP3QLUxPVQW4TvLmhT5VVA8uvx4Q2 result=PAID
   PASS ft-split-merchant TOK-1111-V32R-A 0.92
   PASS ft-split-vault TOK-1111-V32R-A 0.08
   ```

6. `npm run zi -- replay fixtures/v32r/race.json` → the **race on the `bad_msg` rejection path**, 46 `PASS`: a token sweep sent in the same moment as an `ft_transfer_call`
   with a wrong `msg`. The sweep plans nothing, the token returns the payment whole, and the payer's retry settles
   (background: [HISTORY.md "v3.1 → v3.2"](HISTORY.md#v31--v32)):

   ```
   PASS sweep-tx-result RACE-V32R-1 mRNSLvycnnRCHh626BkMgUQTxvvqMdnBP3ns46hecDB result=CONCURRENT_PAYMENT
   PASS concurrent-payment-plans-nothing RACE-V32R-1 0 payout(s), 0 event(s), 0 failure(s)
   PASS ft-rejected-bad_msg RACE-V32R-1 used 0, 1000000 of 1000000 returned to sm1110-zi3-payer.testnet
   PASS ft-split-merchant RACE-V32R-1 0.92
   ```

7. `npm run zi -- replay fixtures/v32r/tokens.json` → the one-step token path, 45 `PASS`: `zi init`, one `ft_transfer_call` that settles, and a second one that is returned (`not_open`).

**The whole path in one command:** `bash scripts/judge-offline.sh` runs `npm ci --include=dev`, `npm test`, `vectors`, the four v3.2r replays, the four v3.2 replays, the five v3.1 replays,
the seven v3 replays, the three v2 replays, the two v1 replays and an offline `verify` of every invoice document in `invoices/v32r`, `v32`, `v31`, `v3`, `v2` and `v1`.
It stops at the first failure; its last line is `JUDGE-OFFLINE: ALL PASS`. The older recordings replay under their own code hashes: [HISTORY.md "Replaying the earlier recordings"](HISTORY.md#replaying-the-earlier-recordings).

## Live read-only checks

The invoices under `invoices/v32r/` were paid on testnet (protocol 88) on 2026-11-12. These commands only read RPC and work from a clean clone.
The default endpoint is `https://rpc.testnet.fastnear.com`; set `ZI_RPC_URL` to use another one (`https://rpc.testnet.near.org` answers HTTP 429 "endpoint is deprecated").

**The default RPC is not archival.** It keeps about 1.5 days of transactions, so a transaction lookup there fails with `UNKNOWN_TRANSACTION` once the transaction is older
than that (every transaction in this repo was sent between 2026-11-09 and 2026-11-12). State-based checks keep working (`zi verify`, `zi status`, `view_global_contract_code`),
and so does every offline replay. For a transaction lookup use the archival endpoint `https://archival-rpc.testnet.fastnear.com` (set `ZI_ARCHIVAL_RPC_URL`;
`zi receipt --tx <hash>` falls back to it by itself on the default RPC) or nearblocks. The recorded fixtures under `fixtures/` are the durable evidence.

1. `npm run zi -- verify INV-1111-V32R-A` → the address and the state-init bytes are recomputed from the terms and the pinned code hash (`ZI_CODE_HASH`, default v3.2r
   `BQLSk5ca…zCFry`, never the invoice file's own `code_hash`), then compared with the chain. Any `FAIL` makes the command exit 1. Output, exit 0:

   ```
   PASS code-hash-trusted BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry
   INFO deployment v3.2r (current, deployed on testnet: the v3.2 source built reproducibly, rebuild commit 4116e69)
   PASS format-matches-deployment zeroinit-invoice/2
   PASS id-from-terms 0u7hdnprw7z1gfz4b6qj8pn683cnhwp4ges18hfbsk03nmdees4ppg
   PASS raw-from-terms
   PASS doc-fields-from-terms
   PASS code-hash-onchain BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry
   PASS terms-onchain
   PASS no-access-keys
   INFO status=PAID
   ```

   `npm run zi -- verify TOK-1111-V32R-A` does the same for the tUSDC invoice and adds `PASS token-allowed tUSDC sm1110-tusdc.testnet`, `PASS token-metadata-onchain tUSDC 6`
   and `INFO token-balance 0 tUSDC`. `verify` of an older invoice (`INV-1111-V2-A`, `INV-1111-A`) checks it against its own historical hash; `zi pay`, `zi sweep` and `zi init` refuse historical invoices.

2. Open <https://testnet.nearblocks.io/txns/GwnQFSjpCqcPZeSHiTmiu6t5ZMkhM6NQ8vh4NjDzDpWE> → one transaction with exactly two actions, `UniversalStateInit` + `pay`,
   receiver `0u7hdnprw7z1gfz4b6qj8pn683cnhwp4ges18hfbsk03nmdees4ppg`, result `PAID`, transfers of 0.92 NEAR to `sm1110-zi3-sweeper.testnet` (the merchant in the demo) and
   0.08 NEAR to `sm1110-zi3-taxvault.testnet`, and `invoice_paid` logged by the `on_settled` callback. If nearblocks renders `0u…` ids poorly, the RPC `tx` method on the
   archival endpoint returns the same JSON, and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-V32R-B` → the invoice that was paid by a plain transfer (no state init) and swept later:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=400
   ```

   Plain-transfer tx `8vg2gkVxnYpKMqf75gTVx4eCXRqMn46edWz27BNNmPFL`, sweep tx `DKFQDCKQ6xNK1PeRHPDf372nj6zMJ9cPhPxYkLeCroXv`. `paid_by=null` is expected on this path:
   `sweep()` does not know who transferred the funds. `npm run zi -- status TOK-1111-V32R-A` shows the tUSDC one (`status=PAID`, `tokens=0 tUSDC`, nothing owed); its register tx is
   `8yXZ9S7TLX5dF5ih6wbjHALN982GwiJcqPjPxSNMaHzW`, its plain `ft_transfer` `9TJ3YwAt8XQX12BC36hP9yzGyUj3jPb7qRB7uCGbjWWG`, the sweep `EmQYXvDFSsTX3ekgP3QLUxPVQW4TvLmhT5VVA8uvx4Q2` (0.92 / 0.08 tUSDC).

4. Contract integrity: `shasum -a 256 contract/res/v3.2r/zeroinit_invoice.wasm` → `9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92` (163,788 bytes). That digest,
   read as base58, is the code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`; `zi verify` checks that the invoice account's on-chain `global_contract_hash` equals it, and the
   on-chain bytes (`view_global_contract_code`) equal the committed file (`test/wasm-files.test.ts` checks the file-to-hash step offline). This proves the committed wasm *is* the
   deployed code; that it is built from this source is [REPRODUCE.md](REPRODUCE.md).

5. Keys: the RPC call in [LIMITS.md "Who holds keys"](LIMITS.md#who-holds-keys) lists the keys of any account; an invoice account answers `"keys":[]`.

## All claims

| Claim | Command | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in; without `--offline` it also checks over RPC that merchant and tax vault exist) | `INVOICE` / `ACCOUNT` / `PAY` / `FILE` lines; no RPC call (it works with the network off) |
| The address commits to the terms and the code | `npm run zi -- verify INV-1111-V32R-A --offline` | `PASS code-hash-trusted BQLSk5ca…`, `INFO deployment v3.2r (current…`, `PASS id-from-terms 0u7hdnpr…4ppg`, `PASS raw-from-terms`, `PASS doc-fields-from-terms` |
| One transaction creates the account, pays and splits (NEAR) | `npm run zi -- replay fixtures/v32r/demo-run.json` (or the nearblocks link above) | `PASS pay-tx-success INV-1111-V32R-A GwnQFSjp… []`, `PASS split-merchant INV-1111-V32R-A 0.92`, `PASS split-vault INV-1111-V32R-A 0.08`, `PASS invoice-paid-after-callback INV-1111-V32R-A` |
| Plain transfers are safe before the account exists | `npm run zi -- replay fixtures/v32r/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-V32R-B 1`, `PASS sweep-tx-result INV-1111-V32R-B DKFQDCKQ… result=PAID` |
| A token invoice (tUSDC, a testnet mock) is paid by a plain `ft_transfer` and swept by anyone | `npm run zi -- replay fixtures/v32r/token-demo-run.json` | `PASS ft-parked-balance TOK-1111-V32R-A 1`, `PASS ft-split-merchant TOK-1111-V32R-A 0.92`, `PASS ft-split-vault TOK-1111-V32R-A 0.08` |
| A token `sweep` that races an in-flight `ft_transfer_call` plans nothing, whatever the rejection reason (only the `busy` reason on v3.1; every reason since v3.2) | `npm run zi -- replay fixtures/v32r/race.json` (`bad_msg`, v3.2r) and `npm run zi -- replay fixtures/v31/race.json` (`busy`, v3.1) | `PASS sweep-tx-result RACE-V32R-1 mRNSLvyc… result=CONCURRENT_PAYMENT`, `PASS concurrent-payment-plans-nothing RACE-V32R-1 0 payout(s), 0 event(s), 0 failure(s)`, `PASS ft-rejected-bad_msg RACE-V32R-1 used 0, 1000000 of 1000000 returned …`, then the retry settles (`PASS ft-split-merchant RACE-V32R-1 0.92`). One run each, not a rate: the block alignment is chance |
| Nobody holds keys to **invoice** accounts (other accounts do: [LIMITS.md "Who holds keys"](LIMITS.md#who-holds-keys)) | `npm run zi -- verify INV-1111-V32R-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| The deployed code is the committed wasm, and the reproducible build of commit `4116e69` produces it | `shasum -a 256 contract/res/v3.2r/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-V32R-A`; the rebuild: [REPRODUCE.md](REPRODUCE.md) | digest `9a8f368d…5b92` = base58 `BQLSk5ca…zCFry`; `PASS code-hash-onchain` |
| A one-step token payment on top of tokens already parked on the invoice is refused by the client (the contract would charge twice: [LIMITS.md](LIMITS.md#token-invoices)) | `node --test test/cli-token.test.ts test/server-token.test.ts` | the tests "pay token refuses when tokens are already parked" and "token pay is refused (409, nothing sent) while tokens are parked" pass; `zi pay` prints ``already holds 1.5 tUSDC from a plain transfer: run `zi sweep <id>` instead of paying again``, exits 2 and signs nothing |

More claims, checked on the v3 and v3.1 recordings (late merchant, token rejections, owed and refunded payouts, taxed partial parks, refunds on `pay()`) and the v2/v1 fixes:
[HISTORY.md "Older claims and how to verify them"](HISTORY.md#older-claims-and-how-to-verify-them).
