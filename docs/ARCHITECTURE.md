# ZeroInit — Architecture

One immutable contract, one derivation function, and three transaction shapes. Everything below runs on NEAR
testnet at protocol 88; `docs/SPIKES.md` (sections S-A…S-E, and "Contract v2") records the live transactions that prove it.
The current contract is **v2** (code hash `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`); v1 (`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`) stays on testnet as recorded history, see "v1 → v2" at the end.

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
  must equal the deployed code hash (v2 `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`, checked by `PASS code-hash-onchain`; v1 history invoices are checked against the v1 hash and labelled by `zi verify`).
  A state init can only install code whose hash is already baked into the address, and repeating it on an initialized
  account is a no-op that refunds the deposit (INTERFACES §1, fact 3).
- **The terms are in the address.** The id is `0u` + crockford-base32(SHA3-256(borsh
  `UniversalStateInit{code: CodeHash, data: {STATE}, access_keys: {}}`)): merchant, tax vault, tax_bps, amount,
  expiry and salt are inside the bytes that are hashed. The merchant cannot change terms after issuing, the payer
  cannot redirect the split, and `zi verify` recomputes both the STATE bytes and the id from the terms alone
  (`PASS id-from-terms`, `PASS raw-from-terms`).

## Transactions

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY | payer | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 50 Tgas, deposit = amount}]` |
| SWEEP | sweeper (anyone) | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 50 Tgas, 0}]` |
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

Issuing an invoice costs nothing and sends no transaction. After a completed payment the account sits at 0 NEAR
(v2: 358 B of storage after `pay()`, 331 B after `sweep()`; v1: 352 B; all below the zero-balance limit), so there is no per-invoice storage to fund and nothing left
behind for the merchant to reclaim.

## v1 → v2

v1 was a global contract and cannot be patched. The audit found three issues in it; **v2** fixes them in a new wasm (new
code hash, same borsh state layout, same methods and events plus additions). `pay()` and `sweep()` still write the record
and emit `invoice_paid` in the same receipt that schedules the transfers, so atomicity between the record and the money
movement is **not** claimed; v2 adds callbacks that record what failed.

| Finding | v1 behaviour | v2 fix | Live evidence (`fixtures/audit-scenarios.json`) |
|---|---|---|---|
| contract-1 (medium): tax skipped after EXPIRED | funds parked by a plain transfer, a 0-deposit `pay()` after expiry sets `EXPIRED`, and `sweep()` sends everything to the merchant: the tax vault gets 0 | `sweep()` treats `EXPIRED` with `paid_amount == 0` like `OPEN` (92/8, `late: true`; pro rata if short) | `AUD1-V2`: zero pay `678rsqwk…`, sweep `8WQr2GUm…` → vault gets 0.008 |
| contract-3 (low): `pay()` ignores parked funds | transfer then pay charges twice, the first amount reaches the merchant untaxed | `pay()` settles parked funds like `sweep()` and refunds the whole deposit (`already_funded`) | `AUD3-V2`: pay `3YPLdAp5…` → deposit refunded, one split |
| contract-2 (low): failed transfer after PAID | the record says PAID, the bounced funds go to the merchant on the next sweep | `on_transfer` callbacks emit `transfer_failed`, the tax stays owed (`OWED_TAX`, `get_owed_tax()`), `sweep()` re-sends it to the vault only (`tax_resent`) | `AUD2-V2`: pay `ARgzUkMK…`, sweep `7z45ySFY…` → `TAX_RESENT` |

Residual: `invoice_paid` precedes the transfers; extra funds arriving while a tax transfer is in flight can be sent to the
vault as the owed share; a nonexistent merchant still cannot receive its share, so the CLI and the dashboard check both
accounts exist at issue time. Full tx hashes and the README table are in `README.md` → "v1 → v2".

Client side (`src/config.ts`): a known-deployments list holds v2 (current, the default trusted hash) and v1 (historical).
`zi verify`, `zi receipt` and `zi replay` accept a v1 invoice or fixture against the v1 hash to replay the recorded history
and say which deployment it uses; `zi pay`, `zi sweep`, `zi init`, `zi invoice new` and the dashboard use only the trusted
hash (v2 or the `ZI_CODE_HASH` pin). Foreign hashes are never accepted.
