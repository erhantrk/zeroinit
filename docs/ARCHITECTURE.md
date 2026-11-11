# ZeroInit — Architecture

One immutable contract, one derivation function, and three transaction shapes. Everything below runs on NEAR
testnet at protocol 88; `docs/SPIKES.md` (sections S-A…S-E, "Contract v2 live", "Contract v3 live" and "Contract v3.1 live") records the live transactions that prove it.
The **current** contract is **v3.1** (code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, deployed as a global contract by tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`):
v3 plus one fix (a token `sweep` racing an in-flight `ft_transfer_call`, see "v3.1" below). v3 (`Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`) added NEP-141 invoices
(tUSDC, a testnet mock), a `SETTLING` status, an owed ledger and a payout lock. v3, v2 (`4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`) and v1
(`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`) stay on testnet as recorded history, see "v1 → v2", "v3" and "v3.1". The sections up to "v1 → v2" describe the account model, which is
the same in all four; where a number or a transaction differs, the v3 row or the v3 section says so. `docs/STABLECOIN.md` is the v3 interface spec (v3.1 has the same interface).

## Diagram

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

## Account lifecycle

```
             (merchant computes id offline; nothing on chain)
NONEXISTENT ──── plain Transfer (any wallet/exchange) ────► UNINITIALIZED (holds NEAR, no code)
     │                                                           │
     │ [UniversalStateInit, FunctionCall pay(deposit)]           │ [UniversalStateInit, FunctionCall sweep()]
     ▼                                                           ▼
  INITIALIZED, status OPEN → pay() splits → PAID      INITIALIZED, status OPEN → sweep() splits → PAID
```

Facts this relies on (all verified in source / official tests; Day-0 spikes re-prove them on testnet):

1. RPC `view_account` on a never-touched `0u` id returns error `UNKNOWN_ACCOUNT` (checked live 2026-11-09).
2. A plain `Transfer` to a nonexistent `0u` id creates it **uninitialized**. It holds the balance and nothing else.
   `view_account` then shows `"state":"uninitialized"` and `"bootstrap_nonce":<n>`. Both fields disappear once the account is initialized.
   ([NC] `runtime/runtime/src/actions.rs` `implicit_creation_allowed` → `UniversalAccount => true`; test
   `test_universal_state_init_after_transfer`; [DOCS-UA] "The uninitialized account".)
3. Anyone may send `UniversalStateInit` whose raw bytes hash to the receiver id. It installs code and data and keeps the parked
   balance. Repeating it on an initialized account is a no-op and refunds the full deposit (protocol 88,
   `RefundRepeatedUniversalStateInitDeposit`).
4. `[UniversalStateInit, FunctionCall]` in **one** transaction works: the call hits the freshly installed contract in the
   same receipt ([NC] test `test_universal_state_init_then_function_call`; [NEP655] "Relayer- or contract-funded, batched").
5. Every other action on an uninitialized account fails with `AccountNotInitialized`. If any action in the receipt fails, the
   whole receipt (including the state init) is rolled back.

## Why nobody holds a key

- **`access_keys` is empty.** The account is created by `UniversalStateInit` with `access_keys: {}` (INTERFACES §3.1),
  so no key exists that could ever sign for it. `zi verify` asks RPC `view_access_key_list` and prints
  `PASS no-access-keys` only when the list is empty.
- **The code is fixed by hash.** The invoice account is a global-contract account: `view_account.global_contract_hash`
  must equal the deployed code hash (v3.1 `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, checked by `PASS code-hash-onchain`; v1/v2/v3 history invoices are checked against their own hash and labelled by `zi verify`).
  A state init can only install code whose hash is already baked into the address, and repeating it on an initialized
  account is a no-op that refunds the deposit (INTERFACES §1, fact 3).
- **What this does *not* mean.** Only **invoice** accounts are keyless. The tUSDC mock token `sm1110-tusdc.testnet` (a contract account) and the operator's deployer/merchant/vault/payer accounts each hold a full-access key
  (checked with `view_access_key_list`, 2026-11-11; README "Who holds keys" has the command). The invoice contract trusts nobody; a **token** invoice trusts whoever controls the token contract, which on testnet is that key. The global
  code is published by hash, so the deployer's key cannot change what `2prMzXHZ…DaYX` runs.
- **The terms are in the address.** The id is `0u` + crockford-base32(SHA3-256(borsh
  `UniversalStateInit{code: CodeHash, data: {STATE}, access_keys: {}}`)): merchant, tax vault, tax_bps, amount,
  expiry and salt are inside the bytes that are hashed. The merchant cannot change terms after issuing, the payer
  cannot redirect the split, and `zi verify` recomputes both the STATE bytes and the id from the terms alone
  (`PASS id-from-terms`, `PASS raw-from-terms`).

## Transactions

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY | payer | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 100 Tgas (v1/v2: 50), deposit = amount}]` |
| SWEEP | sweeper (anyone) | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 100 Tgas (v1/v2: 50), 0}]` |
| (external) PLAIN TRANSFER | any wallet | invoice `0u` id | `[Transfer{amount}]`, sent by the payer's own wallet, not by us |

## Costs measured

v1 numbers were measured on testnet 2026-11-10 (protocol 88, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`); the raw output and tx hashes are in
`docs/SPIKES.md` → S-E. The v2 rows come from the re-recorded fixtures (`docs/SPIKES.md` → "Contract v2 live").

| What | Measured | Evidence |
|---|---|---|
| `storage_usage` after `pay()` | v1 **352 B**, v2 **358 B** — well under the 770 B zero-balance limit (INTERFACES §4.3 estimated ~312 B before and ~329 B after) | v1 SMOKE-1, `zi status SMOKE-1 --json`; v2 `INV-1111-V2-A` (`storage=358`) |
| `storage_usage` after `sweep()` (plain-transfer path) | v1 **325 B**, v2 **331 B** | v1 SMOKE-2; v2 `INV-1111-V2-B` (`storage=331`) |
| `storage_usage` while a tax share is owed (v2 `OWED_TAX` key) | **429 B** | `AUD2-V2` (`storage=429`) |
| State-init deposit needed | **0** — the pre-approved 0.01 NEAR deposit was not needed | all rows above ≤ 770 B |
| Tokens burnt by one `pay` tx that creates the account (all receipts summed) | v1 **0.0073621 NEAR**, v2 **0.0077197 NEAR** (15.5 vs 11.5 Tgas: the two `on_transfer` callbacks) | `INV-1111-A` and `INV-1111-V2-A` in the fixtures. v1 payer cost on a 0.1 NEAR invoice (balance diff): 0.0073617847981195 NEAR, pay tx `AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M`. The protocol's 0.007 NEAR account-creation charge is included; when a plain transfer created the account first (`AUD3-V2`) the pay tx itself burnt 0.0015 NEAR |
| One-time global deploy burn | v1 **7.8526 NEAR** (78,519-byte wasm), v2 **8.2949 NEAR** (82,942-byte wasm); not per-invoice costs | v1 deploy tx `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`; v2 deploy tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG` |

**v3 rows** (measured on testnet 2026-11-10, `docs/SPIKES.md` → "Contract v3 live" → "Measured"; single runs, tokens burnt summed over all receipts, deposits not included):

| What | Measured |
|---|---|
| `storage_usage` after a NEAR `pay()` / after a plain transfer + `sweep` | **421 B** (0.1 NEAR invoice; 426 B for a 1 NEAR one) / **393 B**; 426 to 429 B while a merchant share is owed; 457 B after `refund_payer` |
| `storage_usage` of a token invoice | 417 B initialized, 416 to 422 B after a plain-transfer sweep, 445 B after a paid `ft_transfer_call`, 472 B after `refund_payer` (largest seen; the limit is 770 B) |
| Tokens burnt, NEAR `pay` that creates the account | **0.0075600 NEAR** (13.70 Tgas) (v2 0.0077197) |
| Tokens burnt, token init `[UniversalStateInit, fund]` / settling `ft_transfer_call` / token sweep with state init | 0.0072530 NEAR (9.96 Tgas) / 0.0011780 NEAR (13.13 Tgas) / 0.0083450 NEAR (21.99 Tgas) |
| NEP-145 registration of one account (token side) | 0.00125 NEAR deposit, kept by the token, plus 0.000182 NEAR burnt |
| One-time global deploy burn, v3 (161,213-byte wasm) | **about 16.1226 NEAR** (operator's balance 27 → 10.8774031 NEAR, gas included); deploy tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT` |
| One-time global deploy burn, v3.1 (163,771-byte wasm) | **about 16.38 NEAR** (deployer balance 17.8774031 → 1.4989866 NEAR across the tx); deploy tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB` |

Issuing an invoice costs nothing and sends no transaction. After a completed payment the account sits at 0 NEAR
(v3: 421 B after `pay()`, 393 B after `sweep()`; v2: 358 B / 331 B; v1: 352 B; all below the zero-balance limit), so there is no per-invoice storage to fund and nothing left
behind for the merchant to reclaim.

## v1 → v2

v1 was a global contract and cannot be patched. The audit found three issues in it; **v2** fixes them in a new wasm (new
code hash, same borsh state layout, same methods and events plus additions). `pay()` and `sweep()` still write the record
and emit `invoice_paid` in the same receipt that schedules the transfers, so atomicity between the record and the money
movement is **not** claimed; v2 adds callbacks that record what failed.

| Finding | v1 behaviour | v2 fix | Live evidence (`fixtures/v2/audit-scenarios.json`) |
|---|---|---|---|
| contract-1 (medium): tax skipped after EXPIRED | funds parked by a plain transfer, a 0-deposit `pay()` after expiry sets `EXPIRED`, and `sweep()` sends everything to the merchant: the tax vault gets 0 | `sweep()` treats `EXPIRED` with `paid_amount == 0` like `OPEN` (92/8, `late: true`; pro rata if short) | `AUD1-V2`: zero pay `678rsqwk…`, sweep `8WQr2GUm…` → vault gets 0.008 |
| contract-3 (low): `pay()` ignores parked funds | transfer then pay charges twice, the first amount reaches the merchant untaxed | `pay()` settles parked funds like `sweep()` and refunds the whole deposit (`already_funded`) | `AUD3-V2`: pay `3YPLdAp5…` → deposit refunded, one split |
| contract-2 (low): failed transfer after PAID | the record says PAID, the bounced funds go to the merchant on the next sweep | `on_transfer` callbacks emit `transfer_failed`, the tax stays owed (`OWED_TAX`, `get_owed_tax()`), `sweep()` re-sends it to the vault, never to the merchant (`tax_resent`; the live `AUD2-V2` retry bounced again because that vault does not exist) | `AUD2-V2`: pay `ARgzUkMK…`, sweep `7z45ySFY…` → `TAX_RESENT`. The first retry bounced (the vault did not exist); after the vault account was created (`FWBnYH6K…`) a second sweep `HECqnmtE…` delivered the 0.008 NEAR |

Residual: `invoice_paid` precedes the transfers; extra funds arriving while a tax transfer is in flight can be sent to the
vault as the owed share; a nonexistent merchant still cannot receive its share, so the CLI and the dashboard check both
accounts exist at issue time. Full tx hashes and the README table are in `README.md` → "v1 → v2".

Client side (`src/config.ts`): a known-deployments list holds v3.1 (the trusted build, labelled "current, deployed on testnet"), v3, v2 (deployed, historical for the client) and v1 (historical).
`zi verify`, `zi receipt` and `zi replay` accept a v1, v2 or v3 invoice or fixture against its own hash to replay the recorded history
and say which deployment it uses; `zi pay`, `zi sweep`, `zi init`, `zi invoice new` and the dashboard use only the trusted
hash (v3.1 or the `ZI_CODE_HASH` pin). Foreign hashes are never accepted.

## v3 (history since v3.1; the model v3.1 keeps)

Contract v3 keeps the v2 account model — one global code hash, one `0u` id derived from code + terms, no init method,
no access keys — and changes what an invoice can hold and how a payment settles. The full interface is
`docs/STABLECOIN.md`; this is the shape.

**State.** Layout 3 adds `grace_ms` and `token` (a NEP-141 contract id, or None = NEAR) to the terms, and
`owed_merchant`, `owed_tax`, `owed_payer`, `refund_to`, `busy_until_ms` to the record. Status `SETTLING` means "money
accepted, shares in flight or failed"; `PAID` means every share was delivered; `REFUNDED` means the payer got the
undelivered shares back after the grace period. A NEAR invoice is 201 bytes, a token invoice 226; the maximum-length
state is 519 bytes, so 519 + 45 (record) + 132 (account overhead) = 696 B stays under the 770-byte zero-balance limit.

**Settlement.** `pay`, `ft_on_transfer` (a token payment), `sweep` and `refund_payer` build one list of payouts and one
private callback batch. `on_settled` checks every transfer, records failures per recipient (`owed_*`), emits
`transfer_failed`, and is the only place `invoice_paid` is emitted (after all merchant/tax shares succeeded). A 5-minute
lock stops a second settlement while payouts are in flight; a stale lock is taken over. Owed amounts are paid only to
their own recipient: `owed_merchant` → merchant, `owed_tax` → vault, `owed_payer` → `refund_to`.

**Tax rule (v2 residual fixed).** Every amount the contract pays to the merchant side goes through
`split_of(x) = (x − floor(x·tax_bps/10000), floor(x·tax_bps/10000))`: the price on a pay, the whole parked balance on a
plain-transfer settle (overpay included), later extras, and the pro-rata release after expiry. Refunds of the payer's
own money and re-sent owed shares are not taxed again.

**Token flows.** One token per invoice, fixed in the terms and therefore in the address; the contract accepts only that
token (`predecessor == token`). Plain path (exchange): register the `0u` id on the token (NEP-145), plain `ft_transfer`
(the tokens sit on the token contract), then anyone sends `[UniversalStateInit, fund(1000 yocto), sweep]` to the
invoice; `sweep` reads `ft_balance_of(self)` in a callback and settles. One-step path: `[UniversalStateInit, fund]`
first, then `ft_transfer_call` with the strict msg `{"action":"pay","invoice_id":"…"}`; `ft_on_transfer` returns the
unused amount (the token refunds the excess) and records `payment_rejected <reason>` when it refuses. The `ft_transfer_call` transaction itself ends with the amount **used**
(NEP-141), `"1000000"` for a settled 1 tUSDC, `"0"` for a rejected payment; the token's own `ft_transfer` event with `memo: "refund"` shows what came back. The client
allow-list (`ZI_TUSDC_ACCOUNT`) pins the token contract and its 6 decimals; the contract cannot hold a list because its
code is global and ownerless.

| v3 transaction | signer | receiver | actions |
|---|---|---|---|
| PAY (NEAR) | payer | invoice `0u…` | `[UniversalStateInit, FunctionCall pay, {} , 100 Tgas, deposit]` |
| SWEEP (NEAR) | anyone | invoice `0u…` | `[UniversalStateInit, FunctionCall sweep, {}, 100 Tgas]` |
| INIT (token) | payer/merchant | invoice `0u…` | `[UniversalStateInit, FunctionCall fund, {}, 10 Tgas, 1000 yocto]` |
| PAY (token) | payer | token contract | `[FunctionCall ft_transfer_call{receiver_id: invoice, amount, msg}, 1 yocto, 200 Tgas]` |
| SWEEP (token) | anyone | invoice `0u…` | `[UniversalStateInit?, fund?, FunctionCall sweep, {}, 200 Tgas]` |
| REFUND PAYER | anyone | invoice `0u…` | `[FunctionCall refund_payer, {}, 100/200 Tgas]` |

Gas: the client attaches 100 Tgas for NEAR `pay`/`sweep`/`refund_payer`, 200 Tgas for token `ft_transfer_call`, token `sweep` and token `refund_payer`; the runs burnt 2 to 22 Tgas
per transaction (numbers above). Deploy: about 16.1226 NEAR measured by the operator, `contract/`'s wasm is 161,213 bytes (a local, non-reproducible build). Client side
(`src/config.ts`): v3.1 is the trusted build (labelled "current, deployed on testnet"), v3, v2 and v1 are historical; `pinForVerification` accepts a historical document only against
its own hash, and pay/sweep/init refuse a historical or foreign document. tUSDC (`sm1110-tusdc.testnet`) is a testnet mock token; the allow-list default is in `src/config.ts`.
On mainnet it would be a real issuer's NEP-141 contract; that was not tested.

**What the live runs changed in the design** (details in `docs/SPIKES.md`): the final value of `ft_transfer_call` is the amount used, not the unused amount; an invoice that expired
untouched is still `OPEN` until some call sets `EXPIRED`, and only then does `sweep` release a plain underpay pro rata; everything else behaved as specified.

## v3.1 (current, deployed on testnet)

Same layout, interface and events as v3; one change in the token `sweep` path (final-review finding F1). `sweep` takes the payout lock and asks the token for `ft_balance_of(self)`; the
lock value it set is passed to the callback `on_token_balance`. An `ft_transfer_call` whose credit is already on the invoice but whose `ft_on_transfer` runs while the lock is
held is rejected as `busy` and raises the lock by 1 (only while the invoice is `OPEN`); the token then returns the tokens to the payer. If the lock in the callback is not the
one `sweep` set, the balance may include those tokens, so the callback clears the lock, plans no payout and returns `CONCURRENT_PAYMENT`: the invoice stays `OPEN`, nothing is
owed, and the payer can retry. Under v3 the same sequence planned a settlement with tokens that were no longer there. The deployed wasm is 163,771 bytes (sha256 `1b1dcc75…e278`,
code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`).

Transaction shapes and gas are the v3 ones; on v3.1 the runs burnt 13.70 Tgas / 0.007561 NEAR for a NEAR `pay` that creates the account, 13.14 Tgas / 0.001180 NEAR for a settling
`ft_transfer_call`, 22.04 Tgas / 0.008349 NEAR for a token sweep with state init (200 Tgas attached), 5.58 Tgas / 0.000491 NEAR for the sweep that returned `CONCURRENT_PAYMENT` and 4.93 Tgas / 0.000426 NEAR
for the L3 sweep that delivered an owed NEAR share (single runs, `docs/SPIKES.md` "Contract v3.1 live"). The F1 race was produced once on testnet (`fixtures/v31/race.json`); the
logic is covered by the Rust test `token_sweep_racing_a_busy_ft_transfer_call_plans_nothing`. The `UniversalStateInit` deposit is not credited to the new account (S-F4: the system
refunds it to the signer), which is why a token invoice is given its 1-yocto float by a separate `fund` call. Still open: repeated `sweep` calls can keep `ft_transfer_call` rejected as
`busy` (permissionless, costs the caller gas).
