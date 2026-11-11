# ZeroInit: invoice addresses that cost nothing until paid (NEAR testnet)

ZeroInit gives every invoice its own NEAR address without any transaction to issue it. The address is a NEAR universal
account (`0u…`, NEP-655, protocol 88) derived from the invoice terms and an immutable contract. The payer's
single transaction creates that account, runs its contract and sends 92% to the merchant and 8% to a tax
vault. For **NEAR invoices** a plain transfer from any wallet or exchange also works: the money waits in the not-yet-initialized
account until anyone calls `sweep`. For **token (NEP-141) invoices** the `0u` id must first be *registered on the token* (one `storage_deposit`
transaction, 0.00125 NEAR, sent by the merchant, the payer or anyone); only then can an exchange or wallet `ft_transfer` to it. "Costs nothing until paid" means **issuing** costs nothing
(no transaction); with tokens, whoever registers the id pays that one small transaction.

Built at NEAR HACKATHON (2026-11). Track: Open Innovation (also Real-World Money). Testnet only; mock token only; not audited.

## Open items that only the humans can do (NOT done)

These are required by the hackathon rules (`docs/plan/HACKATHON-RULES.md`: Q-012, Q-014, Q-015, the public-repo deadline 2026-11-14T23:59Z) and are **not done yet**; nothing here was faked:

- [ ] **Demo video** (2 minutes) and the **public X post** with the video (screenshots alone are not enough for a local-only demo, Q-012). No video exists in this repo or linked; `docs/X-POST.md` still has a placeholder where the repo URL goes.
- [ ] **Make this repository public** (judges cannot open a private one) and the sibling repo below public (Q-015: it was private when last checked).
- [ ] **Create the tag `hackathon-submission`** (none exists). There is no compare link for that reason; see "Pre-hackathon code".
- [ ] Add the video and X post links here, then submit once on nearhackathon.com (after the humans confirm the payload).

## Status (2026-11-11)

The contract **deployed on testnet and used by the client is v3.1**: code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX` (wasm sha256 `1b1dcc75…e278`, 163,771 bytes), global deploy tx
`52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, deploy burn about **16.38 NEAR** (deployer balance 17.8774031 → 1.4989866 NEAR across the tx, gas included). v3.1 handles NEAR and
**tUSDC, a testnet mock token** (`sm1110-tusdc.testnet`, no value, no issuer), with a `SETTLING` status, an owed ledger and a payout lock; it was run live on testnet and every run is a fixture that replays
offline (`fixtures/v31/`, transactions in `docs/SPIKES.md` "Contract v3.1 live"). Older versions (v3, v2, v1) stay on testnet as recorded history: `docs/HISTORY.md`.

**The source in `contract/` is newer than the deployed contract.** After the final audit, `contract/src/lib.rs` holds a **v3.2 source** (four contract fixes, `docs/HISTORY.md` "v3.1 → v3.2") that is **not deployed**:
the deployed contract, the client's pinned hash and `contract/res/zeroinit_invoice.wasm` are v3.1, whose source is `git show 49ec835:contract/src/lib.rs`. `npm run contract:build` on this tree would give a different wasm.
The live contract therefore still has the findings that v3.2 fixes.

Not done: a reproducible wasm build, a browser walk-through of the v3.1 dashboard, wallet checks, anything on mainnet, an independent audit (the audit rounds were AI reviews, see "AI use disclosure").
`docs/STABLECOIN.md` is the interface spec ("Live results" sections say what the runs showed).

## Who holds keys (trust, disclosed)

The invoice contract has no owner and no admin call, and **invoice accounts have no keys**. But "no key" is not true of every account around it. Checked with RPC `view_access_key_list` on 2026-11-11
(we did not delete or rotate any key):

| Account | What it is | Keys | What the holder could do |
|---|---|---|---|
| invoice `0u…` accounts (`INV-1111-V31-A` …) | the payment account | **none** (`zi verify` → `PASS no-access-keys`) | nothing: code is fixed by hash, terms are in the address |
| the v3.1 code itself (`2prMzXHZ…DaYX`) | a global contract published **by hash** | n/a | content-addressed, so nobody can change what that hash runs |
| `sm1110-zi3-deployer.testnet` (v3.1/v3 publisher), `sm1110-zi-deployer.testnet` (v2/v1) | operator accounts | 1 **full-access** key each, held by the operator | publish other wasm under other hashes (the client does not trust them), spend their own NEAR. **Cannot** alter `2prMzXHZ…DaYX` |
| **`sm1110-tusdc.testnet`** (the tUSDC mock token, a contract account, owner = itself) | the token that token invoices trust | 1 **full-access** key, held by the operator | mint, redeploy or replace the token code, move or burn any tUSDC, including tokens parked on or paid through an invoice. **Token invoices trust this key**; NEAR invoices do not |
| merchant, tax vault, payer, sweeper (`sm1110-zi3-*`) | ordinary testnet accounts | 1 full-access key each | spend what they receive (they are the recipients, by design) |

So the claim is: **the invoice contract trusts nobody**, but a token invoice trusts whoever controls the token contract, and on testnet that is the operator's full-access key. On mainnet an invoice would name a real issuer's token
and inherit that issuer's trust model; that was not tried. Anyone can re-check:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"sm1110-tusdc.testnet"}}'
# → "keys":[{"public_key":"ed25519:…","access_key":{"nonce":…,"permission":"FullAccess"}}]   (a 0u… invoice account answers "keys":[])
```

## What NEAR does here

- Protocol 88 lets an account id be SHA3-256 of its future code + storage, so we can print the address first.
- `UniversalStateInit` + `FunctionCall` in one transaction: create, pay and split happen in one tx.
- Plain transfers to a `0u` id create an "uninitialized" account that only its matching state init can unlock.
- Global contracts: the invoice code is deployed once by hash (v3.1, current: `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`); each invoice only references it.

## Repo map

- `contract/` — the invoice contract **source** (Rust, near-sdk 5.30.1): currently the **v3.2 source, not deployed** (see Status); `contract/res/zeroinit_invoice.wasm` is the **deployed v3.1 wasm** (a local build of commit `49ec835`, not a reproducible one).
  `contract-v2/` — the v2 contract, its 14 tests and wasm (history).
- `src/` — the `zi` CLI, the frozen byte encoders (`bytes.ts`, `stateinit.ts`, `tx.ts`), `ft.ts` (NEP-141 views, exact units), RPC client, outcome parser, invoice docs, replay (`replay.ts` for v1/v2, `replay-v3.ts` for v3/v3.1), and the optional local dashboard (`server.ts`, `web/`).
- `fixtures/` — recorded RPC sessions that replay offline: `fixtures/v31/` (current: `demo-run.json`, `token-demo-run.json`, `tokens.json`, `race.json`, `late.json`, plus `sf4.json`, spike evidence, not a replay), `fixtures/v3/`, `fixtures/v2/`, `fixtures/v1/` (history), and two **synthetic** fixtures used by tests only. Public signatures are replaced by `ed25519:REDACTED-PUBLIC-SIGNATURE` in the v2/v3 fixtures.
- `invoices/` — `v31/` (current), `v3/`, `v2/`, `v1/` and `examples/INV-0001.json` (the frozen test vector); none contain secrets.
- `scripts/` — `demo.sh`, `demo-token.sh`, the `record-*.sh` recorders that were run, helpers (`plain-transfer.ts`, `plain-ft-transfer.ts`, `race-v31.ts`, …) and `judge-offline.sh` (one-command offline check).
- `docs/` — `HISTORY.md` (v1/v2/v3/v3.1 and the older replays), `RUN-ON-TESTNET.md` (the keyed walkthrough), `SPIKES.md` (live tx hashes and measurements), `ARCHITECTURE.md`, `STABLECOIN.md` (the v3 interface spec), `SUBMISSION.md` (human checklist), `plan/` (the frozen plan and byte-level interfaces).

## Try it offline in 2 minutes (no keys, no network) — do X, see Y

Every command below was run in this checkout, with no `.env` (`npm ci --include=dev` needs the npm registry once).

1. `npm ci --include=dev` → installs the 3 runtime packages (`@noble/hashes`, `@noble/curves`, `@scure/base`) plus
   `near-api-js` 7.4.0 for one encoder-parity test. The flag matters: with `NODE_ENV=production` a plain `npm ci`
   skips devDependencies and the parity test cannot import `near-api-js`.

2. `npm test` → 209 tests, all pass (byte vectors from nearcore 2.14 and the frozen examples, units, deployments, `/1` and `/2` documents, encoder parity with near-api-js 7.4.0,
   outcome/replay/CLI/dashboard tests, the recorded fixtures of every version, each with tamper tests):

   ```
   # tests 209
   # pass 209
   # fail 0
   # skipped 0
   ```

3. `npm run zi -- vectors` → 8 lines, all `PASS` (`crockford-kat-1..4`, `wallet-0u`, `wallet-0s`, `example-0u`, `example-0s`).

4. `npm run zi -- replay fixtures/v31/demo-run.json` → the **v3.1** NEAR demo, recorded live on the current contract (invoice ids `INV-1111-V31-A/B/C`, 1 NEAR), all
   `PASS`, exit 0; among the checks:

   ```
   INFO deployment v3.1 (current, deployed on testnet: v3 plus the token-sweep race fix) 2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX
   PASS before-unknown-account INV-1111-V31-A NONEXISTENT
   PASS pay-tx-success INV-1111-V31-A 8gYZVNFT9DBk9PTZ7jqbe7w2iz4Fnewo4fudVYAzAwFF []
   PASS invoice-paid-after-callback INV-1111-V31-A
   PASS split-merchant INV-1111-V31-A 0.92
   PASS split-vault INV-1111-V31-A 0.08
   PASS transfer-path-uninitialized INV-1111-V31-B 1
   PASS sweep-tx-result INV-1111-V31-B CNoLGGbaUAaYZKcCyrATmU6SHgY9hzWUJx2uykBSLVgR result=PAID
   ```

5. `npm run zi -- replay fixtures/v31/token-demo-run.json` → a **tUSDC** invoice (mock token): the payer first **registers the invoice id on the token** (one `storage_deposit` transaction, 0.00125 NEAR; an exchange
   would not do this, so for tokens someone must), then sends a plain `ft_transfer` (the part an exchange does), then anyone sweeps it in one transaction (state init + fund + sweep):

   ```
   PASS register-tx-success TOK-1111-V31-A A3LGRoPeaWNXb6oC4UW1eo7v413E5ahftLoB4qJkKuFV []
   PASS plain-transfer-tx-success TOK-1111-V31-A 6bj1B77NHBnK8jwfRfKvVEqNw9HMUpnQQmPrqfRgBXCM []
   PASS ft-parked-balance TOK-1111-V31-A 1
   PASS sweep-tx-result TOK-1111-V31-A HnN8YwYDG9R8rap34fuTibAVEDcdUpc8xa7jrouY7efK result=PAID
   PASS ft-split-merchant TOK-1111-V31-A 0.92
   PASS ft-split-vault TOK-1111-V31-A 0.08
   ```

   `npm run zi -- replay fixtures/v31/race.json` is the **F1 race** (a token sweep while an `ft_transfer_call` is in flight; details in `docs/HISTORY.md` "v3 → v3.1"):

   ```
   PASS sweep-tx-result RACE-V31-4 8vtV5twiaxVdUvTUopcs2eUAG2hzANxdeMWSSqoYJZ9Y result=CONCURRENT_PAYMENT
   PASS concurrent-payment-plans-nothing RACE-V31-4 0 payout(s), 0 event(s), 0 failure(s)
   PASS ft-rejected-busy RACE-V31-4 used 0, 1000000 of 1000000 returned to sm1110-zi3-payer.testnet
   ```

   The other v3.1 recordings replay the same way: `tokens.json` (init, one `ft_transfer_call` that settles, a second one that is returned) and `late.json` (a missing merchant, then the sweep after the account was created).
   The v3, v2 and v1 recordings replay under their own hashes: `docs/HISTORY.md` "Replaying the earlier recordings".

One command for the whole judge path: `bash scripts/judge-offline.sh` → `npm ci --include=dev`, `npm test`, `vectors`, the five v3.1 replays, the seven v3 replays, the three
v2 replays, the two v1 replays and an offline `verify` of every v3.1, v3, v2 and v1 invoice; its last line is `JUDGE-OFFLINE: ALL PASS`. (The judge-offline run in our sandbox mapped
`npm run -s zi --` to `node src/cli.ts`, because `npm run` printed none of the CLI output there.)

## Check the live testnet claims (read-only, no keys)

The invoices under `invoices/v31/` (current contract v3.1, NEAR and tUSDC) and the older folders were paid on testnet (protocol 88). These commands only read RPC; they work from a clean clone with no `.env`.
The default endpoint is `https://rpc.testnet.fastnear.com` (`https://rpc.testnet.near.org` started answering HTTP 429 "endpoint is deprecated" on 2026-11-10; set `ZI_RPC_URL` to use another one).

**The default RPC is not archival.** It keeps about 1.5 days of transactions (its `status` reported `earliest_block_time` 2026-11-10T01:01Z on 2026-11-11): the v1 deploy tx `DSXd2Sjq…` is already `UNKNOWN_TRANSACTION` there, and every
transaction cited in this repo (all sent 2026-11-10) will be too before judging starts (2026-11-16). **State-based checks keep working** (`zi verify`, `zi status`, `view_global_contract_code`, below), and so does every offline replay.
For a transaction lookup use the archival endpoint, `ZI_ARCHIVAL_RPC_URL=https://archival-rpc.testnet.fastnear.com` (a `curl` of `tx` / `EXPERIMENTAL_tx_status` there; `zi receipt --tx <hash>` falls back to it by itself
on the default RPC), or nearblocks; the recorded fixtures under `fixtures/` are the durable evidence.

1. `npm run zi -- verify INV-1111-V31-A` → the address and the state-init bytes are recomputed from the terms and the pinned code hash (`ZI_CODE_HASH`, default v3.1
   `2prMzXHZ…DaYX`, never the invoice file's own `code_hash`), then compared with the chain. It also says which deployment the invoice uses. Any `FAIL` makes the command exit 1
   (run on 2026-11-10 for all 8 invoices of `invoices/v31/`: no `FAIL`):

   ```
   PASS code-hash-trusted 2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX
   INFO deployment v3.1 (current, deployed on testnet: v3 plus the token-sweep race fix)
   PASS format-matches-deployment zeroinit-invoice/2
   PASS id-from-terms 0u6c0024qear4qp5f447xvkjsgmz5mrq5x1c1kjjr0ddp3eer9s1t0
   PASS raw-from-terms
   PASS doc-fields-from-terms
   PASS code-hash-onchain 2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX
   PASS terms-onchain
   PASS no-access-keys
   INFO status=PAID
   ```

   `npm run zi -- verify TOK-1111-V31-A` does the same for the tUSDC invoice and adds `PASS token-allowed tUSDC sm1110-tusdc.testnet` and `PASS token-metadata-onchain tUSDC 6`. `verify` of a v2 or v1 invoice
   (`INV-1111-V2-A`, `INV-1111-A`) checks it against its own historical hash; `zi pay`, `zi sweep` and `zi init` refuse historical invoices.

2. Open `https://testnet.nearblocks.io/txns/8gYZVNFT9DBk9PTZ7jqbe7w2iz4Fnewo4fudVYAzAwFF` → one transaction with exactly two actions, `UniversalStateInit` + `pay`,
   receiver `0u6c0024qear4qp5f447xvkjsgmz5mrq5x1c1kjjr0ddp3eer9s1t0`, result `PAID`, and transfers of `0.92` NEAR to `sm1110-zi3-sweeper.testnet` (the merchant in the demo) and
   `0.08` NEAR to `sm1110-zi3-taxvault.testnet`, with `invoice_paid` logged by the `on_settled` callback. If nearblocks renders `0u…` ids poorly, the RPC `tx` method on the **archival** endpoint returns the same JSON
   while it is still on the default one, and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-V31-B` → the invoice that was paid by a plain transfer (no state init) and later swept:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=399
   ```

   Plain-transfer tx `AzASJAvoViqMhFcUX38MtJvMGijdwAc3xCi2rtA3qujd`; sweep tx `CNoLGGbaUAaYZKcCyrATmU6SHgY9hzWUJx2uykBSLVgR`. `paid_by=null` is expected on this path:
   `sweep()` does not know who transferred the funds. `npm run zi -- status TOK-1111-V31-A` shows the tUSDC one; its register tx is `A3LGRoPeaWNXb6oC4UW1eo7v413E5ahftLoB4qJkKuFV`, its plain `ft_transfer` `6bj1B77NHBnK8jwfRfKvVEqNw9HMUpnQQmPrqfRgBXCM`, the sweep `HnN8YwYDG9R8rap34fuTibAVEDcdUpc8xa7jrouY7efK` (0.92 / 0.08 tUSDC).

4. Contract integrity: `shasum -a 256 contract/res/zeroinit_invoice.wasm` → `1b1dcc7515f2b9d6bada0540ed20833dd3050d074e155fb8d489ac2afe01e278` (163,771 bytes). That digest
   is the base58 code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`; `zi verify` checks that the invoice account's on-chain `global_contract_hash` equals it, and the on-chain bytes (`view_global_contract_code`) equal the committed
   file. That proves the committed wasm *is* the deployed code; it does **not** prove which source it was built from (next section). Older deploy txs and burns: `docs/HISTORY.md` "Deploy transactions and burns".

### Is the wasm built from the source? (a trust assumption)

- **Deployed v3.1:** the committed wasm equals the on-chain bytes (checked above). That it was built from `contract/src` at commit `49ec835` rests on **trust in the operator's local build**: it is not a reproducible build and
  nobody has rebuilt and compared it. The current `contract/src` is the v3.2 source and builds to a *different* wasm.
- **No reproducible build exists for any version.** `[package.metadata.near.reproducible_build]` in `contract/Cargo.toml` and `contract-v2/Cargo.toml` names the image tag `sourcescan/cargo-near:0.23.0-rust-1.95.0`, which is not in
  Docker Hub's tag list (checked 2026-11-10), and `image_digest = "UNSET"`, so `cargo near build reproducible-wasm` cannot be repeated as committed. A byte-identical v2 rebuild was reported to us by a judge-side run; **we did not re-run it**,
  so treat it as unverified (`docs/HISTORY.md`). To make this real: set an existing image and its digest, run one reproducible build of the contract, and publish the digest.

## Run it yourself on testnet

`docs/RUN-ON-TESTNET.md` has the full keyed walkthrough (four accounts, issue, pay, plain transfer + sweep, refund, tUSDC, the local dashboard). In short: `cp .env.example .env` (prefilled with the v3.1 hash and the FastNEAR RPC), fill in the payer and
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
invoice terms (frozen layout in `docs/plan/INTERFACES.md` §2.3, implemented in `src/stateinit.ts`). No key
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

Contract methods (deployed v3.1; args are `{}` unless noted; there is no init method, no owner and no key):

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
An invoice that expired untouched stays `OPEN` until some call (a late `pay`, a late `ft_transfer_call`) sets `EXPIRED`.

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

## Claims and how to verify each

| Claim | Verify with | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in, so no `.env` is needed; without `--offline` it also checks over RPC that merchant and tax vault exist on testnet) | `INVOICE`/`ACCOUNT`/`PAY`/`FILE` lines; no RPC call |
| The address commits to the terms and code | `npm run zi -- verify INV-1111-V31-A --offline` | `PASS code-hash-trusted 2prMzXHZ…`, `INFO deployment v3.1 (current…`, `PASS id-from-terms 0u6c0024…s1t0`, `PASS raw-from-terms` |
| One tx creates + pays + splits (NEAR) | `npm run zi -- replay fixtures/v31/demo-run.json` (or the nearblocks link in the previous section) | `PASS pay-tx-success INV-1111-V31-A 8gYZVNFT… []`, `PASS split-merchant INV-1111-V31-A 0.92`, `PASS split-vault INV-1111-V31-A 0.08`, `PASS invoice-paid-after-callback INV-1111-V31-A` |
| Plain transfers are safe before init | `npm run zi -- replay fixtures/v31/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-V31-B 1`, `PASS sweep-tx-result INV-1111-V31-B CNoLGGba… result=PAID` |
| A stablecoin invoice (tUSDC, a testnet mock) is paid by a plain `ft_transfer` and swept by anyone | `npm run zi -- replay fixtures/v31/token-demo-run.json` | `PASS ft-parked-balance TOK-1111-V31-A 1`, `PASS ft-split-merchant TOK-1111-V31-A 0.92`, `PASS ft-split-vault TOK-1111-V31-A 0.08` |
| A token `sweep` that races an in-flight `ft_transfer_call` plans nothing (F1, fixed in v3.1) | `npm run zi -- replay fixtures/v31/race.json` | `PASS sweep-tx-result RACE-V31-4 8vtV5twi… result=CONCURRENT_PAYMENT`, `PASS concurrent-payment-plans-nothing RACE-V31-4 0 payout(s), 0 event(s), 0 failure(s)`, `PASS ft-rejected-busy RACE-V31-4 used 0, 1000000 of 1000000 returned …`, then the retry settles (`PASS ft-split-merchant RACE-V31-4 0.92`) |
| A missing NEAR merchant: owed, then paid after the account exists (L3) | `npm run zi -- replay fixtures/v31/late.json` and `fixtures/v3/late-resweep.json` | `PASS owed-after-failure LATE-V31 …`, `PASS owed-resent LATE-V31 late.sm1110-zi3-merchant.testnet 92000000000000000000000`; the same for the v3 invoice `LATE-V3` |
| A token payment through `ft_transfer_call` settles, or is returned whole with a reason | `npm run zi -- replay fixtures/v3/tokens.json` and `fixtures/v3/failures.json` | `PASS ft-excess-refunded TOK-V3-C …`, `PASS ft-rejected-underpaid TOK-V3-D used 0, 500000 of 500000 returned …`, `ft-rejected-expired`, `ft-rejected-not_open`, `ft-rejected-wrong_token`, `ft-rejected-bad_msg`, `ft-rejected-low_gas` |
| `invoice_paid` is never emitted before the payouts succeeded (v2 residual fixed) | `npm run zi -- replay fixtures/v3/fixes.json` and `failures.json` | `PASS invoice-paid-after-callback TAX-V3`; for `LATE-V3` and `UNREG-V3` a failed payout gives `PAYOUT_PENDING` and no `invoice_paid` (`test/live-v3.test.ts`) |
| A failed payout is owed, retried to its own recipient, or refunded to the payer after the grace period (v2 residual fixed) | `npm run zi -- replay fixtures/v3/failures.json`, `fixes.json`, `tokens.json` | `PASS owed-resent UNREG-V3 sm1110-zi3-unreg.testnet 920000`, `PASS refund-payer-to-paid-by REFUND-V3 sm1110-zi3-payer.testnet`, `owed-after-failure …` |
| A partly parked amount is taxed too (v2 residual fixed) | `npm run zi -- replay fixtures/v3/fixes.json` | `TAX-V3`: vault 0.008 + 0.004 (`extra_swept`), `PASS split-matches-terms TAX-V3 …` |
| The tax split is the invoice's own rule | any v3 replay | `PASS split-matches-terms <id> 0.1 -> merchant 0.092, tax 0.008` |
| Nobody holds keys to **invoice** accounts (other accounts do hold keys: see "Who holds keys") | `npm run zi -- verify INV-1111-V31-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| A `pay()` that underpays, is late or hits a paid invoice is refunded to the payer (NEAR; not for plain transfers) | `npm run zi -- replay fixtures/v3/near.json` | `PASS refund-event INV-V3-C REFUNDED_UNDERPAID`, `PASS refund-event INV-V3-D REFUNDED_EXPIRED`, `PASS refund-event INV-V3-E REFUNDED_NOT_OPEN`: each checks the `payment_refunded` event, its reason, and a `Transfer` of exactly the deposit to the payer (since the audit round; mutation tests in `test/replay-v3-hardening.test.ts`). A plain-transfer underpay is **not** refunded: it stays parked and, after expiry, is released to merchant and vault |
| The deployed code is the committed wasm (built from the v3.1 source of commit `49ec835`: a trust assumption, see "Is the wasm built from the source?") | `shasum -a 256 contract/res/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-V31-A` | digest `1b1dcc75…e278` = base58 `2prMzXHZ…DaYX`; `PASS code-hash-onchain` |
| A one-step token payment on top of parked tokens is refused by the client (a contract limit, see Limits) | `node --test test/cli-token.test.ts test/server-token.test.ts` | the `claims-3` tests pass; `zi pay` prints `run \`zi sweep\` instead` |
| The v2/v1 fixes (contract-1/2/3 on v2) and the v1/v2 history replays | `docs/HISTORY.md` → "Older claims" | the same `PASS` lines as before |

## Limits (honest)

- **Nothing here is audited by a third party; the contract source and the deployed contract differ.** The deployed v3.1 contract still has the findings that the v3.2 source fixes (`docs/HISTORY.md` "v3.1 → v3.2"); the audit rounds were AI reviews.
- **tUSDC is a testnet mock, not a stablecoin, and its key holder is trusted.** The token `sm1110-tusdc.testnet` is a copy of the `test-usdc` mock (6 decimals, owner-only mint) with a full-access key held by the operator ("Who holds keys"): it has no value and no
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
- **Contract limits that stay (v3.1, deployed).** The contract cannot reject a bad merchant/tax vault at pay time: `zi invoice new` and the dashboard check that both exist (and, for
  tokens, are registered) at issue time (`--offline` skips the check). A failed payout is recorded and the share stays owed (`SETTLING`, no `invoice_paid`): it is
  retried by `sweep` to that recipient only, or returned to the payer by `refund_payer` after the grace period. If the merchant never exists and the payer is unknown (a
  settlement made from a plain transfer), the share stays owed forever; it is never given to anyone else. A callback that never runs would leave the 5-minute payout lock
  stale and the failure unrecorded; a second failed refund to a different payer while the payer slot is taken is not protected. An invoice that expired untouched stays `OPEN`
  until a late call sets `EXPIRED`. **Partly parked funds followed by a full payment still charge the payer twice** (the tax is right, the double payment is not refunded), for NEAR; for tokens even a *full* parked amount does (above).
  A plain-transfer underpay is never refunded: it stays parked, and after expiry is released to merchant and vault.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is
  the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a
  fallback, but every result in this README is `0u`.
- **The payer pays for the first touch.** Gas plus the protocol's 0.007 NEAR account-creation charge: measured **0.0075610 NEAR** of tokens burnt for a v3.1 NEAR `pay` (v3: 0.0075600, v2: 0.0077197, v1: 0.0073617847981195 NEAR).
  A token invoice costs about 0.0072530 NEAR to initialize, 0.0011780 NEAR for the settling `ft_transfer_call` and 0.00125 NEAR for each NEP-145 registration (kept by the token). One-time deploy burn of v3.1: about 16.38 NEAR. Issuing costs nothing.
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

## History

`docs/HISTORY.md` has what v2, v3 and v3.1 each fixed with their live evidence ("v1 → v2", "v2 → v3", "v3 → v3.1"), the v3.2 source note, the older claims table, the history replays and every deploy tx and burn.

## Pre-hackathon code

There is no code from before the hackathon window. The repository's first commit (`38fc3f0`, 2026-11-10) is the
frozen plan, and it contains `docs/plan/reference/`: a reference implementation (the TypeScript sources, tests and
the contract) that was **drafted with Claude during the planning phase of this hackathon (2026-11-08/09)**, not
before it. Task T02 (`9c4faf7`, "scaffold the repo from reference/") copied it verbatim into `src/` and
`contract/`. The v1 deployed contract was that reference contract; v2 is the same contract with the audit fixes.
**Only `src/vectors.ts` is still identical to the reference** (`git diff 38fc3f0:docs/plan/reference/ts/src/vectors.ts HEAD:src/vectors.ts` is empty).
`src/outcome.ts` and `src/tx.ts` were extended later for the v3 token work (outcome.ts about +42/−9 lines, tx.ts +7/−1);
`bytes.ts`, `config.ts`, `rpc.ts`, `send.ts` and `stateinit.ts` were changed by the audit fixes (range checks, the pinned code hash, the testnet check). Anyone reading a diff that
starts after `38fc3f0` therefore does not see the reference code. Because every commit is inside the hackathon window there is no earlier baseline to compare against, so this README gives no
compare link; use `git log --reverse` (or `git diff 38fc3f0^..HEAD` for the whole history). The `hackathon-submission` tag the rules suggest (Q-003) does not exist yet: it is a human item above.
What was added after the reference: the scaffold and toolchain, the live testnet spikes and fixtures, the replay and dashboard extensions, the scripts, the extra tests, the docs, the review and audit fixes, the v2 work,
v3 (NEP-141 tokens), v3.1 and the audit rounds' fixes. Test vectors are copied from nearcore (MIT/Apache-2.0), cited inline.

## AI use disclosure

Everything in this repository was written with AI assistance; the human (Erhan) decided, ran the accounts and is responsible. By model and round:

- **Planning phase (2026-11-08/09):** Claude (Anthropic) wrote the plan and the reference implementation (most of `src/*.ts` and `contract/src/lib.rs`, copied verbatim in T02).
- **Build (v1 and the days after):** **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`, max effort), in Command Code agent sessions orchestrated by Conductor (a Claude Code based orchestrator): the scaffold, the live testnet
  spikes, the fixtures, the scripts, the dashboard/server additions, the docs and the per-day review fixes. For v3 (2026-11-10) **DeepSeek V4.1 Flash** built the NEP-141 contract, its unit tests, the client/CLI/dashboard changes, the tests and the docs from
  a spec that **Claude Sonnet 5.5** designed (`docs/STABLECOIN.md`).
- **Claude Sonnet 5.5, earlier rounds:** the daily code reviews and fixes, the v2 work (contract v2, known-deployments client changes, re-recorded fixtures and live audit scenarios), the review of v3 and its fixes (four bugs, `docs/STABLECOIN.md` "Review round"),
  the live v3 and v3.1 runs and recordings, the F1 race, L3, S-F4, and the client/test/doc updates for v3.1.
- **Claude Opus 5.5, earlier rounds:** the operator role: testnet accounts and funding, the tUSDC mock and its registrations, **the global contract deploys** (v2, v3, v3.1), the **reveals and the m3 lifecycle runs** it was asked for, the earlier final reviews and audits,
  and the **browser screenshots** in `docs/img/` (Chrome, 2026-11-10, v2 dashboard).
- **This round (2026-11-11), the final audit and its fixes:** **Claude Fable 5.2** audited the repository; **Claude Sonnet 5.5** fixed the findings (contract v3.2 source, client, tests, and this documentation) with a test for each code fix. Nothing in this round deployed,
  signed or sent a transaction, called NEAR AI or touched a secret; the deployed contract is unchanged.
- Every protocol claim is meant to be checked by a test, a replay or an on-chain read listed above; AI reviews are not an independent audit.

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1,
cargo-near 0.23.0, near-cli-rs 0.31.1. Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5.

## Other project by the same builder (NEAR HACKATHON rule Q-015)

Erhan also submits **ProvenExit**: https://github.com/erhantrk/provenexit (private when last checked: making it public is a human item above). The two projects are independent and
share no code.

## License

MIT, see LICENSE.
