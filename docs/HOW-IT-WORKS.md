# How ZeroInit works

One immutable contract published by hash, one derivation function, and a few transaction shapes. This describes the deployed contract, **v3.2r**
(code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`, the v3.2 source built reproducibly). The token interface in full detail is [STABLECOIN.md](STABLECOIN.md);
measured costs and how the design changed from v1 to v3.2 are in [ARCHITECTURE.md](ARCHITECTURE.md); the live transactions behind every statement are in [SPIKES.md](SPIKES.md).

Sections: [Overview](#overview) · [The address](#the-address) · [Account lifecycle](#account-lifecycle) · [Why nobody holds a key](#why-nobody-holds-a-key) · [Contract methods](#contract-methods) ·
[pay() rules](#pay-rules) · [sweep() rules](#sweep-rules) · [Settlement and tax](#settlement-and-tax) · [Token flows](#token-flows) · [Transactions](#transactions) · [Events](#events) · [Client side](#client-side) · [Libraries](#libraries)

## Overview

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
   published once by the deployer ─────────► NONEXISTENT → (B) UNINITIALIZED (funds parked)
                                             → UniversalStateInit installs code H + STATE
                                             → pay()/sweep(): Promise transfers
                                                 ├─► merchant  (amount − tax)
                                                 ├─► tax_vault (tax)
                                                 └─► payer     (refund / excess)
```

## The address

The id is computed offline: `0u` + Crockford-base32(SHA3-256(borsh `UniversalStateInit{code: CodeHash, data: {STATE}, access_keys: {}}`)).
`STATE` is the borsh encoding of the invoice terms: invoice id, merchant, tax vault, `tax_bps`, amount, expiry, salt, grace period and token, followed by the empty record
(layout 3, 201 bytes for a NEAR invoice and 226 for a token invoice; [STABLECOIN.md §3](STABLECOIN.md#3-state-layout-frozen-for-v3-and-storage-budget); the v1/v2 layout is [SPEC.md](../SPEC.md) §2.3).
It is implemented in `src/stateinit.ts`. Because the code hash and the terms are inside the hashed bytes, the same terms give a different address under a different contract version.

Protocol facts this relies on (from nearcore source and tests, and re-checked on testnet in the first live runs, [SPIKES.md](SPIKES.md)):

1. RPC `view_account` on a never-touched `0u` id returns `UNKNOWN_ACCOUNT`.
2. A plain `Transfer` to a nonexistent `0u` id creates it **uninitialized**. It holds the balance and nothing else. `view_account` then shows `"state":"uninitialized"` and
   `"bootstrap_nonce":<n>`; both fields disappear once the account is initialized. (nearcore `runtime/runtime/src/actions.rs` `implicit_creation_allowed` → `UniversalAccount => true`;
   test `test_universal_state_init_after_transfer`.)
3. Anyone may send `UniversalStateInit` whose raw bytes hash to the receiver id. It installs code and data and keeps the parked balance. Repeating it on an initialized account
   is a no-op and refunds the full deposit (protocol 88, `RefundRepeatedUniversalStateInitDeposit`). Its deposit is **not** credited to the new account: the system returns it to the
   signer (measured on testnet, `fixtures/v31/sf4.json`), which is why a token invoice gets its 1-yocto float through a separate `fund` call.
4. `[UniversalStateInit, FunctionCall]` in **one** transaction works: the call hits the freshly installed contract in the same receipt (nearcore test
   `test_universal_state_init_then_function_call`; NEP-655 "Relayer- or contract-funded, batched").
5. Every other action on an uninitialized account fails with `AccountNotInitialized`. If any action in the receipt fails, the whole receipt, including the state init, is rolled back.

## Account lifecycle

```
             (merchant computes id offline; nothing on chain)
NONEXISTENT ──── plain Transfer (any wallet/exchange) ────► UNINITIALIZED (holds NEAR, no code)
     │                                                           │
     │ [UniversalStateInit, FunctionCall pay(deposit)]           │ [UniversalStateInit, FunctionCall sweep()]
     ▼                                                           ▼
  INITIALIZED, status OPEN → pay() splits → PAID      INITIALIZED, status OPEN → sweep() splits → PAID
```

Statuses inside the contract:

```
OPEN ── pay / ft_on_transfer accepted, or sweep settles ──► SETTLING ── all payouts confirmed (on_settled) ──► PAID
 │                                                            │  ▲ failed payout: owed recorded, status stays
 │ now > expires_at_ms, pay/ft refused                        │  └─ sweep retries owed to its own recipient
 ▼                                                            └─ refund_payer after the grace period, payer known ──► REFUNDED
EXPIRED ── sweep with avail ≥ amount ──► SETTLING (late) ──► PAID
```

`OPEN`, `PAID` (every share delivered), `EXPIRED`, `SETTLING` (money accepted, shares in flight or failed), `REFUNDED` (the payer got the undelivered shares back).
An invoice that expired untouched stays `OPEN` in storage until some call (a late `pay`, a late `ft_transfer_call`) sets `EXPIRED`; since v3.2 `sweep` treats an `OPEN` invoice past
its expiry as `EXPIRED` by itself (Rust-tested, not run live). After a completed payment the account holds 0 NEAR and stays below NEAR's 770-byte zero-balance storage limit
(the largest measured is 472 B; the worst case by design is 696 B), so there is no per-invoice storage to fund and nothing left behind.

## Why nobody holds a key

- **`access_keys` is empty.** The account is created by `UniversalStateInit` with `access_keys: {}`, so no key exists that could ever sign for it. `zi verify` asks RPC
  `view_access_key_list` and prints `PASS no-access-keys` only when the list is empty.
- **The code is fixed by hash.** The invoice account is a global-contract account: `view_account.global_contract_hash` must equal the deployed code hash (`PASS code-hash-onchain`).
  A state init can only install the code whose hash is baked into the address, and repeating it is a no-op.
- **The terms are in the address.** Merchant, tax vault, `tax_bps`, amount, expiry, salt and token are inside the hashed bytes. The merchant cannot change the terms after issuing,
  the payer cannot redirect the split, and `zi verify` recomputes both the state bytes and the id from the terms alone (`PASS id-from-terms`, `PASS raw-from-terms`).
- **What this does not mean.** Only invoice accounts are keyless. The tUSDC mock token and the operator's accounts each hold a full-access key, and a token invoice trusts whoever
  controls its token: [LIMITS.md "Who holds keys"](LIMITS.md#who-holds-keys).

## Contract methods

Args are `{}` unless noted. There is no init method, no owner and no key.

| Method | Payable | What it does |
|---|---|---|
| `pay()` | yes | NEAR invoices: splits the attached deposit per `tax_bps` (92/8 at 800 bps), or refunds it ([rules](#pay-rules)) |
| `ft_on_transfer(sender_id, amount, msg)` | no (called by the token) | token invoices: accepts an `ft_transfer_call` whose `msg` is exactly `{"action":"pay"}` (optionally with this invoice's `invoice_id`) and whose caller is the invoice's token, or returns the amount unused with a `payment_rejected` reason |
| `sweep()` | no | settles funds that arrived without a call (a plain transfer or plain `ft_transfer`); re-sends owed shares to their own recipient; forwards extra funds (taxed) |
| `refund_payer()` | no | after the invoice's grace period, pays the undelivered shares of a `SETTLING` invoice back to the payer (`paid_by`) and nobody else |
| `fund()` | yes | token invoices: takes a NEAR deposit (the client sends 1,000 yocto) so the account can attach 1 yocto to each `ft_transfer` |
| `get_invoice()`, `get_owed_tax()` | view | the invoice as JSON (`u64`/`u128` as strings, including `owed_*`, `grace_ms`, `token`, `busy_until_ms`) / the tax share not yet delivered |
| `on_settled`, `on_token_balance` | private | callbacks: `on_settled` checks every payout, records failures per recipient (`owed_*`), emits `transfer_failed`, and is the **only** place `invoice_paid` is emitted |

## pay() rules

NEAR invoices, checked in this order (`d` = attached deposit, `now` = block timestamp, `parked` = free balance − `d` − owed):

| # | Condition | Result |
|---|---|---|
| 1 | the invoice is a token invoice | `REFUNDED_WRONG_ASSET`; `d` goes back |
| 2 | status is not `OPEN` | `REFUNDED_NOT_OPEN`; `d` goes back to the payer |
| 3 | `now > expires_at_ms` | `REFUNDED_EXPIRED`; status becomes `EXPIRED`; `d` goes back |
| 4 | a payout is in flight (lock) | `REFUNDED_BUSY` |
| 5 | `parked ≥ amount` | funds parked by a plain transfer already cover the invoice: they are settled like `sweep()` (taxed) and `d` goes back in full (`payment_refunded`, reason `already_funded`) |
| 6 | `d < amount` | `REFUNDED_UNDERPAID`; status stays `OPEN`; `d` goes back |
| 7 | otherwise | status `SETTLING`, tax = `amount × tax_bps / 10000` (floor) to the tax vault, net to the merchant, any excess back to the payer; the callback then sets `PAID` and emits `invoice_paid` (the transaction returns `PAID`), or records what failed (`PAYOUT_PENDING`) |

`ft_on_transfer` applies the same order for tokens and returns the whole amount with a reason (`wrong_token`, `bad_msg`, `not_open`, `expired`, `busy`, `no_yocto`, `low_gas`, `underpaid`);
on success it uses only the price and the token returns the excess ([STABLECOIN.md §5.2](STABLECOIN.md#52-ft_on_transfersender_id-amount-msg---promiseorvalueu128-token-invoices)).

## sweep() rules

NEAR: `avail` = balance − owed − storage reserve (the reserve is 0 while `storage_usage ≤ 770` B).

1. Re-send owed shares first: tax to the vault, merchant share to the merchant, payer share to `refund_to`.
2. `OPEN`, or `EXPIRED` and never paid, with `avail ≥ amount`: settle **all** of `avail` through the tax split (`PAID`, `late: true` after expiry).
3. `OPEN` with less: panic `UNDERPAID` (the funds stay parked). `EXPIRED` with less: release `avail` pro rata, taxed.
4. `PAID` with `avail > 0`: split the extra the same way (`EXTRA_SWEPT`).

Token `sweep` reads `ft_balance_of` in a callback and runs the same plan; it returns the value `UNDERPAID` / `NOTHING_TO_SWEEP` (it cannot panic in a callback) and needs at least
150 Tgas. While a payout is in flight (5-minute lock) a second `sweep` panics `PAYOUT_IN_FLIGHT`. If a rejected `ft_transfer_call` changed the lock between the balance read and the
callback, the sweep plans nothing and returns `CONCURRENT_PAYMENT` (the race guard; [HISTORY.md "v3.1 → v3.2"](HISTORY.md#v31--v32)). Full plan: [STABLECOIN.md §5.3](STABLECOIN.md#53-sweep-anyone-settles-funds-that-arrived-without-a-call).

## Settlement and tax

- **One batch, one callback.** `pay`, `ft_on_transfer`, `sweep` and `refund_payer` build one list of payouts and one private callback. `on_settled` checks every transfer, records
  failures per recipient (`owed_merchant`, `owed_tax`, `owed_payer`), emits `transfer_failed`, and emits `invoice_paid` only after all merchant and tax shares succeeded.
- **Owed amounts go only to their own recipient:** `owed_merchant` → merchant, `owed_tax` → vault, `owed_payer` → `refund_to`.
- **A 5-minute lock** (`busy_until_ms`) stops a second settlement while payouts are in flight; a stale lock is taken over.
- **Tax rule.** Every amount paid to the merchant side goes through `split_of(x) = (x − floor(x·tax_bps/10000), floor(x·tax_bps/10000))`: the price on a pay, the whole parked balance on a
  plain-transfer settle (overpayment included), later extras, and the pro-rata release after expiry. Refunds of the payer's own money and re-sent owed shares are not taxed again.

If a payout fails (a missing account, an unregistered token receiver), NEAR returns the amount to the invoice account, the callback records it as owed and emits `transfer_failed`,
and **no `invoice_paid` is emitted**; a later `sweep` re-sends it to that recipient only, and `refund_payer` can return it to the payer after the grace period.
`zi pay` / `zi sweep` print the failed receipt as `TRANSFER_FAILED …` and exit 1.

## Token flows

One token per invoice, fixed in the terms and so in the address; the contract accepts only that token (`predecessor == token`).

- **Plain path (exchange, wallet):** register the `0u` id on the token (NEP-145 `storage_deposit`, 0.00125 NEAR, anyone may pay it), plain `ft_transfer` (the tokens sit on the token
  contract under the `0u` id while NEAR still says `UNKNOWN_ACCOUNT`), then anyone sends `[UniversalStateInit, fund(1000 yocto), sweep]` to the invoice; `sweep` reads
  `ft_balance_of(self)` in a callback and settles.
- **One-step path:** `[UniversalStateInit, fund]` first (`zi init`), then `ft_transfer_call` with `msg` `{"action":"pay","invoice_id":"…"}`. The `ft_transfer_call` transaction ends with
  the amount **used** (NEP-141): `"1000000"` for a settled 1 tUSDC, `"0"` for a rejected payment; the token's own `ft_transfer` event with `memo: "refund"` shows what came back.
  An `ft_transfer_call` to a never-initialized id fails on NEAR and the token returns everything.
- **The allow-list lives in the client** (`ZI_TUSDC_ACCOUNT` pins the token contract and its 6 decimals): a list inside the global, ownerless contract would bake an account id into the code hash.

## Transactions

Hand-encoded transactions (V0, ed25519 over SHA-256), because near-api-js 7.4.0 cannot serialize action 15 (`UniversalStateInit`).

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY (NEAR) | payer | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 100 Tgas, deposit = amount}]` |
| SWEEP (NEAR) | anyone | invoice `0u…` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 100 Tgas, 0}]` |
| PLAIN TRANSFER | any wallet | invoice `0u…` id | `[Transfer{amount}]`, sent by the payer's own wallet |
| INIT (token) | payer / merchant | invoice `0u…` id | `[UniversalStateInit, FunctionCall{"fund", 10 Tgas, 1000 yocto}]` |
| PAY (token) | payer | the token | `[FunctionCall{"ft_transfer_call", {receiver_id: invoice, amount, msg}, 200 Tgas, 1 yocto}]` |
| PLAIN `ft_transfer` (token) | any wallet / exchange | the token | `[FunctionCall{"ft_transfer", 1 yocto}]`, which succeeds **only after the invoice id was registered on the token** with a separate `storage_deposit` transaction (`zi pay --plain` sends it first; an exchange withdrawal does not) |
| SWEEP (token) | anyone | invoice `0u…` id | `[UniversalStateInit, FunctionCall{"fund"}, FunctionCall{"sweep", "{}", 200 Tgas}]` (state init and fund only when needed) |
| REFUND PAYER | anyone | invoice `0u…` id | `[FunctionCall{"refund_payer", "{}", 100 Tgas (NEAR) / 200 Tgas (token)}]` |

The recorded runs burnt 2 to 22 Tgas per transaction; the costs are in [ARCHITECTURE.md](ARCHITECTURE.md#costs-measured).

## Events

Each state change emits an `EVENT_JSON:` log line (`invoice_paid`, `payment_refunded`, `payment_rejected`, `extra_swept`, `transfer_failed`, `tax_resent`, `owed_resent`, `owed_reclaimed`,
`refund_failed`); `zi` prints it as `EVENT …` and `zi replay` parses the JSON. Fields per event: [STABLECOIN.md §8](STABLECOIN.md#8-events-and-errors).

## Client side

`src/config.ts` keeps a list of known deployments. **v3.2r** is the trusted build (labelled "current, deployed on testnet"; `ZI_CODE_HASH` overrides it); v3.2, v3.1, v3, v2 and v1 are
history. History is accepted **only to verify recorded runs**: `zi verify`, `zi receipt` and `zi replay` check an older invoice or fixture against its own hash and say which deployment it uses;
`zi pay`, `zi sweep`, `zi init`, `zi invoice new`, the dashboard and the MCP server use only the trusted hash. A foreign hash is never accepted. To operate an older invoice on purpose,
pin its hash: `ZI_CODE_HASH=<hash> zi sweep <id>`.

## Libraries

@noble/hashes 2.2.0, @noble/curves 2.2.0, @scure/base 2.2.0, near-api-js 7.4.0 (test only), near-sdk 5.30.1, cargo-near 0.23.0, near-cli-rs 0.31.1.
Spec sources: NEP-655, NEP-616, nearcore 2.14.0-rc.5. Test vectors are copied from nearcore (MIT/Apache-2.0) and cited inline.
