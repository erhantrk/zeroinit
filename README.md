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

Every command below was run in a fresh clone of this repo, with no `.env` (`npm ci` needs the npm registry once).

1. `npm ci` → installs the 3 runtime packages (`@noble/hashes`, `@noble/curves`, `@scure/base`) plus
   `near-api-js` 7.4.0 for one encoder-parity test:

   ```
   added 68 packages, and audited 69 packages
   found 0 vulnerabilities
   ```

2. `npm test` → 26 tests, all pass (byte vectors from nearcore 2.14 and the frozen example, encoder parity with
   near-api-js 7.4.0, outcome/replay/CLI tests):

   ```
   # tests 26
   # pass 26
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

4. `npm run zi -- replay fixtures/demo-run.json` → 20 lines, all `PASS`, exit 0; among them:

   ```
   PASS before-unknown-account INV-1111-A
   PASS pay-tx-success INV-1111-A BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA result=PAID
   PASS split-merchant INV-1111-A 0.92
   PASS split-vault INV-1111-A 0.08
   PASS after-status-PAID INV-1111-A
   PASS transfer-path-uninitialized INV-1111-B 1
   PASS sweep-tx-success INV-1111-B 5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa result=PAID
   ```

5. `npm run zi -- replay fixtures/refund-cases.json` → 33 lines, all `PASS`, exit 0; among them:

   ```
   PASS refund-event REF-UNDER REFUNDED_UNDERPAID
   PASS refund-event REF-EXPIRED REFUNDED_EXPIRED
   PASS refund-event REF-TWICE REFUNDED_NOT_OPEN
   PASS split-merchant REF-OVER 0.092
   PASS transfer-path-uninitialized REF-SWEEPLOW 0.05
   PASS sweep-underpaid-reverted REF-SWEEPLOW 6DGQAdk46AnRxJuN8ZHgjxBw7vkJeMxesGgDj2KNd7sW
   ```

One command for the whole judge path: `bash scripts/judge-offline.sh` → `npm ci`, `npm test`, `vectors`, both
replays and an offline `verify` of every demo invoice; its last line was:

```
JUDGE-OFFLINE: ALL PASS
```

## Check the live testnet claims (read-only, no keys)

The invoices under `invoices/demo/` were paid on testnet (protocol 88). These commands only read RPC; they work
from a clean clone with no `.env`. The default endpoint is `https://rpc.testnet.near.org`; if it rate-limits, set
`ZI_RPC_URL=https://test.rpc.fastnear.com`.

1. `npm run zi -- verify INV-1111-A` → the address, the state-init bytes and the code hash are recomputed from
   the terms alone, then compared with the chain:

   ```
   PASS id-from-terms 0u4kwsbdsf5s5dfzp6wjaeq5ces9sajpv8hwmsp52a9e5bz30ave60
   PASS raw-from-terms
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

3. `cp .env.example .env` and fill it in. Set `ZI_CODE_HASH=Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`,
   `ZI_PAYER_ACCOUNT=example-zi-payer.testnet`, `ZI_SWEEPER_ACCOUNT=example-zi-merchant.testnet`,
   `ZI_TAXVAULT_ACCOUNT=example-zi-taxvault.testnet`, and for `ZI_PAYER_KEY` / `ZI_SWEEPER_KEY` paste the
   `private_key` values from `~/.near-credentials/testnet/example-zi-payer.testnet.json` and
   `~/.near-credentials/testnet/example-zi-merchant.testnet.json`. `.env` is gitignored: never commit it.
   Load it in every shell with `set -a; source .env; set +a`.

4. Issue an invoice. This makes no RPC call and needs no key; the address is computed locally:

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
   # PASS id-from-terms 0u… / PASS raw-from-terms / PASS code-hash-onchain Amg4WXKy… / PASS terms-onchain /
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
prints it as `EVENT …` and `zi replay` parses the JSON. Transfers are `Promise::transfer` inside the receipt, so
a failed transfer reverts the receipt (atomic).

## Claims and how to verify each

| Claim | Verify with | Expected |
|---|---|---|
| Issuing an invoice needs no transaction | `npm run zi -- invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet --tax-bps 800 --amount 0.1 --expires-in 2h` (works offline with `ZI_CODE_HASH` set) | `INVOICE`/`ACCOUNT`/`PAY`/`FILE` lines; no RPC call |
| The address commits to the terms and code | `npm run zi -- verify INV-1111-A --offline` | `PASS id-from-terms 0u4kwsbd…ave60`, `PASS raw-from-terms` |
| One tx creates + pays + splits | `npm run zi -- replay fixtures/demo-run.json` (or the nearblocks link in the previous section) | `PASS pay-tx-success INV-1111-A BdzRBcFf… result=PAID`, `PASS split-merchant INV-1111-A 0.92`, `PASS split-vault INV-1111-A 0.08` |
| Plain transfers are safe before init | `npm run zi -- replay fixtures/demo-run.json` | `PASS transfer-path-uninitialized INV-1111-B 1`, `PASS sweep-tx-success INV-1111-B 5P2rkpk… result=PAID` |
| Nobody holds keys to invoice accounts | `npm run zi -- verify INV-1111-A` (RPC `view_access_key_list`) | `PASS no-access-keys` |
| Underpay / expired / double pay are refunded | `npm run zi -- replay fixtures/refund-cases.json` | `PASS refund-event REF-UNDER REFUNDED_UNDERPAID`, `PASS refund-event REF-EXPIRED REFUNDED_EXPIRED`, `PASS refund-event REF-TWICE REFUNDED_NOT_OPEN` |
| The deployed code is the committed wasm | `shasum -a 256 contract/res/zeroinit_invoice.wasm` and `npm run zi -- verify INV-1111-A` | digest `912ae75e…c3c9` = base58 `Amg4WXKy…GW6k`; `PASS code-hash-onchain` |

## Limits (honest)

- **NEAR only.** FT / stablecoin invoices (NEP-141 `ft_transfer_call`) are not implemented.
- **Testnet only.** `src/config.ts` refuses a non-testnet network or a mainnet RPC URL; mainnet was not tested.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is
  the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a
  fallback, but every result in this README is `0u`.
- **The payer pays for the first touch.** Gas plus the protocol's 0.007 NEAR account-creation charge: measured
  **0.0073617847981195 NEAR** on a 0.1 NEAR invoice. Issuing costs nothing.
- **Plain-transfer overpayments go to the merchant.** `sweep()` cannot know the payer, so everything parked
  above `amount` is forwarded to the merchant with the net amount. With `pay()` the excess is refunded to the payer.
- **No checksum.** A mistyped `0u…` address is still a valid address for different bytes; funds sent to a wrong
  id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
- **Wallet support is untested.** We tested exchange-style `Transfer`s built by near-cli-rs / our CLI. Which
  browser wallets accept a `0u…` receiver is not verified (the wallet check was not run; see `docs/SPIKES.md`).
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no
  webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope for now:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u`
  dual UI, a reproducible-build Docker pipeline, and any indexer.

## Pre-hackathon code disclosure

New repository, first commit 2026-11-10. No code before the 2026-10-19 cutoff. Diff of all hackathon work:
`<REPO_URL>/compare/38fc3f0a1763d43d57fa3a702ec9d3ff3f17b332...hackathon-submission`. Test vectors are copied
from nearcore (MIT/Apache-2.0), cited inline.

## AI use disclosure

Plan, byte-level reference code and tests were drafted with Claude (Anthropic). The implementation was written
in Command Code agent sessions (Claude) from that plan, then re-run and reviewed. Every protocol claim
is checked by a test or an on-chain transaction listed above.

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1,
cargo-near 0.23.0, near-cli-rs 0.31.1. Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5.

## Other project by the same builder (NEAR HACKATHON rule Q-015)

Erhan also submits **ProvenExit**: <SIBLING_REPO_URL>. The two projects are independent and
share no code.

## License

MIT, see LICENSE.
