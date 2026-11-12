<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/logo-dark.png">
  <img alt="ZeroInit" src="docs/img/logo-light.png" width="320">
</picture>

### Invoice addresses that cost nothing until they are paid.

Every invoice gets its own NEAR address, and issuing it needs no transaction.<br>
**[zeroinit.vercel.app](https://zeroinit.vercel.app)** · NEAR **testnet only** · mock token only · MIT

[![live](https://img.shields.io/badge/live-zeroinit.vercel.app-111110?style=flat-square)](https://zeroinit.vercel.app)
[![network](https://img.shields.io/badge/network-NEAR%20testnet%20only-555?style=flat-square)](#limits-honest)
[![tests](https://github.com/erhantrk/zeroinit/actions/workflows/tests.yml/badge.svg)](https://github.com/erhantrk/zeroinit/actions/workflows/tests.yml)
[![license](https://img.shields.io/badge/license-MIT-555?style=flat-square)](LICENSE)

[Try it](#try-it-offline-in-2-minutes) · [What NEAR does](#what-near-does-here) · [Judge path](#offline-judge-path-do-x-see-y) · [Live claims](#check-the-live-testnet-claims-read-only-no-keys) · [How it works](#how-it-works) · [Limits](#limits-honest) · [AI use](#ai-use-disclosure)

</div>

---

**Every invoice gets its own NEAR address, and issuing it needs no transaction.** The payer's one transaction creates the account, pays the merchant and sets the tax aside (92/8 in the demo). Nobody ever holds a key to that account.

NEAR HACKATHON 2026 · Tracks (proposed, confirmed at submission): **Open Innovation** (primary), **Real-World Money** · Testnet only, mock token only, not audited, written with AI help (["AI use disclosure"](#ai-use-disclosure)).
Also by the same submitter: [ProvenExit](https://github.com/erhantrk/provenexit) (hackathon rule Q-015). Site: <https://zeroinit.vercel.app>.

![ZeroInit local dashboard: invoice list with PAID badges and the payer panel with the "Pay (one transaction)" button](docs/img/dashboard-pay.png)
*Real browser screenshot of the local dashboard, v2 build, 2026-11-10 (the v3.2 dashboard has not been opened in a browser; see `docs/img/README.md`).*

Demo video: (link added at submission)

## Try it offline in 2 minutes

No keys, no network after install (`npm ci` needs the npm registry once; Node 22). Each step is also run, with its expected output, in ["Offline judge path"](#offline-judge-path-do-x-see-y).

```bash
npm ci --include=dev
npm test                                              # 226 tests, all pass
npm run zi -- replay fixtures/v32r/demo-run.json       # a recorded live testnet run: every line PASS, exit 0
```

You should see `PASS split-merchant INV-1111-V32R-A 0.92` and `PASS split-vault INV-1111-V32R-A 0.08`. The whole offline check in one command: `bash scripts/judge-offline.sh` (last line `JUDGE-OFFLINE: ALL PASS`).

- **226** offline tests pass, plus **94** Rust unit tests on the contract.
- **1** transaction creates the invoice account, pays and splits the money.
- **0** access keys on an invoice account (`zi verify` prints `PASS no-access-keys`).
- **0.0075612 NEAR**: measured cost of that one transaction to the payer on the deployed contract (v3.2r; gas plus account creation).
- **1** reproducible build: the deployed code (`BQLSk5ca…`) is the wasm that `cargo near build reproducible-wasm` produces at commit `4116e69` ("Is the wasm built from the source?").

## What NEAR does here

NEAR protocol 88 (universal accounts, NEP-655) lets an account id be the SHA3-256 hash of its future code and state, so the invoice address can be printed before the account exists. One transaction carries a `UniversalStateInit` and a `FunctionCall`: it creates the account, runs the contract and splits the payment. A plain transfer to the address also works for NEAR invoices: the money waits in the "uninitialized" account, which only its matching state init can unlock, until anyone calls `sweep`. The invoice code is a global contract deployed once, by hash; each invoice only references it.

One honest clause: **token (NEP-141) invoices need one `storage_deposit` registration of the `0u` id on the token (0.00125 NEAR, sent by the merchant, the payer or anyone) before a wallet or exchange can `ft_transfer` to it**. Issuing is still free; whoever registers the id pays that one small transaction.
The contract deployed on testnet is **v3.2r** (code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`: the v3.2 source built reproducibly); v1 to v3.2 are history ([`docs/HISTORY.md`](docs/HISTORY.md)). The mock token's source is [test-usdc](https://github.com/erhantrk/test-usdc) (private until submission).

## Offline judge path (do X, see Y)

Every command below was run in this checkout, with no `.env` (`npm ci --include=dev` needs the npm registry once).

1. `npm ci --include=dev` → installs the 3 runtime packages (`@noble/hashes`, `@noble/curves`, `@scure/base`) plus
   `near-api-js` 7.4.0 for one encoder-parity test. The flag matters: with `NODE_ENV=production` a plain `npm ci`
   skips devDependencies and the parity test cannot import `near-api-js`.

2. `npm test` → 226 tests, all pass (byte vectors from nearcore 2.14 and the frozen examples, units, deployments, `/1` and `/2` documents, encoder parity with near-api-js 7.4.0,
   outcome/replay/CLI/dashboard tests, the recorded fixtures of every version, each with tamper tests):

   ```
   # tests 226
   # pass 226
   # fail 0
   # skipped 0
   ```

3. `npm run zi -- vectors` → 8 lines, all `PASS` (`crockford-kat-1..4`, `wallet-0u`, `wallet-0s`, `example-0u`, `example-0s`).

4. `npm run zi -- replay fixtures/v32r/demo-run.json` → the **v3.2r** NEAR demo, recorded live on the current contract (invoice ids `INV-1111-V32R-A/B/C`, 1 NEAR), all
   `PASS`, exit 0; among the checks:

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

5. `npm run zi -- replay fixtures/v32r/token-demo-run.json` → a **tUSDC** invoice (mock token): the payer first **registers the invoice id on the token** (one `storage_deposit` transaction, 0.00125 NEAR; an exchange
   would not do this, so for tokens someone must), then sends a plain `ft_transfer` (the part an exchange does), then anyone sweeps it in one transaction (state init + fund + sweep):

   ```
   PASS register-tx-success TOK-1111-V32R-A 8yXZ9S7TLX5dF5ih6wbjHALN982GwiJcqPjPxSNMaHzW []
   PASS plain-transfer-tx-success TOK-1111-V32R-A 9TJ3YwAt8XQX12BC36hP9yzGyUj3jPb7qRB7uCGbjWWG []
   PASS ft-parked-balance TOK-1111-V32R-A 1
   PASS sweep-tx-result TOK-1111-V32R-A EmQYXvDFSsTX3ekgP3QLUxPVQW4TvLmhT5VVA8uvx4Q2 result=PAID
   PASS ft-split-merchant TOK-1111-V32R-A 0.92
   PASS ft-split-vault TOK-1111-V32R-A 0.08
   ```

   `npm run zi -- replay fixtures/v32r/race.json` is the **race on the `bad_msg` rejection path** (a token sweep while an `ft_transfer_call` with a wrong `msg` is in flight, the path v3.1 did not cover; details in `docs/HISTORY.md` "v3.1 → v3.2"):

   ```
   PASS sweep-tx-result RACE-V32R-1 mRNSLvycnnRCHh626BkMgUQTxvvqMdnBP3ns46hecDB result=CONCURRENT_PAYMENT
   PASS concurrent-payment-plans-nothing RACE-V32R-1 0 payout(s), 0 event(s), 0 failure(s)
   PASS ft-rejected-bad_msg RACE-V32R-1 used 0, 1000000 of 1000000 returned to sm1110-zi3-payer.testnet
   ```

   The other v3.2r recording, `tokens.json`, is the one-step path (init, one `ft_transfer_call` that settles, a second one that is returned). The v3.1 recordings (the busy-rejection race `fixtures/v31/race.json`, `late.json`, …), and the v3, v2 and v1 recordings replay
   under their own hashes: `docs/HISTORY.md` "Replaying the earlier recordings".

One command for the whole judge path: `bash scripts/judge-offline.sh` → `npm ci --include=dev`, `npm test`, `vectors`, the four v3.2r replays, the four v3.2 replays (history), the five v3.1 replays, the seven v3 replays, the three
v2 replays, the two v1 replays and an offline `verify` of every v3.2r, v3.2, v3.1, v3, v2 and v1 invoice; its last line is `JUDGE-OFFLINE: ALL PASS`. (The judge-offline run in our sandbox mapped
`npm run -s zi --` to `node src/cli.ts`, because `npm run` printed none of the CLI output there.)

## Check the live testnet claims (read-only, no keys)

The invoices under `invoices/v32r/` (current contract v3.2r, NEAR and tUSDC; `invoices/v32/` is the same source, v3.2, history) and the older folders were paid on testnet (protocol 88). These commands only read RPC; they work from a clean clone with no `.env`.
The default endpoint is `https://rpc.testnet.fastnear.com` (`https://rpc.testnet.near.org` started answering HTTP 429 "endpoint is deprecated" on 2026-11-10; set `ZI_RPC_URL` to use another one).

**The default RPC is not archival.** It keeps about 1.5 days of transactions (its `status` reported `earliest_block_time` 2026-11-10T01:01Z on 2026-11-11): the v1 deploy tx `DSXd2Sjq…` is already `UNKNOWN_TRANSACTION` there, and every
transaction cited in this repo (all sent 2026-11-10) will be too before judging starts (2026-11-16). **State-based checks keep working** (`zi verify`, `zi status`, `view_global_contract_code`, below), and so does every offline replay.
For a transaction lookup use the archival endpoint, `ZI_ARCHIVAL_RPC_URL=https://archival-rpc.testnet.fastnear.com` (a `curl` of `tx` / `EXPERIMENTAL_tx_status` there; `zi receipt --tx <hash>` falls back to it by itself
on the default RPC), or nearblocks; the recorded fixtures under `fixtures/` are the durable evidence.

1. `npm run zi -- verify INV-1111-V32R-A` → the address and the state-init bytes are recomputed from the terms and the pinned code hash (`ZI_CODE_HASH`, default v3.2r
   `BQLSk5ca…zCFry`, never the invoice file's own `code_hash`), then compared with the chain. It also says which deployment the invoice uses. Any `FAIL` makes the command exit 1
   (run on 2026-11-12 for the invoices recorded on v3.2r, `invoices/v32r/`: exit 0, no `FAIL`; the earlier v3.2 invoices, `invoices/v32/`, verify offline under their own hash):

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

   `npm run zi -- verify TOK-1111-V32R-A` does the same for the tUSDC invoice and adds `PASS token-allowed tUSDC sm1110-tusdc.testnet` and `PASS token-metadata-onchain tUSDC 6`. `verify` of a v2 or v1 invoice
   (`INV-1111-V2-A`, `INV-1111-A`) checks it against its own historical hash; `zi pay`, `zi sweep` and `zi init` refuse historical invoices.

2. Open `https://testnet.nearblocks.io/txns/GwnQFSjpCqcPZeSHiTmiu6t5ZMkhM6NQ8vh4NjDzDpWE` → one transaction with exactly two actions, `UniversalStateInit` + `pay`,
   receiver `0u7hdnprw7z1gfz4b6qj8pn683cnhwp4ges18hfbsk03nmdees4ppg`, result `PAID`, and transfers of `0.92` NEAR to `sm1110-zi3-sweeper.testnet` (the merchant in the demo) and
   `0.08` NEAR to `sm1110-zi3-taxvault.testnet`, with `invoice_paid` logged by the `on_settled` callback. If nearblocks renders `0u…` ids poorly, the RPC `tx` method on the **archival** endpoint returns the same JSON
   while it is still on the default one, and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-V32R-B` → the invoice that was paid by a plain transfer (no state init) and later swept:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=399
   ```

   Plain-transfer tx `8vg2gkVxnYpKMqf75gTVx4eCXRqMn46edWz27BNNmPFL`; sweep tx `DKFQDCKQ6xNK1PeRHPDf372nj6zMJ9cPhPxYkLeCroXv`. `paid_by=null` is expected on this path:
   `sweep()` does not know who transferred the funds. `npm run zi -- status TOK-1111-V32R-A` shows the tUSDC one; its register tx is `8yXZ9S7TLX5dF5ih6wbjHALN982GwiJcqPjPxSNMaHzW`, its plain `ft_transfer` `9TJ3YwAt8XQX12BC36hP9yzGyUj3jPb7qRB7uCGbjWWG`, the sweep `EmQYXvDFSsTX3ekgP3QLUxPVQW4TvLmhT5VVA8uvx4Q2` (0.92 / 0.08 tUSDC).

4. Contract integrity: `shasum -a 256 contract/res/v3.2r/zeroinit_invoice.wasm` → `9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92` (163,788 bytes). That digest
   is the base58 code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`; `zi verify` checks that the invoice account's on-chain `global_contract_hash` equals it, and the on-chain bytes (`view_global_contract_code`) equal the committed
   file. That proves the committed wasm *is* the deployed code; which source it was built from is a separate check ("Is the wasm built from the source?", below). The previous v3.2 wasm is `contract/res/v3.2/zeroinit_invoice.wasm` (sha256 `016bf5ba…5e63d`, 164,040 bytes, base58 `6YtW5oJ8…vMCNHJ`; history). Older deploy txs and burns: `docs/HISTORY.md` "Deploy transactions and burns".

## Claims and how to verify each

| Claim | Verify with | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in, so no `.env` is needed; without `--offline` it also checks over RPC that merchant and tax vault exist on testnet) | `INVOICE`/`ACCOUNT`/`PAY`/`FILE` lines; no RPC call |
| The address commits to the terms and code | `npm run zi -- verify INV-1111-V32R-A --offline` | `PASS code-hash-trusted BQLSk5ca…`, `INFO deployment v3.2r (current…`, `PASS id-from-terms 0u7hdnpr…4ppg`, `PASS raw-from-terms` |
| One tx creates + pays + splits (NEAR) | `npm run zi -- replay fixtures/v32r/demo-run.json` (or the nearblocks link in "Check the live testnet claims") | `PASS pay-tx-success INV-1111-V32R-A GwnQFSjp… []`, `PASS split-merchant INV-1111-V32R-A 0.92`, `PASS split-vault INV-1111-V32R-A 0.08`, `PASS invoice-paid-after-callback INV-1111-V32R-A` |
| Plain transfers are safe before init | `npm run zi -- replay fixtures/v32r/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-V32R-B 1`, `PASS sweep-tx-result INV-1111-V32R-B DKFQDCKQ… result=PAID` |
| A stablecoin invoice (tUSDC, a testnet mock) is paid by a plain `ft_transfer` and swept by anyone | `npm run zi -- replay fixtures/v32r/token-demo-run.json` | `PASS ft-parked-balance TOK-1111-V32R-A 1`, `PASS ft-split-merchant TOK-1111-V32R-A 0.92`, `PASS ft-split-vault TOK-1111-V32R-A 0.08` |
| A token `sweep` that races an in-flight `ft_transfer_call` plans nothing, whatever the rejection reason (F1 busy: v3.1; every reason: v3.2 and v3.2r) | `npm run zi -- replay fixtures/v32r/race.json` (bad_msg, v3.2r) and `fixtures/v31/race.json` (busy, v3.1) | `PASS sweep-tx-result RACE-V32R-1 mRNSLvyc… result=CONCURRENT_PAYMENT`, `PASS concurrent-payment-plans-nothing RACE-V32R-1 0 payout(s), 0 event(s), 0 failure(s)`, `PASS ft-rejected-bad_msg RACE-V32R-1 used 0, 1000000 of 1000000 returned …`, then the retry settles (`PASS ft-split-merchant RACE-V32R-1 0.92`). One run each, not a rate: the block alignment is chance |
| Nobody holds keys to **invoice** accounts (other accounts do hold keys: see "Who holds keys") | `npm run zi -- verify INV-1111-V32R-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| The deployed code is the committed wasm (and it is rebuilt from this tree's source by the pinned reproducible build: see "Is the wasm built from the source?") | `shasum -a 256 contract/res/v3.2r/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-V32R-A` | digest `9a8f368d…5b92` = base58 `BQLSk5ca…zCFry`; `PASS code-hash-onchain` |
| A one-step token payment on top of parked tokens is refused by the client (a contract limit, see Limits) | `node --test test/cli-token.test.ts test/server-token.test.ts` | the `claims-3` tests pass; `zi pay` prints `run \`zi sweep\` instead` |

More claims, checked on the v3 and v3.1 recordings (late merchant, token rejections, owed and refunded payouts, taxed partial parks, refunds on `pay()`) and the v2/v1 fixes: `docs/HISTORY.md` "Older claims and how to verify them".

## Status of the deployed contract and what is not done (2026-11-12)

The contract **deployed on testnet and used by the client is v3.2r**: code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry` (wasm sha256 `9a8f368d…5b92`, 163,788 bytes), published as a global contract by hash in tx
`DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs` from `sm1110-zi-deployer.testnet` (funded by three transfers from the retired v2 accounts; we did not compute a deploy burn for it). v3.2r is the **same source as v3.2**
(v3.1 plus the audit's contract fixes, `docs/HISTORY.md` "v3.1 → v3.2"), built reproducibly. It handles NEAR and
**tUSDC, a testnet mock token** (`sm1110-tusdc.testnet`, no value, no issuer), with a `SETTLING` status, an owed ledger and a payout lock. It was run live on testnet on 2026-11-12 (NEAR pay, plain transfer + sweep,
underpay, tUSDC plain `ft_transfer` + sweep, one-step `ft_transfer_call`, and the sweep-vs-`ft_transfer_call` race on the `bad_msg` rejection path) and every run is a fixture that replays offline
(`fixtures/v32r/`, transactions in `docs/SPIKES.md` "Contract v3.2r live"). **v3.2** (`6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ`, a non-reproducible build, 164,040 bytes, deploy tx `GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg`) and the older versions (v3.1, v3, v2, v1) stay on testnet
as recorded history and keep replaying: `docs/HISTORY.md`.

**The v3.2 source is what is deployed, and the wasm can be rebuilt from it.** `contract/res/v3.2r/zeroinit_invoice.wasm` is the output of `cargo near build reproducible-wasm` at commit `4116e69`; its sha256 equals the digest above, and its bytes were
compared on 2026-11-12 with the on-chain `view_global_contract_code` bytes of that hash (identical). The race on the `busy` rejection was already closed on chain by v3.1; v3.2 closes it for every rejection reason, and
that one path was produced on testnet once on v3.2 and once more on v3.2r (`fixtures/v32/race.json`, `fixtures/v32r/race.json`). The other v3.2 fixes (an `OPEN` invoice past its expiry released by one `sweep`, `paid_at_ms == 0` as "never settled", success decided from the promise status only) are covered by Rust unit tests and were **not run live**.

Not done: a browser walk-through of the v3.2r dashboard, wallet checks, anything on mainnet, a live run of the `expired` / `not_open` race variants and of the other v3.2 fixes, an independent audit (the audit rounds were AI reviews, see "AI use disclosure"), and an independent third-party rebuild
(we did the rebuild ourselves; nobody else has reported one for v3.2r).
`docs/STABLECOIN.md` is the interface spec ("Live results" sections say what the runs showed).

### Is the wasm built from the source?

**Yes for the current deployment (v3.2r), and you can check it yourself.** `contract/Cargo.toml` has a pinned `[package.metadata.near.reproducible_build]` (image `sourcescan/cargo-near:0.23.0-rust-1.99.1`, pinned by digest `sha256:8013f039…2fcc`). To check:

```bash
git checkout 4116e69          # the build commit; the build records its commit in the contract metadata, see below
cd contract && cargo near build reproducible-wasm     # needs Docker and cargo-near
shasum -a 256 target/near/zeroinit_invoice.wasm       # 9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92, 163,788 bytes
```

The digest, read as base58, is the code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`; compare it with `contract/res/v3.2r/zeroinit_invoice.wasm` and with the code hash `zi verify` prints. **Say it plainly:** the reproducible build records its commit in the contract metadata,
so a build from a *later* commit gives a different wasm and a different hash, even if `contract/src` did not change. Only commit `4116e69` reproduces `BQLSk5ca…`. We ran this build ourselves (once, 2026-11-12, producing the committed file);
we have not had an independent party repeat it.

- **v3.2** (`6YtW5oJ8…vMCNHJ`, history): the committed wasm `contract/res/v3.2/zeroinit_invoice.wasm` equals the on-chain bytes (checked on 2026-11-11), but it was a local non-reproducible build, so that it was built from this tree's `contract/src` rests on trust in the operator's local build.
  v3.2r is the same source built reproducibly (the unit tests and all recorded runs behave the same, see `test/live-v32r.test.ts`, whose pinned check names are identical to v3.2's); we did not diff the two wasm files semantically. (Older wasm builds are in git history; v3.1 was built from commit `d1c185a`.)
- **v1 to v3.1:** no reproducible build. `contract-v2/Cargo.toml` still has the old unusable image tag and `image_digest = "UNSET"`. A byte-identical v2 rebuild was reported to us by a judge-side run; **we did not re-run it**, so treat it as unverified (`docs/HISTORY.md`).

## Who holds keys (trust, disclosed)

The invoice contract has no owner and no admin call, and **invoice accounts have no keys**. But "no key" is not true of every account around it. Checked with RPC `view_access_key_list` on 2026-11-11
(we did not delete or rotate any key):

| Account | What it is | Keys | What the holder could do |
|---|---|---|---|
| invoice `0u…` accounts (`INV-1111-V32-A` …) | the payment account | **none** (`zi verify` → `PASS no-access-keys`) | nothing: code is fixed by hash, terms are in the address |
| the v3.2r code itself (`BQLSk5ca…zCFry`; v3.2, `6YtW5oJ8…vMCNHJ`, likewise) | a global contract published **by hash** | n/a | content-addressed, so nobody can change what that hash runs |
| `sm1110-zi32-deployer.testnet` (v3.2 publisher), `sm1110-zi3-deployer.testnet` (v3.1/v3), `sm1110-zi-deployer.testnet` (v2/v1, and the v3.2r publisher) | operator accounts | 1 **full-access** key each, held by the operator (`view_access_key_list` for the v3.2 deployer, 2026-11-11: one `FullAccess` key) | publish other wasm under other hashes (the client does not trust them), spend their own NEAR. **Cannot** alter `BQLSk5ca…zCFry` or `6YtW5oJ8…vMCNHJ` |
| **`sm1110-tusdc.testnet`** (the tUSDC mock token, a contract account, owner = itself) | the token that token invoices trust | 1 **full-access** key, held by the operator | mint, redeploy or replace the token code, move or burn any tUSDC, including tokens parked on or paid through an invoice. **Token invoices trust this key**; NEAR invoices do not |
| merchant, tax vault, payer, sweeper (`sm1110-zi3-*`) | ordinary testnet accounts | 1 full-access key each | spend what they receive (they are the recipients, by design) |

So the claim is: **the invoice contract trusts nobody**, but a token invoice trusts whoever controls the token contract, and on testnet that is the operator's full-access key. On mainnet an invoice would name a real issuer's token
and inherit that issuer's trust model; that was not tried. Anyone can re-check:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"sm1110-tusdc.testnet"}}'
# → "keys":[{"public_key":"ed25519:…","access_key":{"nonce":…,"permission":"FullAccess"}}]   (a 0u… invoice account answers "keys":[])
```

## Limits (honest)

- **Nothing here is audited by a third party.** The audit rounds were AI reviews; the deployed v3.2r contract (the v3.2 source) is the source after the fixes for that audit, and those fixes were checked by unit tests and, for the race on the `bad_msg` path, by one live run (`docs/HISTORY.md` "v3.1 → v3.2"). A residual stays open: a sweep that lands in the same block as an already-executed rejected `ft_transfer_call` (no lock held yet) can still read a balance the token is about to take back; a payer's single call cannot produce it (`docs/STABLECOIN.md` §5.3).
- **tUSDC is a testnet mock, not a stablecoin, and its key holder is trusted.** The token `sm1110-tusdc.testnet` is a copy of the [`test-usdc`](https://github.com/erhantrk/test-usdc) (private until submission) mock (6 decimals, owner-only mint) with a full-access key held by the operator ("Who holds keys"): it has no value and no
  issuer behind it. The contract does not know tUSDC; each invoice names one NEP-141 token in its terms (so in its address), the contract accepts only that token, and the
  client allow-list (`src/config.ts`, `ZI_TUSDC_ACCOUNT`) pins symbol, decimals and account. On mainnet the allow-list would name a real issuer's NEP-141 contract with its real decimals, checked against `ft_metadata`; that was not tried.
- **Token invoices are not payable from an exchange until the id is registered.** An `ft_transfer` to an unregistered `0u` id fails in the token. One `storage_deposit` transaction (0.00125 NEAR, sent by merchant, payer or anyone) must come first;
  `zi pay` does it, an exchange withdrawal does not. The "no transaction until paid" and "plain transfer from an exchange" claims hold for **NEAR invoices**; for tokens only issuing is free.
- **Token limits.** One token per invoice, `0u` only for tokens (`0s` is refused), testnet only. A plain NEAR transfer to a token invoice and a plain `ft_transfer` of a
  different token are not recoverable (the NEAR stays on the account, the other token sits on its own contract). The receiver of every token payout must be registered on
  the token (NEP-145): an unregistered merchant or vault makes that payout fail (recorded as owed); `zi invoice new` refuses unregistered ones unless `--offline`.
- **A token payer can be charged twice.** `ft_on_transfer` cannot see tokens already parked by a plain `ft_transfer`. A payer who sends a plain `ft_transfer` of the full price and then pays by `ft_transfer_call`
  is accepted a second time (92/8), and the parked amount is later swept as an extra (`EXTRA_SWEPT`, split 92/8) with no refund path. The README's "not charged twice" (`contract-3`) holds for **NEAR** `pay()` only (v2 and later). The client now refuses a one-step token `zi pay` / dashboard Pay while
  `ft_balance_of(invoice) > 0` and tells you to `zi sweep` (`--allow-parked` overrides on the CLI); a hand-built `ft_transfer_call` is not stopped, and a contract fix needs a new hash.
- **Testnet only.** `src/config.ts` refuses a non-testnet network and an RPC URL containing the word `mainnet` (a substring test: a mainnet endpoint without that word, such as `https://free.rpc.fastnear.com`, passes that check). The real guard is
  `chain_id == testnet`, which `checkNetwork` asserts over RPC on every signing path (the CLI, the dashboard server, `scripts/plain-transfer.ts`) before a key is used; mainnet was not tested.
- **Transaction lookups need an archival RPC** after about 1.5 days ("Check the live testnet claims").
- **Exit codes.** `zi verify`, `zi receipt` and `zi replay` exit 1 on any failed check. `zi pay` exits 1 unless the result is
  `PAID` (a `REFUNDED_*` result means the deposit came back); the dashboard answers 409 with `paid:false` in that case. `zi pay` and `zi sweep` also exit 1 (with a `WARNING` and
  `TRANSFER_FAILED` lines) when a transfer failed downstream. `zi pay` exits 1 on `SETTLING`/`PAYOUT_PENDING` (it says `NOT PAID (yet)` and to run `zi sweep`),
  a token `zi pay` exits 0 only when `invoice_paid` was seen, the dashboard answers 202 with `paid:false, pending:true`, and a token sweep exits 1 on `UNDERPAID`,
  `NOTHING_TO_SWEEP`, `NEEDS_YOCTO`, `BALANCE_UNAVAILABLE`, `CONCURRENT_PAYMENT`.
- **Contract limits that stay (v3.2r, deployed; the same as v3.2).** The contract cannot reject a bad merchant/tax vault at pay time: `zi invoice new` and the dashboard check that both exist (and, for
  tokens, are registered) at issue time (`--offline` skips the check). A failed payout is recorded and the share stays owed (`SETTLING`, no `invoice_paid`): it is
  retried by `sweep` to that recipient only, or returned to the payer by `refund_payer` after the grace period. If the merchant never exists and the payer is unknown (a
  settlement made from a plain transfer), the share stays owed forever; it is never given to anyone else. A callback that never runs would leave the 5-minute payout lock
  stale and the failure unrecorded; a second failed refund to a different payer while the payer slot is taken is not protected. An invoice that expired untouched stays `OPEN`
  in storage until a call sets `EXPIRED` (`sweep` does it itself since v3.2). **Partly parked funds followed by a full payment still charge the payer twice** (the tax is right, the double payment is not refunded), for NEAR; for tokens even a *full* parked amount does (above).
  A plain-transfer underpay is never refunded: it stays parked, and after expiry is released to merchant and vault.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is
  the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a
  fallback, but every result in this README is `0u`.
- **The payer pays for the first touch.** Gas plus the protocol's 0.007 NEAR account-creation charge: measured **0.0075612 NEAR** of tokens burnt for a v3.2r NEAR `pay` (0.0075620 on v3.2; the same measurement for v3.1, v3, v2 and v1: `docs/HISTORY.md` "Deploy transactions and burns").
  A token invoice costs about 0.0072540 NEAR to initialize, 0.0011810 NEAR for the settling `ft_transfer_call` and 0.00125 NEAR for each NEP-145 registration (kept by the token). One-time deploy burn of v3.2: about 16.41 NEAR (v3.1: about 16.38); the v3.2r publish burn was not computed. The token costs above were measured on v3.2 and not re-measured on v3.2r. Issuing costs nothing.
- **Plain-transfer overpayments go to the merchant side (taxed).** `sweep()` cannot know the payer, so everything parked above `amount` is split like the price
  (92/8 at 800 bps) and not refunded. With `pay()` / `ft_transfer_call` the excess is refunded to the payer.
- **No checksum.** A mistyped `0u…` address is still a valid address for different bytes; funds sent to a wrong
  id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
- **Wallet support is untested.** We tested exchange-style `Transfer`s built by near-cli-rs / our CLI. Which
  browser wallets accept a `0u…` receiver is not verified (the wallet check was not run; see `docs/SPIKES.md`).
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no
  webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope for now:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u`
  dual UI, a reproducible-build Docker pipeline, and any indexer.

## AI use disclosure

Everything in this repository was written with AI assistance; the human (Erhan) decided, ran the accounts and is responsible. By model and round:

- **Planning phase (2026-11-08/09):** Claude (Anthropic) wrote the plan and the reference implementation (most of `src/*.ts` and `contract/src/lib.rs`, copied verbatim in T02).
- **Build (v1 and the days after):** **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`, max effort), in Command Code agent sessions orchestrated by Conductor (a Claude Code based orchestrator): the scaffold, the live testnet
  spikes, the fixtures, the scripts, the dashboard/server additions, the docs and the per-day review fixes. For v3 (2026-11-10) **DeepSeek V4.1 Flash** built the NEP-141 contract, its unit tests, the client/CLI/dashboard changes, the tests and the docs from
  a spec that **Claude Sonnet 5.5** designed (`docs/STABLECOIN.md`).
- **Claude Sonnet 5.5, earlier rounds:** the daily code reviews and fixes, the v2 work (contract v2, known-deployments client changes, re-recorded fixtures and live audit scenarios), the review of v3 and its fixes (four bugs, `docs/STABLECOIN.md` "Review round"),
  the live v3 and v3.1 runs and recordings, the F1 race, L3, S-F4, and the client/test/doc updates for v3.1.
- **Claude Opus 5.5, earlier rounds:** the operator role: testnet accounts and funding, the tUSDC mock and its registrations, **the global contract deploys** (v2, v3, v3.1, v3.2), the **reveals and the m3 lifecycle runs** it was asked for, the earlier final reviews and audits,
  and the **browser screenshots** in `docs/img/` (Chrome, 2026-11-10, v2 dashboard).
- **The final audit and its fixes (2026-11-11):** **Claude Fable 5.2** audited the repository; **Claude Sonnet 5.5** fixed the findings (contract v3.2 source, client, tests, and the documentation) with a test for each code fix.
- **The v3.2 round (2026-11-11):** **Claude Opus 5.5** did the operator work (built the v3.2 wasm, deployed it as a global contract from `sm1110-zi32-deployer.testnet`) and the re-check; **Claude Sonnet 5.5** ran the live flows on v3.2 with the operator's accounts
  (NEAR pay, tUSDC plain transfer + sweep, one-step `ft_transfer_call`, the `bad_msg` race), recorded and replayed them, and updated the client, tests and docs. Those testnet transactions were signed with the repo's own encoder using the `.env` keys (never printed or committed).
- Every protocol claim is meant to be checked by a test, a replay or an on-chain read listed above; AI reviews are not an independent audit.

## Pre-hackathon code

There is no code from before the hackathon window. The repository's first commit (`ea8d0fb`, 2026-11-10) is the
frozen plan, and it contains `docs/plan/reference/` (removed from the current tree; still in that commit): a reference implementation (the TypeScript sources, tests and
the contract) that was **drafted with Claude during the planning phase of this hackathon (2026-11-08/09)**, not
before it. Task T02 (`1435bbf`, "scaffold the repo from reference/") copied it verbatim into `src/` and
`contract/`. The v1 deployed contract was that reference contract; v2 is the same contract with the audit fixes.
**Only `src/vectors.ts` is still identical to the reference** (`git diff ea8d0fb:docs/plan/reference/ts/src/vectors.ts HEAD:src/vectors.ts` is empty).
`src/outcome.ts` and `src/tx.ts` were extended later for the v3 token work (outcome.ts about +42/−9 lines, tx.ts +7/−1);
`bytes.ts`, `config.ts`, `rpc.ts`, `send.ts` and `stateinit.ts` were changed by the audit fixes (range checks, the pinned code hash, the testnet check). Anyone reading a diff that
starts after `ea8d0fb` therefore does not see the reference code. Because every commit is inside the hackathon window there is no earlier baseline to compare against, so this README gives no
compare link; use `git log --reverse` (or `git diff ea8d0fb^..HEAD` for the whole history). The `hackathon-submission` tag the rules suggest (Q-003) does not exist yet: it is a human item above.
What was added after the reference: the scaffold and toolchain, the live testnet spikes and fixtures, the replay and dashboard extensions, the scripts, the extra tests, the docs, the review and audit fixes, the v2 work,
v3 (NEP-141 tokens), v3.1, v3.2 and the audit rounds' fixes. Test vectors are copied from nearcore (MIT/Apache-2.0), cited inline.
Code comments cite "PLAN" and task numbers (T01…): those are the internal plan and task list, which are not published.

## Open items that only the humans can do (NOT done)

These are required by the hackathon rules (Q-012, Q-014, Q-015, the public-repo deadline 2026-11-14T23:59Z) and are **not done yet**; nothing here was faked:

- [ ] **Demo video** (2 minutes) and the **public X post** with the video (screenshots alone are not enough for a local-only demo, Q-012). No video exists in this repo or linked yet.
- [ ] **Make this repository public** (judges cannot open a private one) and the sibling repo (ProvenExit, linked at the top) public (Q-015: it was private when last checked).
- [ ] **Create the tag `hackathon-submission`** (none exists). There is no compare link for that reason; see "Pre-hackathon code".
- [ ] Add the video and X post links here, then submit once on nearhackathon.com (after the humans confirm the payload).

## Run it yourself on testnet

`docs/RUN-ON-TESTNET.md` has the full keyed walkthrough (four accounts, issue, pay, plain transfer + sweep, refund, tUSDC, the local dashboard). In short: `cp .env.example .env` (prefilled with the v3.2r hash and the FastNEAR RPC), fill in the payer and
sweeper accounts and keys (`.env` is gitignored: never commit it), then `npm run zi -- invoice new …`, `zi pay <id>` (one transaction), or `scripts/plain-transfer.ts` + `zi sweep <id>`. Testnet only: `src/config.ts` refuses any other network and any
RPC URL containing `mainnet`, and every command also asserts `chain_id == testnet` over RPC before it uses a key. Token invoices: `zi pay <id> --plain` registers the id and sends a plain `ft_transfer`; `zi pay <id>` is the one-step path and **refuses when tokens are
already parked** (run `zi sweep` then; see Limits).

## How it works

```
 MERCHANT (laptop, no keys needed to issue)                PAYER
 ┌────────────────────────────────────┐            ┌───────────────────────────────┐
 │ zi invoice new  ── terms ──┐       │            │ (A) zi pay  (signs with       │
 │                            ▼       │  invoice   │     ZI_PAYER_KEY)             │
 │  stateinit.ts: STATE borsh → raw   │  doc /     │ (B) any wallet / exchange:    │
 │  → SHA3-256 → "0u…" address        │──address──►│     plain Transfer to 0u…     │
 │  invoices/INV-x.json               │            └───────────────┬───────────────┘
 │ zi status / verify / receipt  ◄────┼──── JSON-RPC (read) ───┐   │ signed tx (A) or Transfer (B)
 │ zi sweep (any account, gas only) ──┼──── signed tx ────┐    │   │
 └────────────────────────────────────┘                   ▼    │   ▼
 ═══════════════════ trust boundary: NEAR testnet (protocol 88) ═══════════════════════
   global contract code (by hash H)          invoice account 0u… = hash(H, STATE)
   deployed once by zi-deployer   ─────────► NONEXISTENT → (B) UNINITIALIZED (funds parked)
                                             → UniversalStateInit installs code H + STATE
                                             → pay()/sweep(): Promise transfers
                                                 ├─► merchant  (amount − tax)
                                                 ├─► tax_vault (tax)
                                                 └─► payer     (refund / excess)
```

The id is computed offline: `0u` + Crockford-base32(SHA3-256(borsh
`UniversalStateInit{code: CodeHash, data: {STATE}, access_keys: {}}`)). `STATE` is the borsh encoding of the
invoice terms (frozen layout in `SPEC.md` §2.3, implemented in `src/stateinit.ts`). No key
exists for an invoice account: `access_keys` is empty, the code is fixed by hash, and the terms are inside the
address.

Account lifecycle:

```
             (merchant computes id offline; nothing on chain)
NONEXISTENT ──── plain Transfer (any wallet/exchange) ────► UNINITIALIZED (holds NEAR, no code)
     │                                                           │
     │ [UniversalStateInit, FunctionCall pay(deposit)]           │ [UniversalStateInit, FunctionCall sweep()]
     ▼                                                           ▼
  INITIALIZED, status OPEN → pay() splits → PAID      INITIALIZED, status OPEN → sweep() splits → PAID
```

Contract methods (deployed v3.2r; args are `{}` unless noted; there is no init method, no owner and no key):

| Method | Payable | What it does |
|---|---|---|
| `pay()` | yes | NEAR invoices: splits the attached deposit per `tax_bps` (92/8 at 800 bps), or refunds it (table below) |
| `ft_on_transfer(sender_id, amount, msg)` | no (called by the token) | token invoices: accepts a `ft_transfer_call` whose `msg` is exactly `{"action":"pay"}` (optionally with this invoice's `invoice_id`) and whose caller is the invoice's token, or returns the amount unused with a `payment_rejected` reason |
| `sweep()` | no | settles funds that arrived without a call (a plain transfer / plain `ft_transfer`); re-sends owed shares to their own recipient; forwards extra funds (taxed) |
| `refund_payer()` | no | after the invoice's grace period, pays the undelivered shares of a `SETTLING` invoice back to the payer (`paid_by`) and nobody else |
| `fund()` | yes | token invoices: takes a NEAR deposit (the client sends 1,000 yocto) so the account can attach 1 yocto to each `ft_transfer` |
| `get_invoice()`, `get_owed_tax()` | view | the invoice as JSON (`u64`/`u128` are strings, including `owed_*`, `grace_ms`, `token`, `busy_until_ms`) / the tax share not yet delivered |
| `on_settled`, `on_token_balance` | private | callbacks: `on_settled` checks every payout, records failures per recipient (`owed_*`), emits `transfer_failed` and is the **only** place `invoice_paid` is emitted |

Statuses: `OPEN`, `PAID` (every share delivered), `EXPIRED`, `SETTLING` (money accepted, shares in flight or failed), `REFUNDED` (the payer got the undelivered shares back).
An invoice that expired untouched stays `OPEN` in storage until some call (a late `pay`, a late `ft_transfer_call`) sets `EXPIRED`; since v3.2 `sweep` treats an `OPEN` invoice past its expiry as `EXPIRED` by itself (Rust-tested, not run live).

`pay()` rules (NEAR invoices), checked in this order (`d` = attached deposit, `now` = block timestamp, `parked` = free balance − `d` − owed):

| # | Condition | Result |
|---|---|---|
| 1 | the invoice is a token invoice | `REFUNDED_WRONG_ASSET`; `d` goes back |
| 2 | status is not `OPEN` | `REFUNDED_NOT_OPEN`; `d` goes back to the payer |
| 3 | `now > expires_at_ms` | `REFUNDED_EXPIRED`; status becomes `EXPIRED`; `d` goes back |
| 4 | a payout is in flight (lock) | `REFUNDED_BUSY` |
| 5 | `parked ≥ amount` | funds parked by a plain transfer already cover the invoice: they are settled like `sweep()` (taxed) and `d` goes back in full (`payment_refunded`, reason `already_funded`) |
| 6 | `d < amount` | `REFUNDED_UNDERPAID`; status stays `OPEN`; `d` goes back |
| 7 | otherwise | status `SETTLING`, tax = `amount × tax_bps / 10000` (floor) to the tax vault, net to the merchant, any excess back to the payer; the callback then sets `PAID` and emits `invoice_paid` (the transaction returns `PAID`), or records what failed (`PAYOUT_PENDING`) |

`sweep()` (NEAR, `avail` = balance − owed − storage reserve; the reserve is 0 while `storage_usage ≤ 770` B): first re-sends owed shares (tax to the vault, merchant share to the
merchant, payer share to `refund_to`), then: `OPEN`/`EXPIRED`-never-paid with `avail ≥ amount` settles **all** of `avail` through the tax split (`PAID`, `late: true` after expiry);
`OPEN` with less panics `UNDERPAID` (funds stay parked); `EXPIRED` with less releases `avail` pro rata (taxed); `PAID` with `avail > 0` splits the extra the same way (`EXTRA_SWEPT`).
Token `sweep` reads `ft_balance_of` in a callback and runs the same plan; it returns the value `UNDERPAID` / `NOTHING_TO_SWEEP` (it cannot panic in a callback) and needs at least
150 Tgas. While a payout is in flight (5-minute lock) a second `sweep` panics `PAYOUT_IN_FLIGHT`.

Transactions (hand-encoded V0, ed25519 over SHA-256, because near-api-js 7.4.0 cannot serialize action 15):

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY (NEAR) | payer | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 100 Tgas, deposit = amount}]` |
| SWEEP (NEAR) | anyone | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 100 Tgas, 0}]` |
| PLAIN TRANSFER | any wallet | invoice `0u…` id | `[Transfer{amount}]` |
| INIT (token) | payer / merchant | invoice `0u…` id | `[UniversalStateInit, FunctionCall{"fund", 10 Tgas, 1000 yocto}]` |
| PAY (token) | payer | the token | `[FunctionCall{"ft_transfer_call", {receiver_id: invoice, amount, msg}, 200 Tgas, 1 yocto}]`; the final value is the amount **used** (`"1000000"` settled, `"0"` rejected) |
| PLAIN `ft_transfer` (token) | any wallet / exchange | the token | `[FunctionCall{"ft_transfer", 1 yocto}]`, which succeeds **only after the invoice id was registered on the token** with a separate `storage_deposit` transaction (0.00125 NEAR; `zi pay --plain` sends it first, an exchange withdrawal does not) |
| SWEEP (token) | anyone | invoice `0u…` id | `[UniversalStateInit, FunctionCall{"fund"}, FunctionCall{"sweep", "{}", 200 Tgas}]` (state init and fund only when needed) |

Each state change emits an `EVENT_JSON:` log line (`invoice_paid`, `payment_refunded`, `payment_rejected`, `extra_swept`, `transfer_failed`, `tax_resent`, `owed_resent`,
`owed_reclaimed`); `zi` prints it as `EVENT …` and `zi replay` parses the JSON. Merchant, tax and refund payouts are separate receipts joined into one `on_settled`
callback. If one fails (a missing account, an unregistered token receiver), NEAR returns the amount to the invoice account, the callback records it as owed and emits
`transfer_failed`, and **no `invoice_paid` is emitted**; a later `sweep` re-sends it to that recipient only, and `refund_payer` can return it to the payer after the grace period
(`docs/HISTORY.md` "v2 → v3"). `zi pay` / `zi sweep` print the failed receipt as `TRANSFER_FAILED …` and exit 1.

## Repo map

- `contract/` — the invoice contract (Rust, near-sdk 5.30.1): the **v3.2 source**, 94 unit tests; `contract/res/v3.2r/zeroinit_invoice.wasm` is the **deployed v3.2r wasm** (the reproducible build of commit `4116e69`; its sha256 equals the on-chain code), `contract/res/v3.2/zeroinit_invoice.wasm` the v3.2 wasm (history, a local build).
  `contract-v2/` — the v2 contract, its 14 tests and wasm (history).
- `src/` — the `zi` CLI, the frozen byte encoders (`bytes.ts`, `stateinit.ts`, `tx.ts`), `ft.ts` (NEP-141 views, exact units), RPC client, outcome parser, invoice docs, replay (`replay.ts` for v1/v2, `replay-v3.ts` for v3, v3.1, v3.2 and v3.2r), and the optional local dashboard (`server.ts`, `web/`).
- `fixtures/` — recorded RPC sessions that replay offline: `fixtures/v32r/` (current: `demo-run.json`, `token-demo-run.json`, `tokens.json`, `race.json`), `fixtures/v32/` (history, same files; v3.2: `demo-run.json`, `token-demo-run.json`, `tokens.json`, `race.json`), `fixtures/v31/` (`demo-run.json`, `token-demo-run.json`, `tokens.json`, `race.json`, `late.json`, plus `sf4.json`, spike evidence, not a replay), `fixtures/v3/`, `fixtures/v2/`, `fixtures/v1/` (history), and two **synthetic** fixtures used by tests only. Public signatures are replaced by `ed25519:REDACTED-PUBLIC-SIGNATURE` in the v2/v3 fixtures.
- `invoices/` — `v32r/` (current), `v32/`, `v31/`, `v3/`, `v2/`, `v1/` and `examples/INV-0001.json` (the frozen test vector); none contain secrets.
- `scripts/` — `demo.sh`, `demo-token.sh`, the `record-*.sh` recorders that were run, helpers (`plain-transfer.ts`, `plain-ft-transfer.ts`, `race-v32.ts`, `race-v31.ts`, …) and `judge-offline.sh` (one-command offline check).
- `docs/` — `HISTORY.md` (v1/v2/v3/v3.1/v3.2 and the older replays), `RUN-ON-TESTNET.md` (the keyed walkthrough), `SPIKES.md` (live tx hashes and measurements), `ARCHITECTURE.md`, `STABLECOIN.md` (the v3 interface spec). The v1 interface spec is [`SPEC.md`](SPEC.md) at the repo root.
- `site/` — the landing page, live at <https://zeroinit.vercel.app> (Astro; Node ≥ 22.23.4): `cd site && npm ci && npm run build`, output in `site/dist/`. Its replay data and the hash it shows come from the v3.2 recording `fixtures/v32/demo-run.json` (not yet moved to v3.2r) (`python3 -I site/scripts/extract-replay.py`).

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1,
cargo-near 0.23.0, near-cli-rs 0.31.1. Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5.

## Other project by the same builder (NEAR HACKATHON rule Q-015)

Erhan also submits **ProvenExit**: https://github.com/erhantrk/provenexit (private when last checked: making it public is a human item in "Open items" above). The two projects are independent and
share no code.

## History

Older contract versions (v1, v2, v3, v3.1, v3.2), their live evidence, old claims, replays and every deploy tx and burn: [`docs/HISTORY.md`](docs/HISTORY.md) ("v1 → v2", "v2 → v3", "v3 → v3.1", "v3.1 → v3.2", "Replaying the earlier recordings", "Older claims", "Deploy transactions and burns").

## License

MIT, see LICENSE.
