# ZeroInit contract v3: stablecoin (NEP-141) support and the v2 residual fixes

Status: **v3 was deployed on testnet and run live (2026-11-10); the current deployment is v3.1** (v3 plus the F1 fix, code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, deploy tx
`52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, 163,771 bytes, sha256 `1b1dcc75…e278`); the section "Live results (v3.1)" at the end says what was run on it. The interface in this file is the same
for both; v3 is recorded history. Everything below that says "v3" and a code hash describes the first build, `Ut7EQh…reWa`. The v3 contract, the client, the dashboard and the tests are in this repo. The wasm was built with
`npm run contract:build`: 161,213 bytes, sha256 `0724781dd2c9f4f1b8bb30abbff0602578a7ad649fc5a450d4656ffde4740b1f`, code hash
`Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`. The operator deployed it as a global contract (tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT`, measured burn about
16.1226 NEAR) and created the `sm1110-zi3-*` accounts and the tUSDC mock `sm1110-tusdc.testnet`. The live runs are recorded in `docs/SPIKES.md` ("Contract v3 live")
and replay offline from `fixtures/v3/`. **Read the rest of this file as the interface spec plus history:** the design text and the "Build notes" below were written
before the deploy and still say "not deployed" and "to measure"; the section "Live results" at the end says what the runs showed, which numbers are now measured, and the
one design statement that was wrong (the final value of `ft_transfer_call`). v2 (`4bQ61AgH…yx9zEA`) is recorded history. `docs/plan/` is the locked original plan and is not touched.

What was actually run for this design (2026-11-10, read-only):

- the v3 state test vectors in section 3, computed with the existing `src/bytes.ts` helpers in a scratch script;
- the account ids in section 2 (and `sm1110-zi3-fake.testnet` from L11) were checked against the public RPC `https://rpc.testnet.fastnear.com`
  (`view_account`): all answer `UNKNOWN_ACCOUNT`, so they are free today;
- `near-contract-standards` 5.30.1 (`internal_ft_resolve_transfer`, the token code the mock tUSDC in
  `hackathons/test-usdc` uses) was read: if `ft_on_transfer` fails or returns something that is not a `U128`, the **whole** amount counts as
  unused and is refunded to the sender. The design relies on this.

Nothing else (gas numbers, registration costs, protocol behaviour of `0u` ids on a token contract) has been tested. Section 12
lists the spikes that must run first.

## 1. Decisions in one table

| Topic | Decision |
|---|---|
| Version | contract **v3**, new wasm, new code hash, new global-contract deployment. v1 and v2 stay on testnet as recorded history and keep working. |
| Asset | each invoice has `token: Option<AccountId>` in its state (and so in its address): `None` = NEAR (as before), `Some(id)` = that NEP-141 token. Fixed for the life of the invoice. |
| Allow-list | enforced in the **client** (`src/config.ts`, `ZI_TUSDC_ACCOUNT`) at issue, verify, pay. The contract enforces the token stored in the invoice (`predecessor == token`), which is an allow-list of one, set at state init and committed by the address. Reason in 4.7. |
| Incoming tokens | only through `ft_on_transfer` (`ft_transfer_call`, one step, initialised invoice) or a plain `ft_transfer` that sits on the token contract until someone calls `sweep`. |
| Outgoing tokens | `ft_transfer` with 1 yoctoNEAR, always joined into one callback `on_settled` that records what failed. |
| Fix 1 (`invoice_paid` too early) | no event is emitted by `pay`/`sweep`; `on_settled` emits `invoice_paid` only after every payout succeeded. New status `SETTLING` in between. |
| Fix 2 (stranded merchant share) | a failed payout becomes an owed record in the state. `sweep` retries owed amounts to their own recipient only. After the invoice's grace period, anyone can call `refund_payer`, which pays the owed shares back to the payer (`paid_by`) and nobody else. |
| Fix 3 (untaxed parked part) | every amount the contract pays to the merchant side is split `tax_bps` / rest, including overpayments and later extra funds. Nothing reaches the merchant untaxed. |
| Account ids | new testnet accounts `sm1110-zi3-*` (section 2). The v2 accounts and invoices are not reused or changed. |
| Decimals | amounts are raw `u128` strings everywhere; the client converts with the token's decimals (pinned in the allow-list and checked against `ft_metadata`). |

## 2. Identity of v3: code hash, accounts, addresses

- **Code hash:** unknown until the wasm is built. It is the base58 of `sha256(contract/res/zeroinit_invoice.wasm)`, the same way
  v1 and v2 were derived. Call it `V3_CODE_HASH`. It is written to `src/config.ts`, `.env.example`, `test/helpers.ts` (`DEPLOYED`) and the README
  only after the contract is frozen (section 12, step 6). A contract change after the operator deploys means another deploy
  (v2 burned 8.2949 NEAR for 82,942 bytes; v3 will be larger, expect roughly 9 to 11 NEAR, to measure).
- **Why addresses change:** an invoice id is `0u` + base32(SHA3-256(borsh state init)), and the state init holds the code hash and the
  initial `STATE` bytes. v3 changes both: a new hash, and a new state layout (section 3). The same terms (merchant, tax vault, amount,
  expiry, salt) give a different address under v3 than under v2. Existing v1/v2 invoice ids are unaffected and keep
  working against their own code. Nothing is migrated: invoice accounts are immutable and hold no state worth moving.
- **Accounts for v3** (all free on testnet on 2026-11-10, created by the operator; the prefix is a suggestion, the operator may change it):

| Id | Role |
|---|---|
| `sm1110-zi3-deployer.testnet` | signs the v3 `DeployGlobalContract` (one-time burn) |
| `sm1110-zi3-merchant.testnet` | merchant, registered on tUSDC |
| `sm1110-zi3-taxvault.testnet` | tax vault, registered on tUSDC |
| `sm1110-zi3-payer.testnet` | payer, registered on tUSDC, holds minted tUSDC and NEAR |
| `sm1110-zi3-sweeper.testnet` | a third party that sweeps (proves "anyone"), registered on tUSDC, NEAR for gas only |
| `sm1110-zi3-unreg.testnet` | exists on NEAR, **not** registered on tUSDC: the "unregistered receiver" failure case |
| `sm1110-zi3-fake.testnet` | a second mock NEP-141 instance (same `test-usdc` source) for the "wrong token" case (L11) |
| `late.sm1110-zi3-merchant.testnet` | **not created** at first: the "merchant that does not exist yet" case; the parent account can create it later |

  The tUSDC account id is given later by the operator (shared mock, 6 decimals). It is a public id, not a secret. It goes into
  `.env` as `ZI_TUSDC_ACCOUNT` and into `src/config.ts` as the default once known. Minting is owner-only (`mint(account_id, amount)` after
  `storage_deposit`), so the operator mints the test balance for the payer.
- **Repo layout:** `contract/` (v2 source, tests, wasm) moves to `contract-v2/` in a pure-rename commit first (like the v1 recordings did in
  `70d4226`), so no v2 test is deleted and `cargo test` still runs there. `contract/` then holds v3. `npm run contract:test` runs v3;
  add `contract:test:v2`. Same for recordings: `fixtures/*.json` and `invoices/demo/` (v2) move to `fixtures/v2/` and `invoices/v2/`
  (`loadDoc` searches `invoices/v2/` too); new v3 recordings take the top-level names.
- **Client deployments list (`KNOWN_DEPLOYMENTS`):** v3 current, v2 `historical: true` (verify and replay only, like v1). To keep operating a v2
  invoice the operator pins `ZI_CODE_HASH=<v2 hash>` (the existing mechanism). The chain does not care: v2 keeps working there.

## 3. State layout (frozen for v3) and storage budget

Borsh, field order is the layout. `v` is 3 (v1 and v2 wrote 1). Fields 9, 10 and 16 to 20 are new, and `status` has two new values.

| # | Field | Type | Initial | Note |
|---|---|---|---|---|
| 1 | `v` | u8 | 3 | |
| 2 | `invoice_id` | String | | `^[A-Za-z0-9_-]{1,32}$` |
| 3 | `merchant` | AccountId | | |
| 4 | `tax_vault` | AccountId | | |
| 5 | `tax_bps` | u16 | | 0..=10000 |
| 6 | `amount` | u128 | | raw units of the asset (yoctoNEAR or token base units), > 0 |
| 7 | `expires_at_ms` | u64 | | |
| 8 | `salt` | u64 | | |
| 9 | `grace_ms` | u64 | | **new.** How long after `max(expires_at_ms, paid_at_ms)` an undelivered share can be refunded to the payer. Client default 7 days (604,800,000); client accepts 60,000 to 31,536,000,000 (1 minute to 365 days). The short minimum exists so live tests do not wait a week. |
| 10 | `token` | Option<AccountId> | None or Some | **new.** Terms: hashed into the address. |
| 11 | `status` | u8 | 0 | 0 OPEN, 1 PAID, 2 EXPIRED, **3 SETTLING**, **4 REFUNDED** |
| 12 | `paid_by` | Option<AccountId> | None | |
| 13 | `paid_at_ms` | u64 | 0 | |
| 14 | `paid_amount` | u128 | 0 | total settled to the merchant side (see 5.3) |
| 15 | `tax_amount` | u128 | 0 | tax part of `paid_amount` (always `sum(floor(x*bps/10000))` over the settled amounts) |
| 16 | `owed_merchant` | u128 | 0 | **new.** Merchant share that is not delivered |
| 17 | `owed_tax` | u128 | 0 | **new.** Tax share that is not delivered (replaces the v2 `OWED_TAX` storage key) |
| 18 | `owed_payer` | u128 | 0 | **new.** Amount owed back to `refund_to` |
| 19 | `refund_to` | Option<AccountId> | None | **new.** Recipient of `owed_payer` |
| 20 | `busy_until_ms` | u64 | 0 | **new.** Payout lock (4.3) |

Fields 16 to 20 are always present, so the initial bytes are fixed by the terms and the address commits to "nothing owed, not busy".
There is no storage key outside `STATE` any more (v2 kept `OWED_TAX` outside it).

Test vectors, computed with the existing `src/bytes.ts` helpers (to be pinned by one Rust test and one TS test each, same hex in both).
Terms: `invoice_id=INV-0001`, merchant `zi-merchant.testnet`, tax vault `zi-taxvault.testnet`, `tax_bps=800`, `expires_at_ms=1794700800000`,
`salt=42`, `grace_ms=604800000`.

NEAR, `amount = 10^24`, `token = None`, 201 bytes:

```
0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a0000000000000000840c2400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

Token, `amount = 1000000` (1 tUSDC), `token = Some("tusdc.example.testnet")` (a vector id, not the real token), 226 bytes:

```
0308000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e6574200340420f0000000000000000000000000000f080dca10100002a0000000000000000840c2400000000011500000074757364632e6578616d706c652e746573746e6574000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

The v2 vector (135 bytes, in `docs/plan/INTERFACES.md` §2.3) is **not** changed and stays pinned: v1/v2 documents keep deriving
their ids with the old layout (`format: "zeroinit-invoice/1"`). A v3 document uses `zeroinit-invoice/2` (section 9).

**Storage budget.** The zero-balance rule needs `storage_usage ≤ 770` bytes. Derived from the two v2 measurements
(`INV-1111-V2-A` 358 B after `pay`, `INV-1111-V2-B` 331 B after `sweep`): both give the same account overhead of **132 B**
(358 − (181 state + 5 key + 40 record) and 331 − (154 + 5 + 40)). Worst case for v3 with every string at its maximum length (invoice id 32,
merchant/vault/token/paid_by/refund_to 64 each, all owed fields set): state 519 B, plus 45 B record overhead, plus 132 B = **696 B**,
under 770 with 74 B to spare. Because every field is fixed-size or bounded, no sequence of calls can push an invoice over the limit;
a unit test asserts this arithmetic (section 11.1). The live number for a normal invoice is to measure (derived expectation: v2's 181 B state after `pay` plus 66 B of new fields is 247 B, so about 132 + 45 + 247 = 424 B).

## 4. The model: asset, ledger, batch, lock

### 4.1 Asset

One code path for both kinds. `Asset` is `Near` (when `token` is `None`) or `Token(id)`.

- `send(to, amount)`: NEAR: `Promise::new(to).transfer(amount)`. Token: a function call on the token contract,
  `ft_transfer {"receiver_id": to, "amount": "<amount>"}` with **1 yoctoNEAR** attached and 15 Tgas.
- `balance()`: NEAR: `free_balance()` as in v2 (account balance minus the storage reserve, which is 0 while usage ≤ 770).
  Token: `ft_balance_of {"account_id": <this account>}` on the token, a cross-contract call whose result arrives in a callback.

The 1 yocto per `ft_transfer` comes from the invoice account's own NEAR balance. A fresh invoice account has none, so `fund()` exists (5.6).
A successful `ft_transfer` keeps the yocto on the token side; a failed one refunds it to the invoice account.

### 4.2 Ledger (the "owed" record)

`owed_merchant`, `owed_tax`, `owed_payer` (+ `refund_to`) say what the invoice account **holds** (NEAR balance, or tokens on the token contract) that
belongs to a specific recipient and was not delivered. Rules:

1. A payout is **debited from the ledger when it is scheduled** (if it came from an owed amount) and **credited back by `on_settled` if it failed**.
   A first-time payout never touches the ledger when scheduled; a failure credits it. So one rule serves both: "failed → `owed += amount`".
2. Owed amounts are paid **only** to their recipient: `owed_merchant` to `merchant`, `owed_tax` to `tax_vault`, `owed_payer` to `refund_to`.
   No code path sends an owed amount anywhere else. (Unit test 28 checks every receipt of every flow.)
3. `avail` (what a sweep may treat as new money) is `balance − (owed_merchant + owed_tax + owed_payer)`, saturating at 0. Owed money is never
   mistaken for extra funds.
4. A failed refund to a payer sets `owed_payer`/`refund_to` only if the slot is empty or already names the same account. If a second, different
   account's refund fails while the slot is taken, `on_settled` emits `refund_failed` with `"recorded": false` and that amount is not protected
   (it becomes extra funds). This needs a refund to a just-deleted account twice in one invoice; it is listed in the limits.

### 4.3 Payout lock

`busy_until_ms` is set to `now + 300,000` (5 minutes) whenever payouts are scheduled (`pay`, `ft_on_transfer` accept, `sweep`, `refund_payer`; for a
token `sweep` it is set before the balance read) and cleared by `on_settled` (and by `on_token_balance` when it schedules nothing).

- `sweep()`/`refund_payer()` while `now < busy_until_ms`: panic `PAYOUT_IN_FLIGHT`.
- `pay()`/`ft_on_transfer` while busy: the deposit is returned (`REFUNDED_BUSY` / unused = amount, reason `busy`).
- After 5 minutes the lock is simply stale and a new call takes over (a callback that never ran must not freeze the invoice forever).

Why it exists: it closes the v2 residual "extra funds arriving while a tax transfer is in flight go to the vault as the owed share", and for tokens it
stops a second `sweep` from reading `ft_balance_of` while the first one's `ft_transfer`s are still queued on the token contract (the balance would
still include them, and the invoice would be settled twice). The lock is not time-sensitive for correctness inside its window.

### 4.4 Batch and `on_settled`

Every flow that moves money builds one list of payouts and one `Batch`, creates the transfers, joins them with `Promise::and` and ends with
`.then(on_settled(batch))`:

```
Payout { role: u8 /* 0 merchant, 1 tax, 2 payer */, to: AccountId, amount: u128 }
Batch  { kind: u8 /* 0 PAY, 1 TRANSFER, 2 EXTRA, 3 RESEND, 4 RECLAIM, 5 REFUND */,
         result: String, late: bool, excess: u128, refund_reason: String, payouts: Vec<Payout> }   // borsh args
```

`#[private] on_settled(batch)` does, in this order, and **never panics** (a panic would lose the lock release and the ledger update):

1. clear `busy_until_ms`;
2. for each payout `i`: `ok = promise_result_checked(i)` succeeded. Result `i` is the `i`-th payout in the list (payouts with amount 0 are not created and not in the list);
3. every failed payout: credit the ledger (4.2) and emit `transfer_failed`;
4. events for single-purpose payouts, one per payout that succeeded (table in 8): `tax_resent` / `owed_resent` (RESEND), `owed_reclaimed` (RECLAIM), `payment_refunded` (REFUND batches,
   and the payer payout of an `already_funded` batch). `extra_swept` (EXTRA) is emitted only if **all** payouts of the batch succeeded;
5. status changes and `invoice_paid`: after a `PAY`/`TRANSFER`/`RESEND` batch, if `status == SETTLING` and `owed_merchant == 0 && owed_tax == 0`, set `PAID` and emit
   `invoice_paid` (`retried: true` when the batch was a `RESEND`). This is the only place `invoice_paid` is emitted. A failed payer payout (excess refund) does not hold it back. After a `RECLAIM` batch whose payout succeeded, set `REFUNDED`;
6. return a string: `batch.result` if everything succeeded (`"PAID"` when step 5 completed a settlement), else `PAYOUT_PENDING` (`REFUND_FAILED`
   for kind REFUND, `RECLAIM_FAILED` for RECLAIM).

`pay`, `sweep` and `refund_payer` return that promise, so the transaction's final value is the real outcome, not a prediction.
Events are therefore only emitted for transfers that succeeded. In a partly failed `PAY`/`TRANSFER`/`EXTRA` batch the transfers that did succeed are visible in the
receipts but get no event of their own; the later `invoice_paid` covers them (a partly failed `EXTRA` batch has no later event).

A zero-deposit refund (the v2 contract-1 shape: a payer sends `pay()` with 0 after expiry) has nothing to transfer: `payment_refunded` with amount 0 is emitted
at once and the value returned directly.

### 4.5 Status machine

```
OPEN ── pay / ft_on_transfer accepted, or sweep settles ──► SETTLING ── all payouts confirmed (on_settled) ──► PAID
 │                                                            │  ▲ failed payout: owed recorded, status stays
 │ now > expires_at_ms, pay/ft refused                        │  └─ sweep retries owed to its own recipient
 ▼                                                            └─ refund_payer after the grace period, payer known ──► REFUNDED
EXPIRED ── sweep with avail ≥ amount ──► SETTLING (late) ──► PAID
```

`SETTLING` means "the money was accepted and the payouts are in flight or partly failed". `PAID` means "every share was delivered". v2 said PAID in both
cases. The client and the dashboard show `SETTLING` as its own badge, and `zi pay` exits 1 on it.

### 4.6 Tax rule (fix 3)

`split_of(x) = (x − t, t)` with `t = floor(x · tax_bps / 10000)`. Every amount the contract pays to the merchant side goes through it:
the invoice price on `pay`; the whole parked amount on a plain-transfer settle (so an overpayment is taxed, not just the price); later extra funds
(`EXTRA_SWEPT`, in v2 100% to the merchant); the pro-rata release after expiry. The two things that are **not** taxed are refunds of the payer's own
money (excess, rejected deposits, `refund_payer`) and an owed share that is re-sent (it was split when it was first scheduled). `paid_amount` and
`tax_amount` stay consistent: `tax_amount` is the sum of the taxes of everything in `paid_amount`.

The scenario of the v2 residual: a plain transfer of 0.05 parks, then `pay` with 0.1 (price 0.1). `pay` settles 0.1 from the deposit (0.092 / 0.008). The
parked 0.05 stays, and the next `sweep` splits it 0.046 / 0.004. Total to the vault: 0.012 (8% of 0.15). In v2 the 0.05 went to the merchant whole.
The payer is not credited for the parked part: the payer paid 0.1 and the invoice received 0.15. This is the same as v2 except for the tax, and the
CLI warns before it (section 9). Crediting the parked part against the deposit (refund 0.05 to the payer) was considered and rejected: it works only
for NEAR, because a token `ft_on_transfer` would have to read the token balance asynchronously before it can answer, and the plan is one rule for both assets.

### 4.7 Why the allow-list is in the client, not the contract

The invoice contract is global, ownerless and has no `init` call; its whole state is written by the state-init action. A list inside the wasm would
bake the tUSDC account id into the code hash, so the operator's id would be needed before the build, and mainnet would need another wasm. Instead each invoice names
exactly one token in its terms. The address commits to it, the contract only accepts that token, and the client refuses to issue, verify-as-OK or pay an invoice
whose token is not on its allow-list or whose decimals/symbol disagree with the allow-list entry and with `ft_metadata`. What this does not protect: someone who
pays a hand-made invoice that names a hostile token with a client that has no allow-list. The merchant picks the token, like the merchant picks the amount.

## 5. Contract methods (v3)

Unchanged names and args: `pay()`, `sweep()`, `get_invoice()`, `get_owed_tax()`. New: `ft_on_transfer`, `refund_payer`, `fund`. Private callbacks:
`on_settled` (replaces v2 `on_transfer`), `on_token_balance`. Args are `{}` for the public calls that take none.

### 5.1 `pay()` (payable, NEAR invoices)

Checked in this order (`d` = attached deposit, `parked = free_balance − d − owed_total`). Each refund is a `REFUND` batch with one payout (role payer, to the
predecessor), unless `d == 0`.

| # | Condition | Result value |
|---|---|---|
| 1 | invoice has a token (**new**) | `REFUNDED_WRONG_ASSET`, deposit back, status unchanged |
| 2 | status is not `OPEN` | `REFUNDED_NOT_OPEN` |
| 3 | `now > expires_at_ms` | `REFUNDED_EXPIRED`, status becomes `EXPIRED` |
| 4 | busy (**new**) | `REFUNDED_BUSY` |
| 5 | `parked ≥ amount` (v2 contract-3, kept) | settle `parked` as a `TRANSFER` batch (taxed, `paid_by = None`) **and** refund `d` in full (`already_funded`) in the same batch |
| 6 | `d < amount` | `REFUNDED_UNDERPAID` |
| 7 | otherwise | accept: status `SETTLING`, `paid_by = payer`, `paid_amount = amount`, payouts merchant `net`, tax `tax`, payer `d − amount` (if > 0), `PAY` batch, lock. Final value `PAID`, or `PAYOUT_PENDING` |

### 5.2 `ft_on_transfer(sender_id, amount, msg) -> PromiseOrValue<U128>` (token invoices)

Called by the token contract after it credited `amount` to the invoice. It returns the **unused** amount; the token's `ft_resolve_transfer` refunds that
to `sender_id`. It never panics on a business rule (a panic also means "return everything", but returning the number lets us emit an event and
change status). `predecessor` is the token; `sender_id` and `amount` are the parameters the token passes. Nothing is read from `msg` except the intent.

`msg` is strict JSON: `{"action":"pay"}` or `{"action":"pay","invoice_id":"<id>"}` (if `invoice_id` is present it must equal the invoice's). Any other
text, any extra field (so a `sender_id` or `amount` in `msg` is rejected, not trusted), empty string, wrong action: rejected.

| # | Condition | Returns | Event `payment_rejected` reason |
|---|---|---|---|
| 1 | `predecessor != token`, or the invoice is a NEAR invoice | `amount` | `wrong_token` |
| 2 | `msg` does not parse or does not match | `amount` | `bad_msg` |
| 3 | status is not `OPEN` | `amount` | `not_open` |
| 4 | `now > expires_at_ms` | `amount`, status becomes `EXPIRED` | `expired` |
| 5 | busy | `amount`; while the status is `OPEN` the lock value `busy_until_ms` is also raised by 1 (see 5.3) | `busy` |
| 6 | account NEAR balance below the number of payouts (1 yocto each) | `amount` | `no_yocto` |
| 7 | remaining gas below 90 Tgas | `amount` | `low_gas` |
| 8 | `amount < invoice.amount` | `amount` | `underpaid` |
| 9 | otherwise | `amount − invoice.amount` (the excess, 0 when exact) | none; accept as 5.1 row 7, payouts via `ft_transfer`, no payer payout (the token returns the excess) |

Parked tokens (plain transfers made earlier) are not looked at here; they are settled by a later `sweep`, taxed (4.6). Refunds are done by the token contract, so there is
no payer payout in our batch and nothing for us to fail; `payment_rejected` records that we asked for the return, and the token's own `ft_transfer`
log (`memo: "refund"`) is the proof it happened.

### 5.3 `sweep()` (anyone; settles funds that arrived without a call)

`sweep` takes no deposit. NEAR: runs the plan below at once. Token: panics `NEEDS_GAS` if prepaid gas is below 150 Tgas, panics `PAYOUT_IN_FLIGHT` if busy, takes the lock,
calls `ft_balance_of(self)` (5 Tgas) and ends with `on_token_balance`, which runs the same plan with `balance = result` and the remaining gas.

Plan, with `bal` the balance, `owed_total`, `avail = bal − owed_total` (saturating):

1. **Owed first.** Pay owed amounts, in this order and each limited to what is left of `bal`: `owed_tax` to the vault, `owed_merchant` to the merchant, `owed_payer` to `refund_to`.
   These are the `RESEND` payouts; each is debited now (4.2).
2. If status is `SETTLING`: stop after step 1 (extra funds wait until the invoice is `PAID`). Nothing to pay: `NOTHING_TO_SWEEP`.
3. If status is `OPEN`, or `EXPIRED` (never paid):
   - `avail ≥ amount`: settle **all** of `avail` through `split_of`: `TRANSFER` batch, status `SETTLING`, `paid_amount = avail`, `tax_amount = tax`, `late` if expired.
   - `avail < amount`, status `OPEN`: nothing is settled. If step 1 paid something, finish with `OWED_RESENT`; otherwise **NEAR: panic `UNDERPAID: available … < amount …`** (v2 string, the whole receipt reverts, funds stay parked).
     **Token: return the value `UNDERPAID`** (a callback must not panic, see 4.4), the lock is cleared and the tokens stay parked.
   - `avail < amount`, status `EXPIRED`, `avail > 0`: release `avail` pro rata through `split_of` (`EXTRA` batch, `EXTRA_SWEPT`), status stays `EXPIRED` (v2 behaviour, now the same rule).
4. If status is `PAID` or `REFUNDED`: `avail > 0` goes through `split_of` (`EXTRA` batch); `paid_amount += avail`, `tax_amount += tax`.
5. Nothing to do at all: NEAR panics `NOTHING_TO_SWEEP`; token returns the value `NOTHING_TO_SWEEP`.

`sweep` passes the lock value it stored to `on_token_balance` (argument `lock`). If `ft_on_transfer` rejected a call as `busy` while the status was `OPEN`, it raised
`busy_until_ms` by 1, so the lock no longer equals `lock`. The balance read may then include that rejected transfer's credit (the token refunds it), so
`on_token_balance` clears the lock, plans nothing and returns `CONCURRENT_PAYMENT`. The invoice stays `OPEN` and the payer can retry. Test:
`token_sweep_racing_a_busy_ft_transfer_call_plans_nothing`. Not fixed: a caller who repeats `sweep` every few blocks can still keep `ft_transfer_call` rejected
as `busy` (each sweep costs gas; `sweep` is permissionless). A plain `ft_transfer` of the full amount followed by a `sweep` is not blocked by this.

Token-only values from `on_token_balance`: `CONCURRENT_PAYMENT` (see above; lock cleared), `BALANCE_UNAVAILABLE` (the `ft_balance_of` promise failed; lock cleared), `NEEDS_YOCTO` (the invoice account has fewer yocto than payouts; send `fund`).
Result strings kept from v2: `PAID`, `EXTRA_SWEPT`, `TAX_RESENT` (only the tax share was re-sent); new: `OWED_RESENT`, `PAYOUT_PENDING`.

### 5.4 `refund_payer()` (anyone; fix 2, second half)

Allowed only when **all** of: `status == SETTLING`; `owed_merchant + owed_tax > 0`; `paid_by` is `Some`; not busy;
`now > max(expires_at_ms, paid_at_ms) + grace_ms`. Otherwise it panics: `NOT_YET: refundable after <ms>`, `NO_PAYER`, `NOTHING_OWED`, `PAYOUT_IN_FLIGHT`.
It moves `owed_merchant + owed_tax` into `owed_payer` (`refund_to = paid_by`) and pays `owed_payer` to `paid_by` as one `RECLAIM` payout (NEAR transfer or `ft_transfer`), under the lock.
If that payout fails, the amount stays in `owed_payer`, and a later `sweep` retries it to `refund_to` (step 1 of 5.3). On success: status `REFUNDED`, event `owed_reclaimed`.

Why only `SETTLING`: in that status the owed amounts are exactly the payer's own undelivered settlement. Owed amounts from later extra funds
(status `PAID`) came from plain transfers of an unknown sender; they only ever go to the merchant or the vault. If `paid_by` is `None` (settled from a plain
transfer, payer unknown) there is nobody to refund: the shares stay owed to their recipients and `sweep` keeps retrying until the account exists.
A partial case is allowed: if the vault was paid and the merchant was not, only the merchant share goes back and the vault keeps what it got.

### 5.5 `get_invoice()` and `get_owed_tax()`

`get_invoice()` returns the v2 fields (`v` is 3; `status` can be `SETTLING` or `REFUNDED`) plus `grace_ms`, `token`, `owed_merchant`, `owed_tax`, `owed_payer`,
`refund_to`, `busy_until_ms` (all `u64`/`u128` as strings). `get_owed_tax()` stays and returns `owed_tax`.

### 5.6 `fund()` (payable, token invoices)

Accepts a NEAR deposit into the invoice account so it can attach 1 yocto to `ft_transfer`. Panics `NOT_A_TOKEN_INVOICE` on a NEAR invoice (a deposit on a NEAR invoice would
look like extra funds) and `NEEDS_DEPOSIT` if the deposit is 0. No event. The client attaches 1,000 yocto (`FLOAT_YOCTO`), enough for hundreds of settlements and retries; it is a tiny
amount that stays on the account. The state-init `deposit` field is **not** used for this: `docs/plan/INTERFACES.md` §4.3 says the unused part of it is refunded to the signer,
and whether it is credited to the account has never been measured (spike S-F4).

## 6. How fixes 1, 2 and 3 map to the design

| v2 residual (README "v1 → v2") | v3 mechanism | Test that fails on v2 (names in 11.1) |
|---|---|---|
| `invoice_paid` emitted before the transfers | no event in `pay`/`sweep`; `on_settled` emits it after all payouts succeed; status `SETTLING` until then | `invoice_paid_only_from_callback`, `failed_merchant_no_invoice_paid` |
| missing merchant strands the share | `owed_merchant`; `sweep` retries to the merchant; `refund_payer` after `grace_ms` to the payer only | `sweep_retries_owed_merchant_to_merchant_only`, `refund_payer_after_grace_pays_paid_by_only`, `nobody_else_can_take_owed` |
| partial plain transfer, then full pay, parked part untaxed | extras and overpayment go through `split_of` | `partial_parked_then_pay_then_sweep_taxes_parked`, `sweep_overpay_is_taxed`, `extra_after_paid_is_taxed` |
| extra funds during an in-flight tax transfer (a second v2 residual) | payout lock | `sweep_while_busy_panics_in_flight`, `no_double_tax_during_flight` |

## 7. Token flows

```
              (merchant computes id offline; nothing on chain; the doc names the token)
NONEXISTENT (NEAR) ── register the 0u id on the token (storage_deposit, payer or exchange) ──► still NONEXISTENT on NEAR
     │                                                         │
     │ plain ft_transfer(0u id, amount)                        │ tokens now sit on the token contract under the 0u id
     │ ───────────────────────────────────────────────────────►│
     │                                                         ▼
     │            anyone: [UniversalStateInit, fund(1000 yocto), sweep()]  ──► INITIALIZED, SETTLING ──► PAID
     │
     └─ [UniversalStateInit, fund(1000 yocto)]  (zi init: payer or merchant)  ──► INITIALIZED, OPEN, no tokens
                    │ ft_transfer_call(0u id, amount, '{"action":"pay"}')  (1 yocto, 200 Tgas)
                    ▼
              ft_on_transfer ──► SETTLING ──► PAID   (or the amount comes back unused)
```

- **Plain path (exchange, wallet).** The payer or exchange registers the invoice id on the token if needed, then sends a plain `ft_transfer`. NEAR still says
  `UNKNOWN_ACCOUNT` for the id; the balance is `ft_balance_of(id)` on the token. The client's `status` reads both. Anyone then sends one transaction to the invoice id:
  `[UniversalStateInit{raw, 0}, FunctionCall fund (1000 yocto), FunctionCall sweep (200 Tgas)]`. The state init creates the account, `fund` gives it the yocto,
  `sweep` reads `ft_balance_of(self)` and splits. The caller pays gas and the 0.007 NEAR account-creation charge, as with NEAR invoices.
- **One-step path (initialised invoice).** `ft_transfer_call` to a **nonexistent** `0u` id cannot work: the token credits the id, then the call to the nonexistent receiver fails and the
  token refunds everything (to confirm in spike S-F2). So the invoice must be initialised first: `[UniversalStateInit, fund]` by whoever pays (the CLI does it for the payer), then
  `ft_transfer_call`. Two transactions from the payer, versus plain `ft_transfer` + a sweep by anyone.
- **Underpay / overpay / expiry**, as for NEAR: `ft_transfer_call` with less than the price is returned whole (status stays `OPEN`); with more, only the price is used and the
  excess is returned by the token; after expiry it is returned whole and status becomes `EXPIRED`. Plain transfers: less than the price stays parked (`sweep` returns `UNDERPAID`), more than the price is settled whole and
  taxed (4.6), after expiry `sweep` releases whatever is parked pro rata.
- **Stray assets.** NEAR sent by plain transfer to a token invoice stays on the account (it only raises the yocto balance); `pay()` attached NEAR is returned (`REFUNDED_WRONG_ASSET`).
  A different token sent by plain `ft_transfer` is stuck on that token contract (nobody can move it; like a mistyped address). A different token sent with `ft_transfer_call` is returned
  (`wrong_token`).

### 7.1 NEP-145 registration (who registers whom)

A NEP-141 token only holds a balance for registered accounts (`storage_deposit`). The mock tUSDC uses the standard `FungibleToken` implementation: a transfer to an unregistered account fails,
and `storage_deposit {account_id, registration_only: true}` can be paid by **anyone** for **any** account (about 0.00125 NEAR; read the minimum from `storage_balance_bounds().min`, attach it, the excess is refunded).

| Account | Registered by | When | Client |
|---|---|---|---|
| the invoice's `0u` id | the payer or exchange (it pays the tiny storage deposit) before the first `ft_transfer` / `ft_transfer_call`. Anyone else may do it too. | before any token reaches the invoice | `zi pay` and `zi pay --plain` check `storage_balance_of(id)` and register if `null`; `zi token register <invoice id>` does only that |
| merchant | the merchant (or the issuer for them) once | before the invoice is paid | `zi invoice new --token` checks `storage_balance_of(merchant)` and refuses if `null` (`--offline` skips); `zi token register <account>` |
| tax vault | the tax vault owner (or the issuer) once | before the invoice is paid | same check and command |
| payer | already registered (it holds tokens) | | `zi pay` checks `ft_balance_of` and says so if the payer has too little |
| `refund_to` / `paid_by` | already registered (it sent tokens) | | `refund_payer` fails and is retryable if it was unregistered since |

If a payout fails because the merchant or vault is unregistered, the tokens stay on the invoice's token balance, the callback records `owed_*` and emits `transfer_failed`; the client prints
`register <account> on <token> (zi token register <account>), then run zi sweep <id>`. If nobody ever registers, `refund_payer` after the grace period returns the shares to the payer.

### 7.2 Decimals

On chain everything is a raw `u128`. `amount_raw` in the document is a canonical decimal string. The client converts display amounts with `parseUnits(text, decimals)`: digits and one dot, no
sign, no exponent, no hex, more fraction digits than `decimals` is an error (never rounded), result must be `> 0` and `≤ u128::MAX / 10000` (so `amount × tax_bps` cannot overflow). The decimals come from the allow-list entry (tUSDC: 6)
and are compared with the token's `ft_metadata().decimals` and `symbol` by `zi invoice new` (online), `zi verify` (online) and the dashboard. No floating point anywhere. NEAR keeps 24 decimals via the existing `parseNear`.

## 8. Events and errors

Every event is `EVENT_JSON:{"standard":"zeroinit","version":"3.0.0","event":…,"data":[{…}]}` and carries `"token": <id or null>` in addition to the fields listed. v2 events keep their v2 fields.

| Event | When | Fields |
|---|---|---|
| `invoice_paid` | `on_settled`, when the settlement is fully delivered (first time) | v2 fields: `invoice_id, account_id, via ("pay"/"transfer"), payer, amount, merchant_amount, tax_amount, excess_refunded, late`; new: `retried` |
| `payment_refunded` | `on_settled`, refund payout succeeded (or at once for a 0 deposit) | v2: `invoice_id, account_id, payer, amount, reason` (`underpaid, expired, not_open, already_funded`; new `wrong_asset, busy`) |
| `payment_rejected` | `ft_on_transfer` returned the deposit as unused | `invoice_id, account_id, sender, amount, reason` (5.2), `predecessor` |
| `extra_swept` | `on_settled`, all payouts of an EXTRA batch succeeded | v2: `amount` (to merchant), `to`; now always also `tax_amount`, `tax_to` |
| `tax_resent` / `owed_resent` | `on_settled`, a RESEND payout to the vault / merchant succeeded | `amount, to` |
| `transfer_failed` | `on_settled`, a payout failed (v2 event, now also for payer payouts) | `role` (`merchant`/`tax`/`payer`), `to`, `amount` |
| `owed_reclaimed` | `on_settled`, a RECLAIM payout succeeded | `payer, amount, merchant_part, tax_part` |
| `refund_failed` | a failed payer payout that could not be recorded (4.2 rule 4) | `to, amount, recorded: false` |

Panics: v2 strings `UNDERPAID: available … < amount …` and `NOTHING_TO_SWEEP` stay on the NEAR path. New: `PAYOUT_IN_FLIGHT`, `NEEDS_GAS`, `NOT_YET`, `NO_PAYER`, `NOTHING_OWED`, `NOT_A_TOKEN_INVOICE`, `NEEDS_DEPOSIT`.

## 9. Gas (starting values, to measure)

| What | Value |
|---|---|
| `ft_transfer` promise | 15 Tgas each, 1 yocto |
| `on_settled` | 20 Tgas |
| `ft_balance_of` | 5 Tgas; `on_token_balance` gets all remaining (unused-gas weight 1) |
| minimum prepaid gas for token `sweep` | 150 Tgas (`NEEDS_GAS` otherwise) |
| minimum remaining gas for the `ft_on_transfer` accept path | 90 Tgas (`low_gas` reject otherwise) |
| client: `pay`/`sweep`/`refund_payer` on NEAR invoices | 100 Tgas (v2: 50) |
| client: token `sweep` tx, `refund_payer` | 200 Tgas |
| client: `ft_transfer_call` | 200 Tgas (the token keeps about 35 Tgas for itself and the resolve step) |

Promises created with more static gas than is left fail the current receipt; in `ft_on_transfer` that means the token returns the whole amount, in `sweep` the receipt reverts. Final values come
from live measurement (S-F5) and are then pinned in constants and tests.

## 10. Client, app and UI changes

**Config and allow-list (`src/config.ts`).** `Deployment.version` gains `'v3'`; `KNOWN_DEPLOYMENTS` = v3 (current), v2 (`historical: true`), v1. `ALLOWED_TOKENS = [{ symbol: 'tUSDC', decimals: 6, accountId: ZI_TUSDC_ACCOUNT ?? <default once given> }]`;
until the operator provides the id the default is empty and `--token` is refused with a clear message. Testnet only, as today. `fixesParkedFunds` becomes "which deployment fixes which finding" for `contract-3` and the new ones.

**Documents (`src/invoice.ts`, `src/stateinit.ts`).** Format `zeroinit-invoice/2` adds `asset` (`{"kind":"near"}` or `{"kind":"ft","contract":…,"symbol":"tUSDC","decimals":6}`), `amount_raw` (replaces `amount_yocto`),
`amount_display` (replaces `amount_near`, e.g. `1.5 tUSDC`), `payout_grace_ms`. `/1` documents still load and verify with the old layout (`InvoiceTerms.layout: 1 | 3`; `/1` is NEAR only). `invoiceStateBytes` writes the v3 layout for `/2`.
`checkDoc` also checks: token on the allow-list, symbol/decimals equal the allow-list entry, `amount_display` equals `formatUnits(amount_raw)`, `grace_ms` in range, `scheme == 0u` for tokens (`0s` is refused for tokens: untested).
`termsMatchOnchain` compares `token` and `grace_ms` too. `assertAccountsUsable` also checks NEP-145 registration of merchant and vault for tokens.

**New module `src/ft.ts`.** `ftMetadata`, `ftBalanceOf`, `storageBalanceOf`, `storageBalanceBounds` (view calls via the existing `rpc.ts`), `parseUnits`/`formatUnits`, and action builders on the existing `actFunctionCall`:
`storage_deposit`, `ft_transfer`, `ft_transfer_call`, `fund`. Same recording hooks (`ZI_RECORD`) so fixtures keep working.

**Outcome parsing (`src/outcome.ts`).** `ParsedTx` gains `ftTransfers` (FunctionCall `ft_transfer` actions in receipts whose predecessor is the invoice: token, to, amount, decoded from the args) and `nep141Events`
(logs with `standard: "nep141"`). A failed `ft_transfer` receipt runs on the token account, so it already lands in `downstreamFailures`. For a `ft_transfer_call` transaction the final value is the amount **used** (a JSON string, `"0"` when everything came back; NEP-141's `ft_resolve_transfer`; this section first said "unused", which the live runs disproved), not `PAID`: the client decides the outcome from the events
(`invoice_paid`, `payment_rejected`, `transfer_failed`).

**CLI (`src/cli.ts`).**

| Command | Change |
|---|---|
| `zi invoice new --token tUSDC --amount 1.5 [--grace 7d]` | token amounts in display units; checks allow-list, `ft_metadata`, registration of merchant and vault (`--offline` skips the RPC checks); `0u` only for tokens |
| `zi token register <account or invoice id> [--token tUSDC]` | NEP-145 `storage_deposit` for any account, paid by the payer key, amount from `storage_balance_bounds` |
| `zi token balance <account or invoice id>` | `ft_balance_of` in display units |
| `zi pay <id>` (token) | register the invoice id if needed → `[UniversalStateInit, fund]` if the account does not exist → `ft_transfer_call` with `{"action":"pay","invoice_id":…}`. `--plain` does register + plain `ft_transfer` only (the exchange path), `--amount` for under/overpay tests. Exit 0 only on `invoice_paid`. |
| `zi pay <id>` (NEAR) | as v2 with 100 Tgas; exit 1 on `PAYOUT_PENDING`/`REFUND_FAILED` with the guidance line |
| `zi init <id>` (token) | `[UniversalStateInit, fund]` |
| `zi sweep <id>` (token) | `[UniversalStateInit, fund (only if the account has fewer than 100 yocto or does not exist), sweep]` at 200 Tgas; the token values `UNDERPAID`, `NOTHING_TO_SWEEP`, `NEEDS_YOCTO`, `BALANCE_UNAVAILABLE`, `CONCURRENT_PAYMENT` exit 1 |
| `zi refund-payer <id>` | sends `refund_payer`; prints the time it becomes allowed when it is too early |
| `zi status <id>` | token: `STATE NONEXISTENT tokens_parked=1.5 tUSDC`, or `STATE INITIALIZED status=… tokens=… owed_merchant=… owed_tax=… owed_payer=…` |
| `zi verify <id>` | adds `PASS token-allowed`, `PASS token-metadata-onchain tUSDC 6`; `terms-onchain` includes token and grace; `INFO token-balance` while nonexistent |
| `zi receipt <id>` | token amounts and token transfer receipts |

**Replay (`src/replay.ts`).** The rule set depends on the fixture's deployment: v1/v2 fixtures keep their current rules unchanged; v3 fixtures add `invoice-paid-after-callback` (the `invoice_paid` log sits in an `on_settled` receipt that ran after every payout receipt succeeded),
`no-invoice-paid-on-failure`, `ft-parked-balance`, `ft-split-merchant`, `ft-split-vault`, `ft-rejected <reason>`, `transfer-failed-unregistered`, `owed-after-failure`, `owed-resent`, `refund-payer-to-paid-by`. Tamper tests mutate each recording and expect a FAIL.

**Server and dashboard (`src/server.ts`, `web/`).** Create form: asset selector (NEAR / tUSDC), amount in display units, optional grace. Status API returns `token`, `token_balance_raw`, owed fields, `busy`. Buttons: Pay (token = register + init + `ft_transfer_call`), "Send plain transfer" (shows the exchange path),
Sweep, "Refund payer" (enabled when allowed). New badges `SETTLING` and `REFUNDED`; rows show `1.5 tUSDC`; a token invoice that is `NONEXISTENT` shows the parked token amount. Pay answers 409 with `paid:false` unless `invoice_paid` was seen; `SETTLING` answers 202 with `paid:false, pending:true`. Still `127.0.0.1` only.

**Scripts and env.** `scripts/record-v3-near.sh`, `record-v3-fixes.sh`, `record-v3-tokens.sh`, `record-v3-failures.sh` (section 11.3) in the style of `record-audit-scenarios.sh`; `scripts/plain-transfer.ts` unchanged (NEAR) and a new `scripts/plain-ft-transfer.ts`
(register + `ft_transfer`, signs with the payer key). `.env.example`: `ZI_CODE_HASH=V3_CODE_HASH`, `ZI_TUSDC_ACCOUNT=`, commented `sm1110-zi3-*` names. `scripts/judge-offline.sh` replays the v3 fixtures, then the v2 and v1 ones.

## 11. Tests

Rule for every item: it must fail without the behaviour it guards (checked by running it against the v2 logic or a deliberately broken v3 where v2 cannot compile it), and no existing test is changed or removed (v2 tests stay in `contract-v2/` and `test/`).

### 11.1 Rust unit tests (`contract/src/lib.rs`, v3; near-sdk `unit-testing`)

Helper: `receipts()` returns the created receipts with their actions (Transfer, FunctionCall: method, args, deposit, gas); callbacks are called by hand with `PromiseResult` vectors, as the v2 tests do.

Layout and size
1. `state_layout_is_frozen_near` (the 201-byte hex of section 3)
2. `state_layout_is_frozen_token` (the 226-byte hex)
3. `state_worst_case_fits_zero_balance_limit` (max-length strings: 519 + 45 + 132 ≤ 770)
4. `view_has_token_owed_busy_and_new_statuses`
5. `split_never_loses_a_unit` (many amounts and `tax_bps` 0, 1, 799, 800, 9999, 10000: `net + tax == x`, `tax == floor(x·bps/10000)`)

NEAR `pay` and fix 1
6. `pay_exact_schedules_two_transfers_and_no_event` (status `SETTLING`, `paid_by` set, 2 Transfer receipts joined to `on_settled`, no `invoice_paid` log, lock set)
7. `invoice_paid_only_from_callback` (callback with all `Successful`: status `PAID`, exactly one `invoice_paid`, lock cleared, returns `PAID`)
8. `failed_merchant_no_invoice_paid` (merchant `Failed`: `owed_merchant = net`, `transfer_failed` role merchant, status `SETTLING`, no `invoice_paid`, returns `PAYOUT_PENDING`)
9. `failed_tax_records_owed_tax`, `both_failed_record_both`
10. `excess_refund_failure_records_owed_payer` (payer payout `Failed`: `owed_payer`, `refund_to`)
11. `pay_refund_paths_return_deposit_via_callback`: one test each for `REFUNDED_NOT_OPEN`, `REFUNDED_EXPIRED` (status `EXPIRED`), `REFUNDED_UNDERPAID`, `REFUNDED_WRONG_ASSET`, `REFUNDED_BUSY`; `payment_refunded` appears only after a successful callback; a failed one gives `REFUND_FAILED` and `owed_payer`
12. `zero_deposit_pay_after_expiry_emits_refund_at_once` (the v2 contract-1 shape)
13. `parked_covering_amount_settles_parked_and_refunds_deposit` (v2 contract-3, kept; taxed)

Fix 3 (tax)
14. `partial_parked_then_pay_then_sweep_taxes_parked` (0.05 parked, `pay` 0.1, callback ok, `sweep`: vault gets 0.012 in total, merchant 0.138, nothing untaxed)
15. `sweep_overpay_is_taxed` (1.5 parked on a price of 1: tax is 8% of 1.5, `paid_amount == 1.5`, `tax_amount` matches)
16. `extra_after_paid_is_taxed` (status `PAID`, 0.2 arrives: 92/8 split, `paid_amount`/`tax_amount` grow)
17. `expired_underpaid_release_is_taxed_pro_rata` (v2 audit-1 variant kept)
18. `sweep_underpaid_near_panics_with_v2_string`, `sweep_nothing_panics_with_v2_string`

Fix 2 (owed ledger)
19. `sweep_retries_owed_merchant_to_merchant_only` (after test 8, balance holds the bounce: one Transfer to the merchant, none anywhere else; callback ok: status `PAID`, one `invoice_paid` with `retried: true`)
20. `sweep_retries_owed_tax_to_vault_only` (v2 contract-2 kept)
21. `sweep_in_settling_pays_owed_only_and_holds_extras`
22. `sweep_pays_what_balance_allows` (owed larger than balance: pays `min`, rest stays owed)
23. `failed_retry_restores_owed` (retry callback `Failed`: `owed` back to the same value)
24. `refund_payer_before_grace_panics_not_yet`
25. `refund_payer_after_grace_pays_paid_by_only` (status `REFUNDED`, `owed_*` 0, `owed_reclaimed`, one receipt to `paid_by`)
26. `refund_payer_without_paid_by_panics_no_payer` (settled from a plain transfer)
27. `refund_payer_failure_restores_owed_payer_and_sweep_retries_it`
28. `nobody_else_can_take_owed`: runs every flow above and asserts every receipt receiver is in `{merchant, tax_vault, paid_by, refund_to}` and, for owed amounts, matches the role
29. `refund_payer_twice_second_panics_nothing_owed`, `refund_payer_not_settling_panics`
30. `refund_slot_conflict_emits_refund_failed_unrecorded` (the documented residual)

Lock
31. `sweep_while_busy_panics_in_flight`, `pay_while_busy_refunds_busy`, `lock_cleared_by_on_settled`, `stale_lock_after_5_minutes_is_taken_over`
32. `no_double_tax_during_flight` (v2 residual: pay accepted, callback not yet run, funds arrive, `sweep` panics; after the callback the extra is taxed once)

Token
33. `ft_on_transfer_rejects_wrong_token_and_near_invoice` (returns `amount`, state unchanged, `payment_rejected wrong_token`)
34. `ft_on_transfer_bad_msg_variants` (empty, not JSON, `{}`, unknown action, extra field `sender_id`, extra field `amount`, wrong `invoice_id`, wrong case: all return `amount`, no state change)
35. `ft_on_transfer_not_open_expired_busy_no_yocto_low_gas_underpaid` (one assert block per reason: returns `amount`; expired also sets `EXPIRED`)
36. `ft_on_transfer_exact_accepts` (returns 0, status `SETTLING`, `paid_by = sender_id` from the parameter, two `ft_transfer` function calls to the token with deposit exactly 1 yocto, correct `receiver_id`/`amount` args, joined to `on_settled`)
37. `ft_on_transfer_overpay_returns_excess_and_pays_price_only`
38. `ft_on_transfer_does_not_trust_msg_fields` (a `sender_id` inside `msg` is rejected; the recorded payer is the parameter)
39. `token_failed_merchant_unregistered_records_owed_and_no_invoice_paid`; `token_failed_vault_records_owed_tax`
40. `token_sweep_reads_balance_then_splits` (`sweep` creates `ft_balance_of` + `on_token_balance`; callback with balance 1,000,000: payouts 920,000 / 80,000)
41. `token_sweep_balance_failure_clears_lock_returns_balance_unavailable`
42. `token_sweep_underpaid_returns_value_and_clears_lock`; `token_sweep_nothing_returns_value`
43. `token_sweep_needs_yocto_when_no_float`; `token_sweep_needs_gas_panics`
44. `token_double_claim_second_sweep_nothing_to_sweep`; `token_second_ft_on_transfer_after_accept_returns_not_open`
45. `token_refund_payer_ft_transfer_to_paid_by`
46. `fund_needs_deposit_and_token_invoice`
47. `pay_on_token_invoice_refunds_near_wrong_asset` (same as 11 but explicit about the asset)
48. `token_split_uses_same_tax_rule` (tax and net equal the NEAR rule for the same raw amount)

Parity check (not a Rust unit test): a TS test builds both state vectors with `src/stateinit.ts` and compares them to the same hex (11.2).

### 11.2 Client tests (`test/`, `node --test`, fake RPC from `test/helpers.ts`)

State, ids, units, config
- `vectors`: v3 NEAR and token state hex equal sections 3's vectors; v1/v2 vectors and ids unchanged (existing tests untouched).
- `units`: `parseUnits`/`formatUnits` round trips; rejects `1.0000001` at 6 decimals, `-1`, `1e3`, `0x10`, `""`, `.5`, `0`, above `u128::MAX/10000`.
- `config`: v3 current, v2 and v1 `historical`; a foreign hash is refused; `pinForVerification` for v2 docs; allow-list empty ⇒ `--token` refused; unknown symbol refused.
- `doc-validation` (token): tampered `token`, `decimals`, `symbol`, `amount_raw`, `amount_display`, `payout_grace_ms`, or `asset.kind` ⇒ `checkDoc` all-false/FAIL; `/1` docs still pass; `0s` + token refused; grace below 60,000 or above 365 days refused.
- `issuance-validation` (token): merchant or vault not registered ⇒ refused; `--offline` skips; wrong on-chain decimals ⇒ refused.

Outcome and replay
- `outcome`: `ftTransfers` extracted from a recorded `ft_transfer` receipt; `nep141Events` parsed; a failed receipt on the token account lands in `downstreamFailures`; `ft_transfer_call` final value `"0"` is not read as `PAID`.
- `replay-v3`: each new check name passes on the recorded fixtures; mutations (delete the `on_settled` receipt, move `invoice_paid` before a failed payout, change a payout amount, swap the recipient) each FAIL; v1 and v2 fixtures still replay with their old rules.

CLI (fake RPC, throwaway signer)
- `zi pay` token order: `storage_deposit` only when `storage_balance_of` is `null`, state init + `fund` only when the account does not exist, then `ft_transfer_call` with 1 yocto, 200 Tgas and the exact `msg`; no `storage_deposit` second time.
- `zi pay` exit codes: 1 on `payment_rejected` (shows the reason), on underpay, on `SETTLING`/`PAYOUT_PENDING`; 0 only with `invoice_paid`.
- `zi pay --plain`: register + `ft_transfer`, no state init.
- `zi sweep` token: actions are `[UniversalStateInit, fund, sweep]` when the account does not exist, `[sweep]` alone when it has yocto; exit 1 on `UNDERPAID`, `NOTHING_TO_SWEEP`, `NEEDS_YOCTO`, `BALANCE_UNAVAILABLE`.
- `zi token register`: attaches `storage_balance_bounds().min`, `registration_only: true`.
- `zi refund-payer`: prints the allowed time when it is early (parsed from `NOT_YET`).
- `zi status` and `zi verify` token lines (`tokens_parked`, `token-allowed`, `token-metadata-onchain`); `verify` FAILs on a token outside the allow-list.
- `zi pay` NEAR: v2 behaviour kept (flags, output), 100 Tgas, exit 1 on `PAYOUT_PENDING`.

Server and dashboard
- token create validation (asset, units, allow-list), 409/`pending` mapping for `REFUNDED_*`, `payment_rejected`, `SETTLING`; badges `SETTLING`/`REFUNDED` and token amount in `state.js` (`dashboard-state`); DNS-rebinding and content-type guards unchanged.

### 11.3 Failure cases that must each have a test (matrix)

| Case | Rust | Client | Live |
|---|---|---|---|
| unregistered receiver (merchant/vault not on the token) | 39 | `zi invoice new` refuses; outcome parse of the failed receipt | L13 |
| unregistered invoice id | n/a (token side) | `zi pay` registers first | L6 (spike S-F1) |
| wrong token | 33 | | L11 |
| wrong `msg` | 34, 38 | | L12 |
| callback failure (payout `Failed`) | 8, 9, 10, 23, 27, 39 | replay `owed-after-failure` | L2, L13 |
| double claim (second sweep / pay / refund) | 29, 44 | CLI exit codes | L15 |
| concurrent sweep | 31, 32 | | L15 (best effort) |
| low gas | 35, 43 | | L19 |
| NEAR on a token invoice | 47 | | L16 |
| expired, underpaid, overpaid | 11, 14 to 17, 35, 37 | | L8 to L10 |

### 11.4 Live testnet runs to record afterwards (operator and builder)

Spikes first (S-F1 to S-F5, section 12). Then, with the `sm1110-zi3-*` accounts, each as a replayable fixture plus a section in `docs/SPIKES.md`:

| Run | What it records |
|---|---|
| L1 | NEAR parity: pay, plain transfer + sweep by `sweeper`, underpay, expired, double pay (ids `…-V3`) |
| L2 | fix 1: merchant `late.sm1110-zi3-merchant.testnet` does not exist; `pay` ⇒ `PAYOUT_PENDING`, status `SETTLING`, `transfer_failed`, **no** `invoice_paid` |
| L3 | fix 2a: the parent account creates `late.…`; `sweep` ⇒ merchant paid, `invoice_paid` with `retried: true`, status `PAID` |
| L4 | fix 2b: same shape, short expiry and `grace_ms = 120000`, merchant never created; `refund_payer` before the window (panics `NOT_YET`, recorded), then after it ⇒ payer gets the net share back, `REFUNDED` |
| L5 | fix 3: plain 0.05, `pay` 0.1, `sweep`; vault total 0.012, merchant 0.138 |
| L6 | token plain path: register the id, plain `ft_transfer` 1 tUSDC, `status` shows nonexistent + parked, `sweeper` sends init + fund + sweep ⇒ 0.92 / 0.08 tUSDC, `invoice_paid` after the callback, `zi verify` all PASS |
| L7 | token one-step: `zi init`, then `ft_transfer_call` ⇒ `PAID` |
| L8 | token overpay via `ft_transfer_call`: only the price used, excess back in the token's refund log |
| L9 | token underpay: `ft_transfer_call` returned whole (status `OPEN`); plain underpay ⇒ `sweep` returns `UNDERPAID`; after expiry `sweep` releases pro rata, taxed |
| L10 | token expiry via `ft_transfer_call`: returned, `EXPIRED` |
| L11 | wrong token: a second mock token instance (`sm1110-zi3-fake.testnet`, built from the same `test-usdc` source) `ft_transfer_call` ⇒ returned, `payment_rejected wrong_token` |
| L12 | wrong `msg` (`""`, `{"action":"x"}`) ⇒ returned |
| L13 | unregistered receiver: merchant `sm1110-zi3-unreg.testnet`; `pay` ⇒ vault paid, merchant `transfer_failed`, `SETTLING`; register it; `sweep` ⇒ delivered, `PAID` |
| L14 | token `refund_payer`: unregistered merchant never registered, window passed ⇒ payer refunded in tUSDC |
| L15 | double claim: second `sweep` ⇒ `NOTHING_TO_SWEEP`; second `ft_transfer_call` ⇒ returned `not_open`; two sweeps sent back to back (record what happens, claim only that) |
| L16 | `pay()` with NEAR on a token invoice ⇒ `REFUNDED_WRONG_ASSET` |
| L17 | `zi verify` on every v3 invoice; `no-access-keys` |
| L18 | gas, tokens burnt and storage per run (replaces the section 9 estimates; updates the cost table in `docs/ARCHITECTURE.md`) |
| L19 | `ft_transfer_call` with 40 Tgas ⇒ returned whole |

The README and the docs only quote what the replays and the verification run show; a line for a run that did not happen is not written.

## 12. Order of work, spikes, open questions

Order (each step is one commit): 1. pure rename of v2 (`contract/` → `contract-v2/`, v2 fixtures/invoices → `v2/`), tests green; 2. contract v3 + the Rust tests of 11.1; 3. TS encoders, document `/2`, the
two vectors, units, config; 4. `src/ft.ts`, outcome parsing, CLI, their tests; 5. server and dashboard; 6. **contract freeze**: Sonnet review, then Opus review, then build the wasm, compute and record `V3_CODE_HASH`; 7. operator: accounts, tUSDC registrations and mint, global deploy,
spikes, live runs; 8. fixtures, replay checks, docs with measured numbers. Nothing after step 6 may change the contract without a new deploy.

Spikes (live, before step 6; each result is written to `docs/SPIKES.md` and can change this design):

| # | Question | If the answer is no |
|---|---|---|
| S-F1 | does tUSDC accept `storage_deposit` and `ft_transfer` to a never-seen `0u` id, and does `view_account` still say `UNKNOWN_ACCOUNT`? | the plain token path is dead; token invoices would need an init-first flow |
| S-F2 | does `ft_transfer_call` to a nonexistent `0u` id return the whole amount (balance unchanged)? | the one-step path has to be documented as unsafe or removed |
| S-F3 | does `[UniversalStateInit, FunctionCall fund, FunctionCall sweep]` work in one transaction, and what do `view_account` and `ft_balance_of` show afterwards? | split into two transactions |
| S-F4 | is the `UniversalStateInit.deposit` credited to the account? (not relied upon) | none, informational |
| S-F5 | gas per method on testnet, final constants of section 9 | adjust the constants before the freeze |
| S-F6 | storage usage of an initialised token invoice after settle and after a failure | adjust the section 3 estimate |

Open assumptions (nothing here was tested): the `0u` id is accepted as `AccountId` by the token contract (it has the same characters as any account id and the v2 unit tests already parse one, but the token side was not run);
the 1,000 yocto float is enough and is not rejected; five minutes is long enough for a payout cycle; floor rounding of the tax is acceptable (it is the v2 rule).

## 13. Docs to update when v3 is built

`README.md`: repo map (`contract/` is v3, `contract-v2/`, `fixtures/v2/`), the "NEAR only" limit (replace with the real token limits below), claims table, methods and rules tables, a "v2 → v3" section next to "v1 → v2",
the test count and the offline output (only after running them), the cost lines, the allow-list note, the AI disclosure. `docs/ARCHITECTURE.md`: diagram, lifecycle, transaction shapes (`fund`, `ft_transfer_call`), costs and v3 section.
`docs/SPIKES.md`: S-F1 to S-F6 and "Contract v3 live". `docs/SUBMISSION.md` and `docs/JUDGE-DRYRUN.md`: the new judge path. `.env.example`, `scripts/judge-offline.sh`, `package.json` scripts. `docs/plan/` stays frozen; this file is the v3 interface spec.

## 14. Limits that stay (honest list)

- Tokens: only one token per invoice, only tokens on the client allow-list for the supported flow, `0u` only (no `0s` for tokens), testnet only, mock tUSDC.
- A NEAR plain transfer to a token invoice and a plain `ft_transfer` of another token are not recoverable.
- A callback that never runs (it has 20 Tgas and no known failure path) would leave the lock stale after 5 minutes and the failed share unrecorded.
- A second failed refund to a different payer account while the payer slot is taken is not protected (4.2).
- A merchant that never exists and a payer that is unknown (plain-transfer settle) leave the shares owed forever; they are never given to anyone else.
- Plain-transfer parking and a later full `pay` still charge the payer for both (the tax is now right, the payer's double payment is not refunded).
- Gas and cost numbers are estimates until the live runs; the v3 deploy burn is larger than v2's 8.29 NEAR.
- Nothing here was audited. The v3 contract needs the same review gate as v2 before the deploy.

## 15. AI use for this round

- **Claude Sonnet 5.5** wrote this design (reading the code and docs, the vector computation and the read-only checks listed at the top).
- Plan for the build (carried out; see "Live results" at the end): **DeepSeek V4.1 Flash** builds the contract, client and tests from this file; **Claude Sonnet 5.5** designs, reviews and fixes; **Claude Opus 5.5** does the final review and the operator deploys (accounts, tUSDC registration and mint, the global deploy, the live runs). The README disclosure is updated with what actually happened when each step is done.

## Build notes (2026-11-10, this round)

What was actually run (all offline; nothing touched testnet):

| Command | Result |
|---|---|
| `npm run contract:test` | 61 v3 unit tests pass (`contract/`); 64 after the review round below |
| `npm run contract:test:v2` | 14 v2 tests still pass (`contract-v2/`, the pure rename) |
| `npm test` | 140 client tests pass; 141 after the review round |
| `npm run zi -- vectors` | 8 PASS (v1/v2 vectors unchanged; the v3 hex is pinned in `test/vectors.test.ts`) |
| `npm run contract:build` | 161,213 bytes, sha256 `0724781d…0b1f`, code hash `Ut7EQhLD…reWa` |
| `bash scripts/judge-offline.sh` | v2 and v1 fixtures replay and verify; **no v3 fixture is in the judge path** (none was recorded) |

Not run (impossible before the deploy): S-F1…S-F6, L1…L19, the live gas/storage/cost measurements, the token-side
`0u` acceptance checks, and the operator's accounts/tUSDC/deploy. So every number in §9, §3's live storage expectation
and the "deployed" statements in README remain estimates or v-next.

### Deviations from the design, and why

1. **The §3 hex vectors were truncated.** The strings printed in section 3 are 200 and 220 bytes; the stated lengths
   (201/226) and the field layout are authoritative. The hex lost trailing zero bytes (1 and 6). The tests pin the
   padded vectors (`test/vectors.test.ts`, `state_layout_is_frozen_*`), and `src/stateinit.ts` writes 201/226 bytes.
2. **`Payout` carries two extra fields.** `from_owed` marks a retry of an amount that was already in the owed ledger
   (only those emit `tax_resent`/`owed_resent` and were debited when scheduled). `near` says the payout is a NEAR
   transfer even on a token invoice: a rejected `pay()` on a token invoice refunds an attached **NEAR** deposit, and a
   test caught the first implementation sending it as `ft_transfer`. `Payout`/`Batch` are private callback args, so
   their borsh layout is not a public compatibility surface.
3. **`Batch` carries `merchant_part`, `tax_part` and `lock`.** The `owed_reclaimed` event needs the split, and a
   rejected `pay()` refunds the deposit without owning the payout lock: `on_settled` clears the lock only when the
   batch took it (`lock: true`). Clearing it unconditionally (as §4.4 step 1 says) would let a sweep run while the
   original settlement payouts are still in flight.
4. **`on_settled` event selection is per payout, not per batch kind.** A sweep can re-send owed amounts and settle
   extra funds in one batch; the design's kind-only rule cannot express both. Successful payouts with `from_owed` emit
   `tax_resent`/`owed_resent`; the `extra_swept` event is emitted only when every payout of the batch succeeded, as designed.
5. **`ft_on_transfer` returns `U128(unused)` immediately and runs the payout batch detached.** If it returned the
   `on_settled` promise, the token's `ft_resolve_transfer` would receive the callback's string instead of a `U128` and
   treat the whole amount as unused (near-contract-standards refunds everything when the value is not a `U128`) — every
   accepted token payment would be silently refunded. The client therefore reads `invoice_paid`/`payment_rejected`, not
   the final value (section 10 already says this).
6. **`on_token_balance` returns the `on_settled` promise** for a scheduled batch, so a token `sweep` transaction's final
   value is the real outcome. For no-op cases it returns the short value; a panic string that starts with `UNDERPAID`
   is mapped to `UNDERPAID` (§5.3 says the token path returns the value, not the NEAR panic string).
7. **A reclaim retry that completes sets `REFUNDED`, not `PAID`.** §4.4 step 5 would mark a `SETTLING` invoice `PAID`
   after a `RESEND` that only paid `owed_payer`; that is a payer refund, not a payment. A `RESEND` that delivers a
   merchant/tax share still completes the settlement as designed.
8. **`paid_amount` grows on the expired pro-rata release and on extras.** Field 14 is "total settled to the merchant
   side"; the design's step tables did not say whether the release counts. It is added (and `tax_amount` with it), so
   `tax_amount` stays the sum of the taxes of everything in `paid_amount`.
9. **Lock scope.** The lock is taken by settlements, sweeps and `refund_payer`; rejection refunds of a `pay()` do not
   take or clear it (see deviation 3). A stale lock (5 minutes) is taken over, as designed.
10. **Documents follow the deployment.** New issuance on the v3 hash writes `zeroinit-invoice/2` (layout 3); v1/v2
    hashes write `/1` (layout 1). A `/1` document on the v3 hash is refused (`format-matches-deployment`): its state
    bytes would be unreadable by the v3 contract. A custom pinned hash defaults to `/1`; `--layout 3` is the escape
    hatch for a custom v3-like deployment. `checkDoc` takes the allow-list as an optional argument: replay and history
    verification skip it, `zi verify`/`pay`/`invoice new` enforce it (`FAIL token-allowed` when the allow-list is empty).
11. **`zi pay --plain` never initializes the invoice**, even when it does not exist: that is the exchange path, and the
    tokens park on the token contract until someone sweeps. (An implementation that initialized first was caught by the
    action-order test.)
12. **`zi sweep` funds a nonexistent token account.** The design says "fund only if fewer than 100 yocto or does not
    exist"; the first implementation skipped the fund for a nonexistent account, so the sweep had no yocto to attach.
13. **The 48 numbered Rust test items are 61 test functions** (grouped items such as the refund paths, the bad-msg
    variants and the token failures are split into one test each). No v2 test was changed: `contract-v2/` still runs
    its 14 tests, and the v1/v2 document vectors are untouched.
14. **v3 fixtures do not exist.** `fixtures/v3-synthetic-token.json` is **SYNTHETIC** (marked `synthetic: true`): it
    exercises the new replay rules and their 10 tamper mutations in `npm test`, but it is not a recording and is not in
    `scripts/judge-offline.sh`. The recorder scripts (`scripts/record-v3-*.sh`) write `fixtures/v3-near.json`,
    `fixtures/v3-fixes.json`, `fixtures/v3-tokens.json`, `fixtures/v3-failures.json`; they were not run. `judge-offline.sh`
    still replays only the v2 and v1 recordings.
15. **The wasm is larger than v2** (161,213 vs 82,942 bytes). The strict `msg` parser uses a serde derive; the deploy
    burn is therefore unmeasured and will be larger than v2's 8.2949 NEAR. `image_digest` in
    `contract/Cargo.toml` is still `UNSET`, like v2's; the reproducible-build note in README applies to the v2 crate
    now under `contract-v2/`.
16. **The reproducible build was not run** (no Docker here). The wasm is a local `cargo near build
    non-reproducible-wasm` build; a judge's reproducible build must be compared before anyone quotes it as reproducible.

### Not done, explicitly

- The global v3 deploy, the `sm1110-zi3-*` accounts, tUSDC registration/mint, and the second mock token (L11).
- S-F1…S-F6 and L1…L19, the live fixtures, and every gas/storage/cost number marked "to measure".
- The token-side assumption that a never-seen `0u` id can be registered and receive `ft_transfer` (S-F1), that an
  uninitialized `0u` id rejects `ft_transfer_call` safely (S-F2), and that the one-transaction
  `[UniversalStateInit, fund, sweep]` works (S-F3).
- The dashboard was not clicked in a browser this round (no browsers); its pure state functions and the HTTP API are
  tested with `node --test`.
- README/ARCHITECTURE describe v2 as the deployed contract and mark the v3 text "v-next, not deployed yet". After the
  operator deploys, the measured numbers, the deployment labels and the AI-use section have to be updated again.

## Review round (2026-11-10, Claude Sonnet 5.5, commit "review: stablecoin fixes")

I read the whole v3 diff against this spec, ran `cargo test` (61 pass) and `node --test test/*.test.ts` (140 pass) as the
baseline, then fixed what I found. Each fix has a test that fails without it (checked by putting the old code back).
Everything is offline; nothing touched testnet.

Fixed:

1. **Contract: a failed NEAR refund on a token invoice was recorded as owed tokens.** `pay()` on a token invoice refunds the
   attached NEAR. If that refund failed, `on_settled` added the yoctoNEAR amount to `owed_payer`. A later token `sweep`
   would then pay `min(owed_payer, token balance)` in **tokens** to `refund_to`, that is, other people's parked tokens.
   Now a failed NEAR refund on a token invoice emits `refund_failed` (`recorded: false`) and changes no ledger field; the
   NEAR stays on the account. Test: `failed_near_refund_on_token_invoice_is_not_recorded_as_owed_tokens`.
2. **Contract: `refund_payer` could redirect another account's `owed_payer`.** It always overwrote `refund_to` with `paid_by`.
   If `owed_payer` already belonged to another account, that amount would then go to `paid_by`. It now leaves `refund_to`
   alone while `owed_payer > 0` (rule 2 of 4.2 holds). Test: `refund_payer_does_not_redirect_an_owed_payer_of_another_account`.
3. **Contract: the tax split could overflow in a callback.** `split_of` computed `x * tax_bps`, which overflows for a balance
   above `u128::MAX / 10000`; the token balance read by `on_token_balance` is not bounded by the invoice amount rule. A panic
   there would leave the lock stale for 5 minutes. It now computes the same floor without the product. Test:
   `split_does_not_overflow_for_huge_balances` (the old formula panics on it; `split_never_loses_a_unit` still pins the values).
4. **Client: a token `zi pay` (and the dashboard's) parsed the `ft_transfer_call` transaction with the token as "the invoice".**
   The transaction's receiver is the token, so a payout that failed on the token (merchant not registered) was counted as a
   failure of the transaction itself: `RESULT FAILED`, `success: false`, the dashboard answered 502, and `FT_TRANSFER` lines
   were never printed. `sendActions` now takes the invoice account id for that call, so the failure is a downstream failure
   (as in `replay`) and the exit message is the "payout(s) failed, run sweep" one. Test: `pay token: an unregistered merchant ...`
   in `test/cli-token.test.ts` (the earlier fake transactions used the invoice as receiver, which hid this).

Also fixed (no behaviour change in the contract):

- `web/index.html` said "0 = default 7 days" for the grace field, but 0 is rejected (60,000 ms minimum); the field is now
  labelled "empty = default 7 days".
- `scripts/record-v3-fixes.sh`: L4 reused the merchant that L3 had just created, so no payout would have failed; it now
  uses a merchant that is never created (`never.sm1110-zi3-merchant.testnet`). The `near account create-account
  sponsor-by-faucet-service` line cannot create a sub-account; it is now `fund-myself ... sign-as <parent>` (**not run**; check
  the near-cli-rs syntax).
- `scripts/record-v3-tokens.sh`: L14 reused `ZI_UNREG_ACCOUNT`, which `record-v3-failures.sh` (L13) registers, and used a 1 minute
  expiry with a 125 s sleep that does not reach `max(expiry, paid_at) + grace`; it now has its own account (`ZI_UNREG2_ACCOUNT`),
  3 minute expiry and a 240 s sleep. `.env.example` lists the extra variables.
- The wasm was rebuilt: 161,213 bytes, sha256 `0724781d…0b1f`, code hash `Ut7EQhLD…reWa`. The hash in this file's header and
  everywhere else was updated, and the synthetic v3 fixture was regenerated for it (`node scripts/make-synthetic-v3-fixture.mjs`).
  The earlier hash `ATRjmY1x…3Dp3` is obsolete and must not be deployed.

Read and left as it is (noted, not fixed):

- `zi pay` (token) does not check the payer's token balance first (the 7.1 table says it does). A payer with too little tokens
  gets a failed `ft_transfer_call` after registering the id and initialising the invoice; no funds are lost.
- `zi status` and the dashboard show `0` tokens if the `ft_balance_of` view fails (the error is swallowed).
- A token `sweep` that reads its balance while a plain `ft_transfer_call` credit is in flight (credited, `ft_on_transfer` not run yet)
  can include that credit in the balance; the later `ft_on_transfer` then rejects as `busy` and the token returns it. In the
  deployed v3 (code hash `Ut7EQhLD…reWa`) the sweep then plans with a balance the invoice no longer holds: the invoice goes to
  `SETTLING` with `paid_by = None`, both payouts fail and are recorded as owed (`owed_merchant`, `owed_tax`) with 0 tokens behind
  them. A retry with `ft_transfer_call` is rejected `not_open` and `refund_payer` panics `NO_PAYER`. The only recovery is a plain
  `ft_transfer` of the full amount to the invoice followed by `sweep`, which the client's `zi pay` does not do. `sweep` is
  permissionless, so anyone can trigger this, and repeated `sweep` calls can also keep `ft_transfer_call` rejected as `busy`.
  **Fixed in the source (deployed later as v3.1, see "Live results (v3.1)"):** `on_token_balance` takes the lock value that `sweep` set, `ft_on_transfer` raises the lock
  by 1 when it rejects as `busy` on an `OPEN` invoice, and the callback then returns `CONCURRENT_PAYMENT` without planning
  (test `token_sweep_racing_a_busy_ft_transfer_call_plans_nothing`; `cargo test`: 65 passed). This changed the wasm, so it needed a new global
  deploy and a new code hash (v3.1); the v3 recorded runs describe the old code. Sweep spam can still block
  `ft_transfer_call`.
- Not tested live: everything in "Not done, explicitly" above. The `ft_on_transfer` detached batch and the callback gas (20 Tgas)
  are the first things to check in the spikes.
- The slot wrapper `$CONDUCTOR_BIN slot run` failed here with `spawn EPERM`, so `cargo` and `node --test` were run directly.

## Live results (2026-11-10, Claude Sonnet 5.5 with the operator's accounts)

Everything below was run on testnet; the transactions are listed in `docs/SPIKES.md` "Contract v3 live" and the recordings are `fixtures/v3/*.json` (replayed by
`test/live-v3.test.ts`). What the runs showed against this spec:

- **Worked as designed:** NEAR pay, plain transfer + sweep, underpay, expiry, double pay (L1); `SETTLING` + no `invoice_paid` when a payout fails (L2); `refund_payer`
  refused before the window (`NOT_YET`) and paying only the payer after it (L4, L14); a parked part is taxed (L5); the token plain path with a `0u` id that NEAR does not know
  (S-F1), the one-transaction `[UniversalStateInit, fund, sweep]` (S-F3), `ft_transfer_call` after `zi init` (L7), overpay returned by the token (L8), underpay/expired/wrong
  token/bad msg/low gas all returned whole with the specified `payment_rejected` reason (L9, L10, L11, L12, L19), double claims (L15), NEAR on a token invoice (L16), an
  unregistered receiver that is retried to success after its registration (L13), and the payout lock (one run of two simultaneous sweeps: one paid, one `PAYOUT_IN_FLIGHT`).
- **S-F2:** `ft_transfer_call` to a never-initialized `0u` id fails on NEAR (`AccountDoesNotExist`) and the token refunds everything. Safe, as hoped.
- **Wrong in this spec:** §10 said the final value of a `ft_transfer_call` transaction is the *unused* amount. It is the amount *used* (NEP-141): `"1000000"` for a settled
  payment, `"0"` for a rejected one. The proof of what came back is the token's own `ft_transfer` event with `memo: "refund"`; the replay checks that.
- **Behaviour to know:** an invoice that expired while untouched is still `OPEN`. A plain underpay is not released by `sweep` after the expiry time (it returns `UNDERPAID`)
  until some call sets `EXPIRED` (a late `ft_transfer_call` or `pay`, which is returned); after that `sweep` releases the parked amount pro rata, taxed (L9b: 0.46 / 0.04).
- **Measured (replacing §3's and §9's estimates):** a normal invoice is 417 to 445 B of storage (421 B for a NEAR `pay`), the largest seen was 472 B after `refund_payer`
  (limit 770 B, design bound 696 B); gas burnt per transaction is 2 to 22 Tgas (a token sweep with 200 Tgas attached burnt 21.99 Tgas, a token `ft_transfer_call` that settles
  13.13 Tgas); the NEAR `pay` that creates the account burnt 0.00756 NEAR; the global deploy burned about 16.1226 NEAR (the §2 guess was 9 to 11). The 1,000-yocto float is
  enough (998 to 999 yocto left after every settlement). The 40 Tgas test (L19) ended in `low_gas`, not in a failed receipt.
- **Not run in that round:** L3 and S-F4 (both run later on v3.1, below), a reproducible wasm build, any browser test of the dashboard, mainnet.
- **tUSDC is a testnet mock** (`sm1110-tusdc.testnet`, the `test-usdc` source; owner-only mint; no issuer, no value). The contract does not know it: each invoice names one token
  and the client allow-list (`DEFAULT_TUSDC_ACCOUNT` in `src/config.ts`, `ZI_TUSDC_ACCOUNT` overrides it, an empty value turns token invoices off) pins symbol, decimals and
  account. On mainnet the allow-list would name a real issuer's NEP-141 contract (for example a USDC or USDT contract that the issuer runs on NEAR) with its real decimals,
  after `ft_metadata` is checked against it; that was not tested and mainnet is out of scope for this project.
- **AI use for this round:** DeepSeek V4.1 Flash built the contract, client and tests; Claude Sonnet 5.5 designed this spec, reviewed and fixed the build, and ran and
  recorded the live runs; the operator work (accounts, tUSDC, registrations, the global deploy) was done by Claude Opus 5.5, whose final review had not happened when this was written.

## Live results (v3.1) (2026-11-10, Claude Sonnet 5.5 with the operator's accounts)

The operator (Claude Opus 5.5) deployed v3.1 as a new global contract: code hash `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, wasm
163,771 bytes, sha256 `1b1dcc7515f2b9d6bada0540ed20833dd3050d074e155fb8d489ac2afe01e278`, built from commit `49ec835` (the committed `contract/res/zeroinit_invoice.wasm`), burn about 16.38 NEAR
(the operator's figure). The client treats v3.1 as current; v3 is history (`historical: true`, so `zi pay`, `zi sweep` and `zi init` refuse a v3 invoice unless `ZI_CODE_HASH` is pinned to the v3 hash on
purpose, and `verify`/`replay` check v3 documents and fixtures against the v3 hash). The transactions are in `docs/SPIKES.md` "Contract v3.1 live"; the recordings are `fixtures/v31/*.json` and
`fixtures/v3/late-resweep.json`, replayed by `test/live-v31.test.ts` and `test/live-v3.test.ts`.

- **F1 (the race), produced on testnet.** A token `sweep` and an `ft_transfer_call` of the full price were signed first and sent at the same moment (`scripts/race-v31.ts`, invoice `RACE-V31-4`).
  The sweep returned `CONCURRENT_PAYMENT` with no payout and no event; the payment got `payment_rejected busy` and the token refunded the whole 1 tUSDC; the invoice stayed `OPEN`, nothing owed,
  `paid_by` null, lock 0; a retried `ft_transfer_call` was accepted and paid 0.92 / 0.08 tUSDC. This is what §5.3 describes ("returns `CONCURRENT_PAYMENT`, the lock is cleared, the invoice stays `OPEN`
  and the payer can retry"). It took four attempts: three forgot to register the invoice id on the token and failed in the token before the race could happen (`docs/SPIKES.md`, "Failed attempts"); the
  fourth hit the alignment at once. One success is not a rate. The Rust test `token_sweep_racing_a_busy_ft_transfer_call_plans_nothing` covers the logic; the replay rules
  `concurrent-payment-plans-nothing` and `concurrent-payment-nothing-owed` check the recording.
- **Re-recorded on v3.1:** the NEAR demo (`INV-1111-V31-A/B/C`), the tUSDC plain `ft_transfer` + sweep (`TOK-1111-V31-A`) and the one-step `zi init` + `ft_transfer_call` (`TOK-V31-B`, plus a second call
  returned `not_open`): same behaviour as on v3 (0.92 / 0.08, `invoice_paid` from `on_settled`, the final value of `ft_transfer_call` is the amount used).
- **L3, run.** `late.sm1110-zi3-merchant.testnet` was created by its parent `sm1110-zi3-merchant.testnet` (with its own key, `scripts/create-late-merchant.ts`). `LATE-V31` (paid while the merchant did not exist:
  `PAYOUT_PENDING`, `SETTLING`) was then swept: exactly the owed 0.092 NEAR went to the merchant (`owed_resent`), `invoice_paid` with `retried: true`, `PAID`. The v3 invoice `LATE-V3`, whose share had been
  owed on the v3 account, was swept the same way with the v3 hash pinned; both are recorded.
- **S-F4, run: the `UniversalStateInit` deposit is not credited** to the new account. A 0.02 NEAR deposit came back to the signer as a system `Transfer`; the new account held 0. §5.6's reasoning (use `fund`,
  not the state-init deposit) is confirmed. Evidence: `fixtures/v31/sf4.json`.
- **Measured:** see `docs/SPIKES.md` ("Measured on v3.1"): 427 B after a NEAR `pay`, 446 B for a paid token invoice, 4.9 to 22 Tgas per transaction.
- **Not run:** a reproducible wasm build, a browser test of the dashboard, mainnet. v3.1 has no new Rust test beyond the 65 of the source at `49ec835` (the F1 test is among them).
- **AI use for this round:** Claude Sonnet 5.5 ran and recorded the live flows and updated the client, tests and docs; Claude Opus 5.5 did the operator deploy of v3.1 and the re-check.
