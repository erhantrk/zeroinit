# ZeroInit — Architecture

One immutable contract, one derivation function, and three transaction shapes. Everything below runs on NEAR
testnet at protocol 88; `docs/SPIKES.md` (sections S-A…S-E) records the live transactions that prove it.

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
  must equal the deployed code hash (`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`, checked by `PASS code-hash-onchain`).
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

Measured on testnet 2026-11-10 (protocol 88, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`); the raw
output and tx hashes are in `docs/SPIKES.md` → S-E.

| What | Measured | Evidence |
|---|---|---|
| `storage_usage` after `pay()` | **352 B** — well under the 770 B zero-balance limit (INTERFACES §4.3 estimated ~312 B before and ~329 B after) | SMOKE-1, `zi status SMOKE-1 --json` → `storageUsage:352` |
| `storage_usage` after `sweep()` (plain-transfer path) | **325 B** | SMOKE-2, `zi sweep` → `storage=325` |
| State-init deposit needed | **0** — the pre-approved 0.01 NEAR deposit was not needed | both rows above ≤ 770 B |
| Payer cost of one materialization | **0.0073617847981195 NEAR** on a 0.1 NEAR invoice (7.36%): gas plus the protocol's 0.007 NEAR account-creation charge | balance 9.6847289421768805 → 9.577367157378761 NEAR minus 0.1, equal to the tx's `tokens_burnt`; pay tx `AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M` |
| One-time global deploy burn | **7.8526 NEAR** for the 78,519-byte wasm (deployer 10 NEAR → 2.1474 NEAR); not a per-invoice cost | deploy tx `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h` |

Issuing an invoice costs nothing and sends no transaction. After a completed payment the account sits at 0 NEAR
(352 B of storage, below the zero-balance limit), so there is no per-invoice storage to fund and nothing left
behind for the merchant to reclaim.

## Known limitations (contract v1, frozen)

The contract is deployed by code hash (`Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`) and all fixtures depend on
it, so these audit findings are documented, not fixed; a fix is a v2 (new wasm, new hash). `pay()` and `sweep()`
write the record and emit `invoice_paid` in the same receipt that schedules detached transfers (no callback), so
the design does **not** give atomicity between the record and the money movement.

1. **contract-1 (medium): tax skipped after EXPIRED.** Funds parked by a plain transfer before expiry, then anyone
   sends `pay()` with a 0 deposit after `expires_at_ms`: the invoice becomes `EXPIRED` (paid_amount 0), and a later
   `sweep()` (non-OPEN branch) sends the whole balance to the merchant as `EXTRA_SWEPT`. The tax vault gets 0
   instead of `tax_bps`. Sweeping before expiry splits correctly. v2: apply the split in `sweep()` to funds that
   arrive while `paid_amount == 0` even after `EXPIRED`, and always route `tax_bps` of extra-swept funds to the vault.
2. **contract-2 (low): failed transfer after PAID.** If the merchant or tax vault is a valid id of a non-existent
   account, its detached transfer fails and bounces to the invoice account while the record already says PAID.
   A bounced tax share is later forwarded to the merchant by `sweep()`; a missing merchant leaves the funds stuck
   until someone registers that name. The CLI/dashboard check both accounts exist when issuing (hand-made
   invoices bypass this). v2: `then()` callbacks recording failed transfers, retrying a failed tax share to the
   vault only (`pending_tax`).
3. **contract-3 (low): `pay()` ignores parked funds.** A payer who already sent the amount by plain transfer and
   then runs `pay` is charged twice: the second amount is split 92/8, the first stays parked and goes to the
   merchant untaxed via `sweep()` with no refund path (payer unknown). Check `zi status` before paying. v2: in
   `pay()`, if OPEN and the free balance minus the deposit already covers `amount`, settle the parked funds like
   `sweep()` and refund the deposit.
