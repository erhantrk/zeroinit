# ZeroInit: invoice addresses that cost nothing until paid (NEAR testnet)

ZeroInit gives every invoice its own NEAR address without any transaction. The address is a NEAR universal
account (`0u…`, NEP-655, protocol 88) derived from the invoice terms and an immutable contract. The payer's
single transaction creates that account, runs its contract and sends 92% to the merchant and 8% to a tax
vault. A plain transfer from any wallet or exchange also works: the money waits in the not-yet-initialized
account until anyone calls `sweep`.

Built at NEAR HACKATHON (2026-11). Track: Open Innovation (also Real-World Money).

## What NEAR does here

- Protocol 88 lets an account id be SHA3-256 of its future code + storage, so we can print the address first.
- `UniversalStateInit` + `FunctionCall` in one transaction: create, pay and split happen in one tx.
- Plain transfers to a `0u` id create an "uninitialized" account that only its matching state init can unlock.
- Global contracts: the invoice code is deployed once by hash (v2, current: `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`);
  each invoice only references it. The first deployment (v1, `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`) stays on testnet as recorded history:
  see "v1 → v2" below.

## Repo map

- `contract/` — the immutable invoice contract (Rust, near-sdk 5.30.1, v2) and the exact wasm that is deployed:
  `contract/res/zeroinit_invoice.wasm` (v1 is in git history, see "v1 → v2").
- `src/` — the `zi` CLI, the frozen byte encoders (`bytes.ts`, `stateinit.ts`, `tx.ts`), RPC client, outcome
  parser, invoice docs, replay, and the optional local dashboard (`server.ts`).
- `fixtures/` — recorded RPC sessions that replay offline. Current (v2, invoice ids end in `-V2`): `demo-run.json`,
  `refund-cases.json`, `audit-scenarios.json`. History (v1): `fixtures/v1/demo-run.json`, `fixtures/v1/refund-cases.json`.
  Plus `synthetic-demo.json` (marked synthetic, used by a parser test only). In the v2 fixtures the public block/chunk/tx
  signatures (64-byte `ed25519:` values, never read by replay) are replaced by `ed25519:REDACTED-PUBLIC-SIGNATURE`, so no
  secret scanner can mistake them for a key; the v1 fixtures keep theirs.
- `invoices/examples/INV-0001.json` — the frozen test-vector invoice; `invoices/demo/` — the v2 invoices that were
  actually paid on testnet; `invoices/v1/` — the v1 ones (none contain secrets).
- `scripts/` — `demo.sh` (the recorded demo), `record-refund-cases.sh` and `record-audit-scenarios.sh` (the live
  recordings of the other two fixtures), `plain-transfer.ts` (a bare `Transfer`, the exchange path),
  `judge-offline.sh` (one-command offline check).
- `docs/` — `SPIKES.md` (live tx hashes and measured numbers), `ARCHITECTURE.md`, `plan/` (the frozen plan and
  byte-level interfaces).

## Try it offline in 2 minutes (no keys, no network) — do X, see Y

Every command below was run in a fresh clone of this repo, with no `.env` (`npm ci --include=dev` needs the npm
registry once).

1. `npm ci --include=dev` → installs the 3 runtime packages (`@noble/hashes`, `@noble/curves`, `@scure/base`) plus
   `near-api-js` 7.4.0 for one encoder-parity test. The flag matters: with `NODE_ENV=production` a plain `npm ci`
   skips devDependencies and the parity test cannot import `near-api-js`:

   ```
   added 68 packages, and audited 69 packages
   found 0 vulnerabilities
   ```

2. `npm test` → 97 tests, all pass (byte vectors from nearcore 2.14 and the frozen example, encoder parity with
   near-api-js 7.4.0, outcome/replay/CLI tests, v1 and v2 fixtures, the three audit scenarios):

   ```
   # tests 97
   # pass 97
   # fail 0
   # skipped 0
   ```

3. `npm run zi -- vectors` → 8 lines, all `PASS`:

   ```
   PASS crockford-kat-1
   PASS crockford-kat-2
   PASS crockford-kat-3
   PASS crockford-kat-4
   PASS wallet-0u
   PASS wallet-0s
   PASS example-0u
   PASS example-0s
   ```

4. `npm run zi -- replay fixtures/demo-run.json` → the v2 demo run (invoice ids `INV-1111-V2-A/B/C`), all `PASS`, exit 0;
   the first line says which deployment the fixture was recorded on; among the checks:

   ```
   INFO deployment v2 (current: fixes contract-1/2/3) 4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA
   PASS before-unknown-account INV-1111-V2-A
   PASS pay-tx-success INV-1111-V2-A B7pwrVigiBoziDyFakYa5kFE1JMDkYtg8BNMm2k7XbEz result=PAID
   PASS split-merchant INV-1111-V2-A 0.92
   PASS split-vault INV-1111-V2-A 0.08
   PASS after-status-PAID INV-1111-V2-A
   PASS transfer-path-uninitialized INV-1111-V2-B 1
   PASS sweep-tx-success INV-1111-V2-B HUnCWN2kVy3HQVsVZAL3pL3VrcuJAH6XwxDQUgW8Vyig result=PAID
   PASS refund-event INV-1111-V2-C REFUNDED_UNDERPAID
   ```

5. `npm run zi -- replay fixtures/refund-cases.json` → all `PASS`, exit 0; among them:

   ```
   PASS refund-event REF-UNDER-V2 REFUNDED_UNDERPAID
   PASS refund-event REF-EXPIRED-V2 REFUNDED_EXPIRED
   PASS refund-event REF-TWICE-V2 REFUNDED_NOT_OPEN
   PASS split-merchant REF-OVER-V2 0.092
   PASS transfer-path-uninitialized REF-SWEEPLOW-V2 0.05
   PASS sweep-underpaid-reverted REF-SWEEPLOW-V2 2pw7QeQG8JFvzZNQ1hKGwXTwWohnsiE6Rm8Fp8bRoXJR
   ```

6. `npm run zi -- replay fixtures/audit-scenarios.json` → the three audit findings re-run live on v2, all `PASS`:

   ```
   PASS before-parked-account AUD1-V2 0.1
   PASS pay-tx-success AUD1-V2 678rsqwkrqP6af9EKywJqJzYPKyU9oaFqd9YmRDmjsqm result=REFUNDED_EXPIRED
   PASS split-vault AUD1-V2 0.008
   PASS refund-already-funded AUD3-V2 refunded 0.1 to sm1110-zi-payer.testnet
   PASS transfer-failures-recorded AUD2-V2 1 failed, 1 transfer_failed events
   ```

7. `npm run zi -- replay fixtures/v1/demo-run.json` → the original v1 recordings still replay (v1 is accepted for
   verifying history only, whatever `ZI_CODE_HASH` says); it reports the deployment it replayed:

   ```
   INFO deployment v1 (history, frozen: known limitations contract-1/2/3; verify only, never pay) Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
   PASS pay-tx-success INV-1111-A BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA result=PAID
   PASS sweep-tx-success INV-1111-B 5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa result=PAID
   ```

   `fixtures/v1/refund-cases.json` replays the same way.

One command for the whole judge path: `bash scripts/judge-offline.sh` → `npm ci --include=dev`, `npm test`, `vectors`, the three
v2 replays, the two v1 replays and an offline `verify` of every v2 and v1 invoice (309 `PASS` lines, no `FAIL`); its last line was:

```
JUDGE-OFFLINE: ALL PASS
```

## Check the live testnet claims (read-only, no keys)

The invoices under `invoices/demo/` (v2) and `invoices/v1/` (v1) were paid on testnet (protocol 88). These commands only
read RPC; they work from a clean clone with no `.env`. The default endpoint is `https://test.rpc.fastnear.com`
(`https://rpc.testnet.near.org` started answering HTTP 429 "endpoint is deprecated" on 2026-11-10; set `ZI_RPC_URL` to use
another one).

1. `npm run zi -- verify INV-1111-V2-A` → the address and the state-init bytes are recomputed from the terms and the
   pinned deployed code hash (`ZI_CODE_HASH`, default v2 `4bQ61AgH…yx9zEA`, never the invoice file's own `code_hash`),
   then compared with the chain. It also says which deployment the invoice uses. Any `FAIL` makes the command exit 1:

   ```
   PASS code-hash-trusted 4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA
   INFO deployment v2 (current: fixes contract-1/2/3)
   PASS id-from-terms 0udab1xwq7vv8jx0nxbg79gabtq0y3z31822qyfwh8env9bytrpc90
   PASS raw-from-terms
   PASS doc-fields-from-terms
   PASS code-hash-onchain 4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA
   PASS terms-onchain
   PASS no-access-keys
   INFO status=PAID
   ```

   `npm run zi -- verify INV-1111-A` verifies a v1 invoice against the v1 hash and says
   `INFO deployment v1 (history, frozen: known limitations contract-1/2/3; verify only, never pay)`. `zi pay`, `zi sweep` and
   `zi init` refuse v1 invoices.

2. Open `https://testnet.nearblocks.io/txns/B7pwrVigiBoziDyFakYa5kFE1JMDkYtg8BNMm2k7XbEz` → one transaction with
   exactly two actions, `UniversalStateInit` + `pay`, receiver
   `0udab1xwq7vv8jx0nxbg79gabtq0y3z31822qyfwh8env9bytrpc90`, result `PAID`, and transfers of `0.92` NEAR to
   `sm1110-zi-merchant.testnet` and `0.08` NEAR to `sm1110-zi-taxvault.testnet`. If nearblocks renders `0u…` ids
   poorly, the RPC `tx` method returns the same JSON and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-V2-B` → the invoice that was paid by a plain transfer (no state init) and later
   swept:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=331
   ```

   Plain-transfer tx `FvENy8cNf5S31tgjydtYsHuYtcb15wAq5epWGJBPnTPK`; sweep tx
   `HUnCWN2kVy3HQVsVZAL3pL3VrcuJAH6XwxDQUgW8Vyig`. `paid_by=null` is expected on this path: `sweep()` does not
   know who transferred the funds.

4. Contract integrity: `shasum -a 256 contract/res/zeroinit_invoice.wasm` →
   `3562e978e6924a2c538e9906fc42d15a652947891f18f7816e3c7807d20f622f` (82,942 bytes). That digest is the base58 code hash
   `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`; `zi verify` checks that the invoice account's on-chain
   `global_contract_hash` equals it. This is the exact wasm installed by the v2 global deploy tx
   `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG` (2026-11-10, signer `sm1110-zi-deployer.testnet`, one-time burn:
   8.2949 NEAR). The v1 wasm (digest `912ae75e…c3c9`, hash `Amg4WXKy…GW6k`) was deployed by
   `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h` (burn 7.8526 NEAR); `git show e5581e8:contract/res/zeroinit_invoice.wasm` prints it.

## Run it yourself on testnet

Testnet only: `src/config.ts` refuses any other network and any mainnet RPC URL. You need Node 22.22.x; account
creation uses near-cli-rs. The steps below assume you are in the repo root.

1. Pick a prefix that is still free on testnet; `example` stands for it below. Create four accounts (the legacy
   keychain stores their keys under `~/.near-credentials/testnet/`):

   ```bash
   export P=example
   for a in deployer merchant taxvault payer; do
     near account create-account sponsor-by-faucet-service "$P"-zi-$a.testnet \
       autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
   done
   ```

   Each command prints the new account and a transaction hash. The payer needs a little NEAR; the faucet grant
   is enough for this walkthrough, top up at https://near-faucet.io/ if it is not.

2. No deploy needed: the committed wasm is already a global contract on testnet with code hash
   `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA` (v2). Optionally deploy your own copy (this burns about 8.29 NEAR, the measured cost of
   the v2 deploy above; the hash of an identical wasm is the same, so only a changed wasm gives a new hash):

   ```bash
   near contract deploy-as-global use-file contract/res/zeroinit_invoice.wasm \
     as-global-hash "$P"-zi-deployer.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. `cp .env.example .env` and fill it in (uncomment the account and key lines). `ZI_CODE_HASH` is prefilled with the
   deployed v2 hash `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`; change it only if you deployed your own changed global contract in step 2. Set
   `ZI_PAYER_ACCOUNT=example-zi-payer.testnet`, `ZI_SWEEPER_ACCOUNT=example-zi-merchant.testnet`,
   `ZI_TAXVAULT_ACCOUNT=example-zi-taxvault.testnet`, and for `ZI_PAYER_KEY` / `ZI_SWEEPER_KEY` paste the
   `private_key` values from `~/.near-credentials/testnet/example-zi-payer.testnet.json` and
   `~/.near-credentials/testnet/example-zi-merchant.testnet.json`. `.env` is gitignored: never commit it.
   Load it in every shell with `set -a; source .env; set +a`.

4. Issue an invoice. It needs no key and the address is computed locally; by default it makes two read-only RPC calls
   (network check, and that the merchant and tax vault accounts exist). Add `--offline` to skip them:

   ```bash
   npm run zi -- invoice new --id INV-RUN-1 --merchant example-zi-merchant.testnet \
     --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h
   npm run zi -- status INV-RUN-1
   ```

   ```
   INVOICE INV-RUN-1
   ACCOUNT 0u…                                  (54 characters, derived from the terms and the code hash)
   PAY 0.1 NEAR before 2026-…
   FILE invoices/INV-RUN-1.json
   STATE NONEXISTENT
   ```

5. Pay it in one transaction (signs with `ZI_PAYER_KEY`; the expected shape is from our recorded run, the tx hash
   and account id are yours):

   ```bash
   npm run zi -- pay INV-RUN-1
   ```

   ```
   TX …
   RESULT PAID
   EVENT invoice_paid {"invoice_id":"INV-RUN-1", … "merchant_amount":"92000000000000000000000","tax_amount":"8000000000000000000000", …}
   TRANSFER example-zi-merchant.testnet 0.092
   TRANSFER example-zi-taxvault.testnet 0.008
   LINK https://testnet.nearblocks.io/txns/…
   STATE INITIALIZED status=PAID paid_by=example-zi-payer.testnet balance=0 storage=…
   ```

6. Verify it, then try the wallet path and a refund:

   ```bash
   npm run zi -- verify INV-RUN-1
   # PASS code-hash-trusted / PASS id-from-terms 0u… / PASS raw-from-terms / PASS doc-fields-from-terms / INFO deployment v2 / PASS code-hash-onchain 4bQ61AgH… / PASS terms-onchain /
   # PASS no-access-keys / INFO status=PAID

   npm run zi -- invoice new --id INV-RUN-2 --merchant example-zi-merchant.testnet \
     --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h
   ACC=$(node -e "console.log(require('./invoices/INV-RUN-2.json').account_id)")
   node scripts/plain-transfer.ts "$ACC" 0.1      # a bare Transfer, exactly what a wallet or exchange sends
   npm run zi -- status INV-RUN-2                 # STATE UNINITIALIZED balance=0.1
   npm run zi -- sweep INV-RUN-2                  # RESULT PAID; anyone can send the sweep

   npm run zi -- invoice new --id INV-RUN-3 --merchant example-zi-merchant.testnet \
     --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h
   npm run zi -- pay INV-RUN-3 --amount 0.05      # RESULT REFUNDED_UNDERPAID, 0.05 goes back to the payer
   ```

   On a real TTY, `near tokens example-zi-payer.testnet send-near "$ACC" '0.1 NEAR' network-config testnet
   sign-with-legacy-keychain send` sends the same plain transfer. In our headless runs near-cli-rs printed
   `does not exist on testnet` and then needed an interactive confirmation, so the scripts use
   `scripts/plain-transfer.ts` (same single `Transfer` action, signed with the payer key).

7. Optional local dashboard:

   ```bash
   npm run zi -- serve --port 8787
   # SERVE http://127.0.0.1:8787
   ```

   Open it, create an invoice (no transaction), pay, or send a plain transfer and sweep. The server signs with
   the payer/sweeper keys from `.env` and binds `127.0.0.1` only. Statuses load when the page opens, after each
   action, and when you click **Refresh statuses** (no polling, to stay under public RPC rate limits).

   ![ZeroInit dashboard: INV-SHOT-1 paid on testnet](docs/img/dashboard-pay.png)

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

Contract methods (args are always `{}`; there is no init method, no owner and no key):

| Method | Payable | What it does |
|---|---|---|
| `pay()` | yes | splits the attached deposit per `tax_bps` (92/8 at 800 bps), or refunds it (see the table below) |
| `sweep()` | no | materializes an uninitialized account and splits the parked balance, re-sends a failed tax share, or forwards extra funds |
| `get_invoice()` | view | returns the invoice as JSON (`u64`/`u128` are strings) |
| `get_owed_tax()` | view | tax share not yet confirmed delivered to the vault (v2; `0` after a normal payment) |
| `on_transfer` | private | callback of the merchant/tax transfers (v2): records a failed transfer, clears the owed tax on success |

`pay()` rules, checked in this order (`d` = attached deposit, `now` = block timestamp, `parked` = free balance − `d`):

| # | Condition | Result |
|---|---|---|
| 1 | status is not `OPEN` | `REFUNDED_NOT_OPEN`; `d` goes back to the payer |
| 2 | `now > expires_at_ms` | `REFUNDED_EXPIRED`; status becomes `EXPIRED`; `d` goes back |
| 3 | `parked ≥ amount` (v2) | funds parked by a plain transfer already cover the invoice: they are settled like `sweep()` (`PAID`, `via: "transfer"`) and `d` goes back in full (`payment_refunded`, reason `already_funded`) |
| 4 | `d < amount` | `REFUNDED_UNDERPAID`; status stays `OPEN`; `d` goes back |
| 5 | otherwise | `PAID`: tax = `amount × tax_bps / 10000` (floor) to the tax vault, net to the merchant, any excess `d − amount` back to the payer; status becomes `PAID` |

`sweep()` rules (`avail` = balance − storage reserve; the reserve is 0 while `storage_usage ≤ 770` B):

| # | Condition | Result |
|---|---|---|
| 1 | `OPEN`, or `EXPIRED` and never paid (v2), and `avail ≥ amount` | `PAID` (`late: true` after expiry): tax from `amount` to the vault, everything else (including any overpayment) to the merchant |
| 2 | `OPEN` and `avail < amount` | panics `UNDERPAID: available … < amount …`; the whole receipt reverts and the funds stay parked |
| 3 | `EXPIRED`, never paid, `0 < avail < amount` (v2) | `EXTRA_SWEPT` pro rata: `tax_bps` of `avail` to the vault, the rest to the merchant |
| 4 | `EXPIRED` never paid and `avail == 0`, or `PAID`/`EXPIRED` and `avail == 0` | panics `NOTHING_TO_SWEEP` |
| 5 | `PAID`/`EXPIRED` (after a payment) and `avail > 0` | first re-sends the owed tax (up to `avail`) to the tax vault (`tax_resent`; `TAX_RESENT` if nothing else is left), then `EXTRA_SWEPT`: the rest goes to the merchant |

Transactions (hand-encoded V0, ed25519 over SHA-256, because near-api-js 7.4.0 cannot serialize action 15):

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY | payer | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 50 Tgas, deposit = amount}]` |
| SWEEP | anyone | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 50 Tgas, 0}]` |
| PLAIN TRANSFER | any wallet | invoice `0u…` id | `[Transfer{amount}]` |

Each state change emits an `EVENT_JSON:` log line (`invoice_paid`, `payment_refunded`, `extra_swept`, and in v2
`transfer_failed`, `tax_resent`); `zi` prints it as `EVENT …` and `zi replay` parses the JSON. Merchant and tax
transfers are separate receipts with an `on_transfer` callback (v2). If one fails (for example the recipient account
does not exist), NEAR returns the amount to the invoice account, the callback emits `transfer_failed` (which supersedes
the optimistic amounts of `invoice_paid`), the tax share stays owed, and a later `sweep` re-sends it to the tax vault
only (see "v1 → v2"). `zi pay` / `zi sweep` print the failed receipt as `TRANSFER_FAILED …` and exit 1.

## Claims and how to verify each

| Claim | Verify with | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in, so no `.env` is needed; without `--offline` it also checks over RPC that merchant and tax vault exist on testnet) | `INVOICE`/`ACCOUNT`/`PAY`/`FILE` lines; no RPC call |
| The address commits to the terms and code | `npm run zi -- verify INV-1111-V2-A --offline` | `PASS code-hash-trusted 4bQ61AgH…`, `INFO deployment v2 (current…`, `PASS id-from-terms 0udab1xw…rpc90`, `PASS raw-from-terms` |
| One tx creates + pays + splits | `npm run zi -- replay fixtures/demo-run.json` (or the nearblocks link in the previous section) | `PASS pay-tx-success INV-1111-V2-A B7pwrVig… result=PAID`, `PASS split-merchant INV-1111-V2-A 0.92`, `PASS split-vault INV-1111-V2-A 0.08` |
| Plain transfers are safe before init | `npm run zi -- replay fixtures/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-V2-B 1`, `PASS sweep-tx-success INV-1111-V2-B HUnCWN2k… result=PAID` |
| Nobody holds keys to invoice accounts | `npm run zi -- verify INV-1111-V2-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| Underpay / expired / double pay are refunded | `npm run zi -- replay fixtures/refund-cases.json` | `PASS refund-event REF-UNDER-V2 REFUNDED_UNDERPAID`, `PASS refund-event REF-EXPIRED-V2 REFUNDED_EXPIRED`, `PASS refund-event REF-TWICE-V2 REFUNDED_NOT_OPEN` |
| The tax vault is not skipped after expiry (contract-1) | `npm run zi -- replay fixtures/audit-scenarios.json` | `PASS refund-event AUD1-V2 REFUNDED_EXPIRED`, `PASS sweep-tx-success AUD1-V2 8WQr2GUm… result=PAID`, `PASS split-vault AUD1-V2 0.008` |
| A payer who already sent a plain transfer is not charged twice (contract-3) | same replay | `PASS refund-already-funded AUD3-V2 refunded 0.1 to sm1110-zi-payer.testnet`, `PASS split-vault AUD3-V2 0.008` |
| A failed transfer is recorded, the tax stays owed (contract-2) | same replay | `PASS transfer-failures-recorded AUD2-V2 1 failed, 1 transfer_failed events`, `PASS sweep-tx-success AUD2-V2 7z45ySFY… result=TAX_RESENT` |
| The deployed code is the committed wasm | `shasum -a 256 contract/res/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-V2-A` | digest `3562e978…f622f` = base58 `4bQ61AgH…yx9zEA`; `PASS code-hash-onchain` |
| The v1 recordings still check out (history) | `npm run zi -- replay fixtures/v1/demo-run.json` and `npm run zi -- verify INV-1111-A --offline` | `INFO deployment v1 (history, frozen…`, all `PASS` |

## Limits (honest)

- **NEAR only.** FT / stablecoin invoices (NEP-141 `ft_transfer_call`) are not implemented.
- **Testnet only.** `src/config.ts` refuses a non-testnet network or a mainnet RPC URL, and every signing path (the CLI,
  the dashboard server, `scripts/plain-transfer.ts`) asserts RPC `chain_id == testnet` before it uses a key; mainnet was not tested.
- **Exit codes.** `zi verify`, `zi receipt` and `zi replay` exit 1 on any failed check. `zi pay` exits 1 unless the result is
  `PAID` (a `REFUNDED_*` result means the deposit came back); the dashboard answers 409 with `paid:false` in that case. `zi pay` and `zi sweep` also exit 1 (with a `WARNING` and
  `TRANSFER_FAILED` lines) when a transfer failed downstream, even if the contract returned `PAID`.
- **Contract limits that stay (v2).** The contract cannot reject a bad merchant/tax-vault at pay time: `zi invoice new` and the
  dashboard therefore check that both exist on testnet (`--offline` skips the check). With v2 a missing tax vault is recorded
  (`transfer_failed`) and its share stays owed, but a hand-made invoice with a missing merchant still has its share stranded on
  the invoice account. The `invoice_paid` event is still emitted before the transfers run: atomicity is not claimed.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is
  the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a
  fallback, but every result in this README is `0u`.
- **The payer pays for the first touch.** Gas plus the protocol's 0.007 NEAR account-creation charge: measured
  **0.0077197 NEAR** of tokens burnt on v2 (v1: 0.0073617847981195 NEAR, the extra is the two `on_transfer` callbacks) on a
  0.1 NEAR invoice. Issuing costs nothing.
- **Plain-transfer overpayments go to the merchant.** `sweep()` cannot know the payer, so everything parked
  above `amount` is forwarded to the merchant with the net amount. With `pay()` the excess is refunded to the payer.
- **Merchant and tax vault must exist.** `zi invoice new` and the dashboard check that both exist on testnet
  (`--offline` skips the check). The contract cannot: see contract-2 and its residual under "v1 → v2".
- **No checksum.** A mistyped `0u…` address is still a valid address for different bytes; funds sent to a wrong
  id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
- **Wallet support is untested.** We tested exchange-style `Transfer`s built by near-cli-rs / our CLI. Which
  browser wallets accept a `0u…` receiver is not verified (the wallet check was not run; see `docs/SPIKES.md`).
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no
  webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope for now:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u`
  dual UI, a reproducible-build Docker pipeline, and any indexer.

## v1 → v2

The first contract (**v1**, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`, deploy tx
`DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`) was a global contract, so it cannot be changed: an audit found three
issues in it, and a fix means a new wasm and a new hash. **v2** (code hash `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`,
deploy tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG`, 82,942 bytes, one-time burn 8.2949 NEAR) fixes them and is
the **current, default** deployment. v1 stays on testnet as recorded history. Borsh state layout, method names, args,
error strings and the existing events are unchanged; v2 only adds. Because an invoice id derives from the code hash,
the same terms give a different address under v2 (the v2 invoices are new, `-V2` ids).

| | v1 limit (audit) | v2 fix | Live evidence on v2 (replay offline: `fixtures/audit-scenarios.json`) |
|---|---|---|---|
| **contract-1** (medium) | A payer's plain transfer is parked before expiry; after `expires_at_ms` anyone sends the PAY shape with a 0 deposit, `pay()` sets `EXPIRED`, and the later `sweep()` forwards everything to the merchant as `EXTRA_SWEPT`: the tax vault gets 0 and the record shows `paid_amount 0`. | `sweep()` treats `EXPIRED` with `paid_amount == 0` like `OPEN`: `avail ≥ amount` settles 92/8 (`PAID`, `late: true`); less than `amount` is released pro rata (`tax_bps` to the vault). The merchant never receives the tax share of funds that arrived before a payment. | `AUD1-V2`: plain transfer `5CuBjV7tkVt5U6kCrmvjikvgKKcwdKwsqVED2Wyy7arH`, zero-deposit pay after expiry `678rsqwkrqP6af9EKywJqJzYPKyU9oaFqd9YmRDmjsqm` (`REFUNDED_EXPIRED`, the 0.1 NEAR stays parked), sweep `8WQr2GUmH5ojoB1zniD2G4Q6V7PiRk2zjLUyYLpB4GNg` → `PAID`, 0.092 to the merchant and **0.008 to the tax vault**, record `tax_amount` 0.008. |
| **contract-3** (low) | `pay()` looks only at the attached deposit: a payer who first sent a plain transfer and then paid is charged twice, and the first amount reaches the merchant untaxed. | `pay()` on an `OPEN`, unexpired invoice whose free balance minus the deposit already covers `amount` settles the parked funds like `sweep()` and refunds the whole deposit (`payment_refunded`, reason `already_funded`). | `AUD3-V2`: plain transfer `4Eon125bA7ujoLgku6DYoQ6XjgrvMd1aVq4hZGfkwysK`, then pay `3YPLdAp58fc8Fz6kTinRpQfXyT28ExmVY3NGXjL3p4WX` → `PAID`, 0.1 NEAR back to the payer, one 92/8 split (0.092 / 0.008), 0 left on the invoice. |
| **contract-2** (low) | A failed merchant/tax transfer (a valid id of a missing account) bounces to the invoice account while the record already says PAID; a bounced tax share later went to the merchant. | Merchant and tax transfers carry an `on_transfer` callback: a failure emits `transfer_failed`, the tax share is tracked as owed (`OWED_TAX`, outside the frozen state; view `get_owed_tax()`), and a later `sweep()` re-sends it to the tax vault only (`tax_resent`, `TAX_RESENT`). | `AUD2-V2` (tax vault `unregistered.sm1110-zi-taxvault.testnet`, a nonexistent subaccount that only our own tax-vault account could ever create): pay `ARgzUkMKTZE46DkHVrjjHMqEQUWNMRqJ4QvTT1JaRYeg` → `PAID` + `transfer_failed` (role tax, 0.008) and 0.008 back on the invoice; sweep `7z45ySFYduzwEDAQVneYZHHyjyV9gkGYHQqTe2szgRqj` → `TAX_RESENT` to the vault only, no `extra_swept` to the merchant. |

The v1 behaviour above comes from the audit and the v1 code; v1 invoices were not re-run live (they stay as the recorded
history). The `audit_contract_*` unit tests in `contract/src/lib.rs` pass on v2 (`cargo test`: 14 tests). Each one replays an audit scenario step by step;
the v1 behaviour they guard against is what the audit traced in the v1 code (`git show 98d571d:contract/src/lib.rs`)
and is not re-run as a test here.

What v2 does **not** fix (residual): `invoice_paid` is still emitted before the transfers run, so the record can say PAID
before a transfer fails (`transfer_failed` supersedes it; atomicity is **not** claimed); extra funds that arrive while a
tax transfer is still in flight (about a block) can be sent to the vault as the owed share; a payer's plain transfer that
covers only part of `amount`, followed by a full `pay()`, is not refunded: the full pay settles the invoice and the
parked part later reaches the merchant untaxed through `sweep()` (the CLI's `zi pay` refuses when funds are already
parked, so use `zi sweep` there); a merchant account that does
not exist still cannot receive its share, which stays parked on the invoice, so `zi invoice new` and the dashboard keep
checking that both accounts exist. v2 costs a little more gas: the pay tx burns 0.0077197 NEAR in total against 0.0073621
for v1 (both from the recorded demo runs, 15.5 vs 11.5 Tgas over all receipts), and storage after a normal `pay()` is
358 B (v1: 352 B), 429 B while a tax share is owed, all below the 770 B zero-balance limit.

How the client handles both: `src/config.ts` keeps a list of known deployments (v2 current, v1 historical). The default
trusted hash, `.env.example`, `zi invoice new`, `zi pay`, `zi sweep`, `zi init` and the dashboard use v2 (or `ZI_CODE_HASH`
when you pin your own). v1 is accepted **only to verify recorded history**: `zi verify`, `zi receipt` and `zi replay` check a
v1 invoice or fixture against the v1 hash, and `zi verify` prints which deployment an invoice uses (`INFO deployment v2
(current…)` or `INFO deployment v1 (history…)`); `pay`, `sweep` and `init` refuse a v1 invoice. A foreign hash is never
accepted. The v1 mitigation in `zi pay` (refuse to pay when a plain transfer already parked funds, `--allow-parked`
overrides) stays for any hash that is not known to fix contract-3, and is off for v2.

## Pre-hackathon code

There is no code from before the hackathon window. The repository's first commit (`38fc3f0`, 2026-11-10) is the
frozen plan, and it contains `docs/plan/reference/`: a reference implementation (the TypeScript sources, tests and
the contract) that was **drafted with Claude during the planning phase of this hackathon (2026-11-08/09)**, not
before it. Task T02 (`9c4faf7`, "scaffold the repo from reference/") copied it verbatim into `src/` and
`contract/`. The v1 deployed contract was that reference contract; v2 is the same contract with the audit fixes (see "v1 → v2"). `src/outcome.ts`, `tx.ts` and `vectors.ts` are still
unchanged from it; `bytes.ts`, `config.ts`, `rpc.ts`, `send.ts` and `stateinit.ts` were later changed by the audit fixes
(range checks, the pinned code hash, the testnet check). Anyone reading a diff that
starts after `38fc3f0` therefore does not see that code; to see the whole history use
`git log --reverse` (or the diff from the first commit, inclusive). What was added after the reference:
the scaffold and toolchain, the live testnet spikes and their fixtures (`docs/SPIKES.md`, `fixtures/`), the replay and
dashboard server extensions (`src/replay.ts`, `src/server.ts`, `web/`), the scripts (`scripts/`), the extra tests,
the docs and the review fixes (including the audit fixes: pinned code hash, issuance validation, exit codes), and the v2
work after the audit (contract fixes, known-deployments list, re-recorded fixtures, `fixtures/v1/`).
Test vectors are copied from nearcore (MIT/Apache-2.0), cited inline. A compare link
(`https://github.com/erhantrk/zeroinit/compare/...hackathon-submission`) is added to this section once the repo is public and the tag exists:
see `docs/SUBMISSION.md`.

## AI use disclosure

- **Claude (Anthropic), planning phase.** The plan and the reference implementation (most of `src/*.ts` and
  `contract/src/lib.rs`, copied verbatim in T02) were written by Claude.
- **DeepSeek v4.1 Flash** (`deepseek/deepseek-v4.1-flash`, max effort), running in Command Code agent sessions
  orchestrated by Conductor (a Claude Code based orchestrator): the scaffold, the live testnet spikes, the
  fixtures, the scripts, the dashboard/server additions, the docs and the per-day review fixes.
- **Claude Sonnet 5.5:** the daily code reviews, the last fix after the final review (`ee4ac44`, co-authored by
  Claude Sonnet) and the audit fixes. **The v2 work** (contract v2, the known-deployments client changes, the
  re-recorded v2 fixtures and live audit scenarios, the docs) was written by Claude Sonnet 5.5; the live v2 recordings
  were run by it with the operator-approved testnet accounts.
- **Claude Opus 5.5:** the final review, the audit, and the operator role (testnet accounts, funding and the global
  contract deploys, T04/T05; **the v2 global deploy** `DvNnUtvq…szAFKG` and the funding for the v2 runs).
- **Human:** Erhan. Every protocol claim is checked by a test or an on-chain transaction listed above.

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1,
cargo-near 0.23.0, near-cli-rs 0.31.1. Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5.

## Other project by the same builder (NEAR HACKATHON rule Q-015)

Erhan also submits **ProvenExit**: https://github.com/erhantrk/provenexit. The two projects are independent and
share no code.

## License

MIT, see LICENSE.
