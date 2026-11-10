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
- Global contracts: the invoice code is deployed once by hash (`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`);
  each invoice only references it.

## Repo map

- `contract/` — the immutable invoice contract (Rust, near-sdk 5.30.1) and the exact wasm that is deployed:
  `contract/res/zeroinit_invoice.wasm`.
- `src/` — the `zi` CLI, the frozen byte encoders (`bytes.ts`, `stateinit.ts`, `tx.ts`), RPC client, outcome
  parser, invoice docs, replay, and the optional local dashboard (`server.ts`).
- `fixtures/` — recorded RPC sessions that replay offline: `demo-run.json`, `refund-cases.json` (real), plus
  `synthetic-demo.json` (marked synthetic, used by a parser test only).
- `invoices/examples/INV-0001.json` — the frozen test-vector invoice; `invoices/demo/` — the invoices that were
  actually paid on testnet (they contain no secrets).
- `scripts/` — `demo.sh` (the recorded demo), `plain-transfer.ts` (a bare `Transfer`, the exchange path),
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

2. `npm test` → 64 tests, all pass (byte vectors from nearcore 2.14 and the frozen example, encoder parity with
   near-api-js 7.4.0, outcome/replay/CLI tests):

   ```
   # tests 64
   # pass 64
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

4. `npm run zi -- replay fixtures/demo-run.json` → all `PASS`, exit 0; among them:

   ```
   PASS before-unknown-account INV-1111-A
   PASS pay-tx-success INV-1111-A BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA result=PAID
   PASS split-merchant INV-1111-A 0.92
   PASS split-vault INV-1111-A 0.08
   PASS after-status-PAID INV-1111-A
   PASS transfer-path-uninitialized INV-1111-B 1
   PASS sweep-tx-success INV-1111-B 5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa result=PAID
   ```

5. `npm run zi -- replay fixtures/refund-cases.json` → all `PASS`, exit 0; among them:

   ```
   PASS refund-event REF-UNDER REFUNDED_UNDERPAID
   PASS refund-event REF-EXPIRED REFUNDED_EXPIRED
   PASS refund-event REF-TWICE REFUNDED_NOT_OPEN
   PASS split-merchant REF-OVER 0.092
   PASS transfer-path-uninitialized REF-SWEEPLOW 0.05
   PASS sweep-underpaid-reverted REF-SWEEPLOW 6DGQAdk46AnRxJuN8ZHgjxBw7vkJeMxesGgDj2KNd7sW
   ```

One command for the whole judge path: `bash scripts/judge-offline.sh` → `npm ci --include=dev`, `npm test`, `vectors`, both
replays and an offline `verify` of every demo invoice; its last line was:

```
JUDGE-OFFLINE: ALL PASS
```

## Check the live testnet claims (read-only, no keys)

The invoices under `invoices/demo/` were paid on testnet (protocol 88). These commands only read RPC; they work
from a clean clone with no `.env`. The default endpoint is `https://rpc.testnet.near.org`; if it rate-limits, set
`ZI_RPC_URL=https://test.rpc.fastnear.com`.

1. `npm run zi -- verify INV-1111-A` → the address and the state-init bytes are recomputed from the terms and the
   pinned deployed code hash (`ZI_CODE_HASH`, default `Amg4WXKy…GW6k`, never the invoice file's own `code_hash`),
   then compared with the chain. Any `FAIL` makes the command exit 1:

   ```
   PASS code-hash-trusted Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
   PASS id-from-terms 0u4kwsbdsf5s5dfzp6wjaeq5ces9sajpv8hwmsp52a9e5bz30ave60
   PASS raw-from-terms
   PASS doc-fields-from-terms
   PASS code-hash-onchain Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
   PASS terms-onchain
   PASS no-access-keys
   INFO status=PAID
   ```

2. Open `https://testnet.nearblocks.io/txns/BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA` → one transaction with
   exactly two actions, `UniversalStateInit` + `pay`, receiver
   `0u4kwsbdsf5s5dfzp6wjaeq5ces9sajpv8hwmsp52a9e5bz30ave60`, result `PAID`, and transfers of `0.92` NEAR to
   `sm1110-zi-merchant.testnet` and `0.08` NEAR to `sm1110-zi-taxvault.testnet`. If nearblocks renders `0u…` ids
   poorly, the RPC `tx` method returns the same JSON and `zi replay` checks it offline.

3. `npm run zi -- status INV-1111-B` → the invoice that was paid by a plain transfer (no state init) and later
   swept:

   ```
   STATE INITIALIZED status=PAID paid_by=null balance=0 storage=328
   ```

   Plain-transfer tx `2eXsHhHMnLcRgdyNW1Eyc6mvaGLtCggP13XLYrYErngC`; sweep tx
   `5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa`. `paid_by=null` is expected on this path: `sweep()` does not
   know who transferred the funds.

4. Contract integrity: `shasum -a 256 contract/res/zeroinit_invoice.wasm` →
   `912ae75e72dd90173a8e0c6c3225927b7a68ae66788df704c8bf8979c543c3c9`. That digest is the base58 code hash
   `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`; `zi verify` checks that the invoice account's on-chain
   `global_contract_hash` equals it. This is the exact wasm installed by the global deploy tx
   `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h` (one-time burn: 7.8526 NEAR).

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
   `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`. Optionally deploy your own copy (this burns about 7.85 NEAR,
   the measured cost of the deploy above, and gives a new hash):

   ```bash
   near contract deploy-as-global use-file contract/res/zeroinit_invoice.wasm \
     as-global-hash "$P"-zi-deployer.testnet network-config testnet sign-with-legacy-keychain send
   ```

3. `cp .env.example .env` and fill it in (uncomment the account and key lines). `ZI_CODE_HASH` is prefilled with the
   deployed hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`; change it only if you deployed your own global contract in step 2. Set
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
   # PASS code-hash-trusted / PASS id-from-terms 0u… / PASS raw-from-terms / PASS doc-fields-from-terms / PASS code-hash-onchain Amg4WXKy… / PASS terms-onchain /
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
   the payer/sweeper keys from `.env` and binds `127.0.0.1` only.

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
| `sweep()` | no | materializes an uninitialized account and splits the parked balance, or forwards extra funds |
| `get_invoice()` | view | returns the invoice as JSON (`u64`/`u128` are strings) |

`pay()` rules, checked in this order (`d` = attached deposit, `now` = block timestamp):

| # | Condition | Result |
|---|---|---|
| 1 | status is not `OPEN` | `REFUNDED_NOT_OPEN`; `d` goes back to the payer |
| 2 | `now > expires_at_ms` | `REFUNDED_EXPIRED`; status becomes `EXPIRED`; `d` goes back |
| 3 | `d < amount` | `REFUNDED_UNDERPAID`; status stays `OPEN`; `d` goes back |
| 4 | otherwise | `PAID`: tax = `amount × tax_bps / 10000` (floor) to the tax vault, net to the merchant, any excess `d − amount` back to the payer; status becomes `PAID` |

`sweep()` rules (`avail` = balance − storage reserve; the reserve is 0 while `storage_usage ≤ 770` B):

| # | Condition | Result |
|---|---|---|
| 1 | `OPEN` and `avail < amount` | panics `UNDERPAID: available … < amount …`; the whole receipt reverts and the funds stay parked |
| 2 | `OPEN` and `avail ≥ amount` | `PAID`: tax from `amount` to the vault, everything else (including any overpayment) to the merchant |
| 3 | `PAID`/`EXPIRED` and `avail == 0` | panics `NOTHING_TO_SWEEP` |
| 4 | `PAID`/`EXPIRED` and `avail > 0` | `EXTRA_SWEPT`: all `avail` goes to the merchant |

Transactions (hand-encoded V0, ed25519 over SHA-256, because near-api-js 7.4.0 cannot serialize action 15):

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY | payer | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 50 Tgas, deposit = amount}]` |
| SWEEP | anyone | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 50 Tgas, 0}]` |
| PLAIN TRANSFER | any wallet | invoice `0u…` id | `[Transfer{amount}]` |

Each state change emits an `EVENT_JSON:` log line (`invoice_paid`, `payment_refunded`, `extra_swept`); `zi`
prints it as `EVENT …` and `zi replay` parses the JSON. Transfers are separate receipts created by the call. If one
fails (e.g. a deleted recipient), NEAR returns the amount to the invoice account, where `sweep` can forward it to
the merchant later (EXTRA_SWEPT).

## Claims and how to verify each

| Claim | Verify with | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h --offline` (the deployed code hash is built in, so no `.env` is needed; without `--offline` it also checks over RPC that merchant and tax vault exist on testnet) | `INVOICE`/`ACCOUNT`/`PAY`/`FILE` lines; no RPC call |
| The address commits to the terms and code | `npm run zi -- verify INV-1111-A --offline` | `PASS code-hash-trusted`, `PASS id-from-terms 0u4kwsbd…ave60`, `PASS raw-from-terms` |
| One tx creates + pays + splits | `npm run zi -- replay fixtures/demo-run.json` (or the nearblocks link in the previous section) | `PASS pay-tx-success INV-1111-A BdzRBcFf… result=PAID`, `PASS split-merchant INV-1111-A 0.92`, `PASS split-vault INV-1111-A 0.08` |
| Plain transfers are safe before init | `npm run zi -- replay fixtures/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-B 1`, `PASS sweep-tx-success INV-1111-B 5P2rkpk… result=PAID` |
| Nobody holds keys to invoice accounts | `npm run zi -- verify INV-1111-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| Underpay / expired / double pay are refunded | `npm run zi -- replay fixtures/refund-cases.json` | `PASS refund-event REF-UNDER REFUNDED_UNDERPAID`, `PASS refund-event REF-EXPIRED REFUNDED_EXPIRED`, `PASS refund-event REF-TWICE REFUNDED_NOT_OPEN` |
| The deployed code is the committed wasm | `shasum -a 256 contract/res/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-A` | digest `912ae75e…c3c9` = base58 `Amg4WXKy…GW6k`; `PASS code-hash-onchain` |

## Limits (honest)

- **NEAR only.** FT / stablecoin invoices (NEP-141 `ft_transfer_call`) are not implemented.
- **Testnet only.** `src/config.ts` refuses a non-testnet network or a mainnet RPC URL, and every signing path (the CLI,
  the dashboard server, `scripts/plain-transfer.ts`) asserts RPC `chain_id == testnet` before it uses a key; mainnet was not tested.
- **Exit codes.** `zi verify`, `zi receipt` and `zi replay` exit 1 on any failed check. `zi pay` exits 1 unless the result is
  `PAID` (a `REFUNDED_*` result means the deposit came back); the dashboard answers 409 with `paid:false` in that case.
- **Contract limits that stay.** The frozen contract cannot reject a bad merchant/tax-vault at pay time: `zi invoice new` and the
  dashboard therefore check that both exist on testnet (`--offline` skips the check), but a hand-made invoice with a missing
  merchant would still be marked PAID with the split stranded.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is
  the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a
  fallback, but every result in this README is `0u`.
- **The payer pays for the first touch.** Gas plus the protocol's 0.007 NEAR account-creation charge: measured
  **0.0073617847981195 NEAR** on a 0.1 NEAR invoice. Issuing costs nothing.
- **Plain-transfer overpayments go to the merchant.** `sweep()` cannot know the payer, so everything parked
  above `amount` is forwarded to the merchant with the net amount. With `pay()` the excess is refunded to the payer.
- **Merchant and tax vault must exist.** `zi invoice new` and the dashboard check that both exist on testnet
  (`--offline` skips the check). The contract cannot: see contract-2 under "Known limitations (contract v1, frozen)".
- **No checksum.** A mistyped `0u…` address is still a valid address for different bytes; funds sent to a wrong
  id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
- **Wallet support is untested.** We tested exchange-style `Transfer`s built by near-cli-rs / our CLI. Which
  browser wallets accept a `0u…` receiver is not verified (the wallet check was not run; see `docs/SPIKES.md`).
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no
  webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope for now:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u`
  dual UI, a reproducible-build Docker pipeline, and any indexer.

## Known limitations (contract v1, frozen)

The contract is deployed as a global contract by code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` and every
recorded fixture depends on that hash, so these three issues from our final audit are **documented, not fixed**. A
fix means a new wasm, a new hash and new fixtures (a v2). The CLI and dashboard reduce but do not remove them.
Atomicity is **not** claimed: `pay()` and `sweep()` update the record and emit `invoice_paid` in the same receipt as
they schedule the transfers, and the transfers are detached (no callback), so the record can say PAID before a
transfer has succeeded or failed.

- **contract-1 (medium): tax can be skipped on a transfer-paid invoice.** Scenario: a payer's exchange sends the
  amount as a plain transfer before expiry (funds parked, nobody has swept). After `expires_at_ms` anyone (for
  example the merchant) sends the PAY shape with a 0 deposit. `pay()` refunds 0 and sets status `EXPIRED`. A later
  `sweep()` sees a non-OPEN invoice and forwards the whole balance to the merchant as `EXTRA_SWEPT`, with no tax
  share. Impact: the tax vault gets 0 instead of `tax_bps`, and the record shows `EXPIRED`, `paid_amount 0`,
  `tax_amount 0` although the merchant was paid. Sweeping before expiry splits correctly (92/8, `late` set as
  needed), so a tax authority or payer-side watcher should sweep transfer-paid invoices before `expires_at_ms`.
  v2 fix: in `sweep()` apply the split to any funds that arrive while `paid_amount == 0`, even after `EXPIRED`
  (or never set `EXPIRED` from a zero or underpaid deposit), and always route `tax_bps` of extra-swept funds to
  the vault.
- **contract-2 (low): a failed transfer after PAID leaves a false PAID record.** Scenario: the merchant or tax vault
  is a syntactically valid account id that does not exist. Its detached transfer fails and the funds bounce back to
  the invoice account, but the record and event already say PAID with the full split. For a missing tax vault a
  later `sweep()` forwards the bounced tax share to the merchant (`EXTRA_SWEPT`); for a missing merchant the funds
  stay stuck, and whoever registers that name later receives them on the next sweep. Mitigation in v1: `zi invoice
  new` and the dashboard refuse to issue an invoice when either account does not exist (a hand-made invoice
  bypasses this). v2 fix: `then()` callbacks that record failed transfers and retry a failed tax share to the vault
  only (for example a `pending_tax` field).
- **contract-3 (low): `pay()` ignores funds already parked.** Scenario: the payer first sends the amount as a plain
  transfer (nothing visibly happens), then runs `zi pay`. `pay()` looks only at the attached deposit, settles a
  second amount (92/8, PAID), and the first amount stays parked until `sweep()` sends it to the merchant as
  `EXTRA_SWEPT`, with no tax share and no refund because the payer is unknown. Impact: the payer is charged twice,
  the vault gets 0.08 instead of 0.16 on a 1 NEAR invoice. Mitigation in v1: `zi pay` checks the account first and
  refuses to pay when a balance is already parked (it tells you to run `zi sweep`; `--allow-parked` overrides). v2 fix: in `pay()`, if status is OPEN and the free balance minus the
  deposit already covers `amount`, settle the parked funds as `sweep()` does and refund the deposit in full.

## Contract v2 (fixes contract-1/2/3; built, not yet deployed)

`contract/src/lib.rs` now fixes the three issues above. v1 stays deployed as history; v2 is a new global contract
(new hash, to be deployed by the operator; `ZI_CODE_HASH`, `src/config.ts` and the fixtures still point at v1).
Borsh state layout, method names, args, error strings and the existing events are unchanged. Additions only:

- **contract-1:** `sweep()` treats `EXPIRED` with `paid_amount == 0` like `OPEN`: funds `>= amount` settle 92/8
  (`PAID`, `late: true`). Less than `amount` on an expired, never-paid invoice is released pro rata (`tax_bps` to the
  vault, rest to the merchant, event `extra_swept` with extra `tax_amount`/`tax_to` fields). The merchant never
  receives a tax share of funds that arrived before a successful payment.
- **contract-3:** `pay()` on an `OPEN`, unexpired invoice whose free balance minus the attached deposit already
  covers `amount` settles the parked funds like `sweep()` (`via: "transfer"`, `paid_by: null`) and refunds the whole
  deposit (`payment_refunded`, new `reason: "already_funded"`). Returns `PAID`.
- **contract-2:** merchant and tax transfers carry an `on_transfer` callback (`#[private]`, borsh args, 10 TGas
  each). The tax share is recorded as *owed* in a separate storage key `OWED_TAX` (outside the frozen state, so
  the account id derivation is unchanged; ~70 bytes, still under the ZBA limit) when it is sent and cleared by
  the success callback. A failed transfer emits `transfer_failed` (new event; it supersedes the optimistic
  `invoice_paid` amounts) and leaves the tax owed. A later `sweep()` re-sends up to the owed amount to the tax vault
  only (event `tax_resent`, returns `TAX_RESENT` if nothing else is left) and anything beyond that to the merchant
  (`EXTRA_SWEPT`). New view `get_owed_tax()`. Residual: `invoice_paid` is still emitted before the transfers run
  (it cannot know the outcome), extra funds that arrive while a tax transfer is still in flight (about a block) can
  be sent to the vault as the owed share, and a merchant account that does not exist still cannot receive its share
  (it stays parked on the invoice; the CLI check at issue time remains the mitigation).

## Pre-hackathon code

There is no code from before the hackathon window. The repository's first commit (`38fc3f0`, 2026-11-10) is the
frozen plan, and it contains `docs/plan/reference/`: a reference implementation (the TypeScript sources, tests and
the contract) that was **drafted with Claude during the planning phase of this hackathon (2026-11-08/09)**, not
before it. Task T02 (`9c4faf7`, "scaffold the repo from reference/") copied it verbatim into `src/` and
`contract/`. The deployed contract is that reference contract. `src/outcome.ts`, `tx.ts` and `vectors.ts` are still
unchanged from it; `bytes.ts`, `config.ts`, `rpc.ts`, `send.ts` and `stateinit.ts` were later changed by the audit fixes
(range checks, the pinned code hash, the testnet check). Anyone reading a diff that
starts after `38fc3f0` therefore does not see that code; to see the whole history use
`git log --reverse` (or the diff from the first commit, inclusive). What was added after the reference:
the scaffold and toolchain, the live testnet spikes and their fixtures (`docs/SPIKES.md`, `fixtures/`), the replay and
dashboard server extensions (`src/replay.ts`, `src/server.ts`, `web/`), the scripts (`scripts/`), the extra tests,
the docs and the review fixes (including the audit fixes: pinned code hash, issuance validation, exit codes).
Test vectors are copied from nearcore (MIT/Apache-2.0), cited inline. A compare link
(`<REPO_URL>/compare/...hackathon-submission`) is added to this section once the repo is public and the tag exists:
see `docs/SUBMISSION.md`.

## AI use disclosure

- **Claude (Anthropic), planning phase.** The plan and the reference implementation (most of `src/*.ts` and
  `contract/src/lib.rs`, copied verbatim in T02) were written by Claude.
- **DeepSeek v4.1 Flash** (`deepseek/deepseek-v4.1-flash`, max effort), running in Command Code agent sessions
  orchestrated by Conductor (a Claude Code based orchestrator): the scaffold, the live testnet spikes, the
  fixtures, the scripts, the dashboard/server additions, the docs and the per-day review fixes.
- **Claude Sonnet 5.5:** the daily code reviews, the last fix after the final review (`ee4ac44`, co-authored by
  Claude Sonnet) and the audit fixes.
- **Claude Opus 5.5:** the final review, the audit, and the operator role (testnet accounts, funding and the global
  contract deploy, T04/T05).
- **Human:** Erhan. Every protocol claim is checked by a test or an on-chain transaction listed above.

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1,
cargo-near 0.23.0, near-cli-rs 0.31.1. Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5.

## Other project by the same builder (NEAR HACKATHON rule Q-015)

Erhan also submits **ProvenExit**: <SIBLING_REPO_URL>. The two projects are independent and
share no code.

## License

MIT, see LICENSE.
