# ZeroInit history: v1, v2, v3 and v3.1

This file holds what used to be the long middle of the README: what each contract version fixed, the live evidence, and how to replay the older
recordings. The README keeps only what a judge needs for the **deployed v3.1** contract. Everything here is recorded history on testnet:
v1, v2 and v3 stay deployed, keep replaying under their own code hashes, and are never used by `zi pay` / `zi sweep` / `zi init` (the client refuses them).

Sections: [Replaying the earlier recordings](#replaying-the-earlier-recordings) · [v1 → v2](#v1--v2) · [v2 → v3](#v2--v3) · [v3 → v3.1](#v3--v31) ·
[Older claims](#older-claims-and-how-to-verify-them) · [Deploy transactions](#deploy-transactions-and-burns).

**Transaction lookups:** the default RPC prunes transactions after about 1.5 days, so most hashes below no longer resolve there. Use
`ZI_ARCHIVAL_RPC_URL=https://archival-rpc.testnet.fastnear.com` (`zi receipt --tx` tries it automatically on the default RPC), nearblocks, or replay the fixture
offline (`zi replay fixtures/…`), which never needs a network.

## Replaying the earlier recordings

   The v3.1 recordings in `fixtures/v31/` other than the demos replay the same way: `tokens.json` (init, then one `ft_transfer_call` that settles, then a second one that is returned) and `late.json` (a missing
   merchant, then the L3 sweep after the account was created). The v3 recordings, made earlier the same day on the previous contract, replay under their own hash (history):
   `near.json` (pay, plain transfer + sweep, underpay, expired, double pay), `fixes.json` (a missing merchant gives `SETTLING` and no `invoice_paid`; `refund_payer`; a parked part is
   taxed), `tokens.json` (tUSDC plain path, one-step pay, overpay, underpay, expiry, token `refund_payer`, wrong asset), `failures.json` (an unregistered receiver that is retried to
   success, a wrong token, a wrong msg, little gas, a call to a never-initialized id), `demo-run.json`, `token-demo-run.json` and `late-resweep.json`, each under `fixtures/v3/`; their
   first line says `INFO deployment v3 (history, frozen: …)`.

- `npm run zi -- replay fixtures/v2/demo-run.json` → the v2 demo run (invoice ids `INV-1111-V2-A/B/C`), all `PASS`, exit 0;
   the first line says which deployment the fixture was recorded on; among the checks:

   ```
   INFO deployment v2 (history, frozen: fixes contract-1/2/3; verify and replay only) 4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA
   PASS before-unknown-account INV-1111-V2-A
   PASS pay-tx-success INV-1111-V2-A B7pwrVigiBoziDyFakYa5kFE1JMDkYtg8BNMm2k7XbEz result=PAID
   PASS split-merchant INV-1111-V2-A 0.92
   PASS split-vault INV-1111-V2-A 0.08
   PASS after-status-PAID INV-1111-V2-A
   PASS transfer-path-uninitialized INV-1111-V2-B 1
   PASS sweep-tx-success INV-1111-V2-B HUnCWN2kVy3HQVsVZAL3pL3VrcuJAH6XwxDQUgW8Vyig result=PAID
   PASS refund-event INV-1111-V2-C REFUNDED_UNDERPAID
   ```

- `npm run zi -- replay fixtures/v2/refund-cases.json` → all `PASS`, exit 0; among them:

   ```
   PASS refund-event REF-UNDER-V2 REFUNDED_UNDERPAID
   PASS refund-event REF-EXPIRED-V2 REFUNDED_EXPIRED
   PASS refund-event REF-TWICE-V2 REFUNDED_NOT_OPEN
   PASS split-merchant REF-OVER-V2 0.092
   PASS transfer-path-uninitialized REF-SWEEPLOW-V2 0.05
   PASS sweep-underpaid-reverted REF-SWEEPLOW-V2 2pw7QeQG8JFvzZNQ1hKGwXTwWohnsiE6Rm8Fp8bRoXJR
   ```

- `npm run zi -- replay fixtures/v2/audit-scenarios.json` → the three audit findings re-run live on v2, plus the AUD2-V2 re-sweep, all `PASS`:

   ```
   PASS before-parked-account AUD1-V2 0.1
   PASS pay-tx-success AUD1-V2 678rsqwkrqP6af9EKywJqJzYPKyU9oaFqd9YmRDmjsqm result=REFUNDED_EXPIRED
   PASS split-vault AUD1-V2 0.008
   PASS refund-already-funded AUD3-V2 refunded 0.1 to sm1110-zi-payer.testnet
   PASS transfer-failures-recorded AUD2-V2 1 failed, 1 transfer_failed events
   PASS sweep-tx-success AUD2-V2 HECqnmtEyo7nK7stnh9VoxPHLsmTJyJY3qX3ATUtpife result=TAX_RESENT
   ```

- `npm run zi -- replay fixtures/v1/demo-run.json` → the original v1 recordings still replay (v1 is accepted for
   verifying history only, whatever `ZI_CODE_HASH` says); it reports the deployment it replayed:

   ```
   INFO deployment v1 (history, frozen: known limitations contract-1/2/3; verify only, never pay) Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k
   PASS pay-tx-success INV-1111-A BdzRBcFfwFqxc3TXXB481HcMna1YVYrrj62Z2h48pBTA result=PAID
   PASS sweep-tx-success INV-1111-B 5P2rkpkVQLgBf5poR84kgFrFxgcGf6osEHAzBLHrvKaa result=PAID
   ```

   `fixtures/v1/refund-cases.json` replays the same way.

## v1 → v2

The first contract (**v1**, code hash `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k`, deploy tx
`DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`) was a global contract, so it cannot be changed: an audit found three
issues in it, and a fix means a new wasm and a new hash. **v2** (code hash `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA`,
deploy tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG`, 82,942 bytes, one-time burn 8.2949 NEAR) fixes them and was the
deployed contract until v3 (now recorded history, like v1). Borsh state layout, method names, args,
error strings and the existing events are unchanged; v2 only adds. Because an invoice id derives from the code hash,
the same terms give a different address under v2 (the v2 invoices are new, `-V2` ids).

| | v1 limit (audit) | v2 fix | Live evidence on v2 (replay offline: `fixtures/v2/audit-scenarios.json`) |
|---|---|---|---|
| **contract-1** (medium) | A payer's plain transfer is parked before expiry; after `expires_at_ms` anyone sends the PAY shape with a 0 deposit, `pay()` sets `EXPIRED`, and the later `sweep()` forwards everything to the merchant as `EXTRA_SWEPT`: the tax vault gets 0 and the record shows `paid_amount 0`. | `sweep()` treats `EXPIRED` with `paid_amount == 0` like `OPEN`: `avail ≥ amount` settles 92/8 (`PAID`, `late: true`); less than `amount` is released pro rata (`tax_bps` to the vault). The merchant never receives the tax share of funds that arrived before a payment. | `AUD1-V2`: plain transfer `5CuBjV7tkVt5U6kCrmvjikvgKKcwdKwsqVED2Wyy7arH`, zero-deposit pay after expiry `678rsqwkrqP6af9EKywJqJzYPKyU9oaFqd9YmRDmjsqm` (`REFUNDED_EXPIRED`, the 0.1 NEAR stays parked), sweep `8WQr2GUmH5ojoB1zniD2G4Q6V7PiRk2zjLUyYLpB4GNg` → `PAID`, 0.092 to the merchant and **0.008 to the tax vault**, record `tax_amount` 0.008. |
| **contract-3** (low) | `pay()` looks only at the attached deposit: a payer who first sent a plain transfer and then paid is charged twice, and the first amount reaches the merchant untaxed. | `pay()` on an `OPEN`, unexpired invoice whose free balance minus the deposit already covers `amount` settles the parked funds like `sweep()` and refunds the whole deposit (`payment_refunded`, reason `already_funded`). | `AUD3-V2`: plain transfer `4Eon125bA7ujoLgku6DYoQ6XjgrvMd1aVq4hZGfkwysK`, then pay `3YPLdAp58fc8Fz6kTinRpQfXyT28ExmVY3NGXjL3p4WX` → `PAID`, 0.1 NEAR back to the payer, one 92/8 split (0.092 / 0.008), 0 left on the invoice. |
| **contract-2** (low) | A failed merchant/tax transfer (a valid id of a missing account) bounces to the invoice account while the record already says PAID; a bounced tax share later went to the merchant. | Merchant and tax transfers carry an `on_transfer` callback: a failure emits `transfer_failed`, the tax share is tracked as owed (`OWED_TAX`, outside the frozen state; view `get_owed_tax()`), and a later `sweep()` re-sends it to the tax vault (`tax_resent`, `TAX_RESENT`) and never to the merchant. | `AUD2-V2` (tax vault `unregistered.sm1110-zi-taxvault.testnet`, a nonexistent subaccount that only our own tax-vault account could ever create): pay `ARgzUkMKTZE46DkHVrjjHMqEQUWNMRqJ4QvTT1JaRYeg` → `PAID` + `transfer_failed` (role tax, 0.008) and 0.008 back on the invoice; sweep `7z45ySFYduzwEDAQVneYZHHyjyV9gkGYHQqTe2szgRqj` → `TAX_RESENT`: `tax_resent` 0.008 to the vault, no `extra_swept` to the merchant. This retry bounced again because the vault did not exist. **Later (2026-11-10)** the vault account was created by its parent (`unregistered.sm1110-zi-taxvault.testnet`, tx `FWBnYH6K5J2YzB7aLUNrzT8DNjRTeoqeJvuPaPFhot6x`) and `AUD2-V2` was swept again: tx `HECqnmtEyo7nK7stnh9VoxPHLsmTJyJY3qX3ATUtpife` → `TAX_RESENT`, `tax_resent` 0.008 to the vault, no failed receipt, the invoice account back at 0 NEAR (appended to `fixtures/v2/audit-scenarios.json`, pinned by `test/audit-scenarios.test.ts`). |

The v1 behaviour above comes from the audit and the v1 code; v1 invoices were not re-run live (they stay as the recorded
history). The six `audit_contract_*` unit tests are in `contract-v2/src/lib.rs` (`npm run contract:test:v2`: 14 tests, all pass); `contract/src/lib.rs` is the later v3.x source and has none of them. Each one replays an audit scenario step by step;
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

How the client handles the four deployments: `src/config.ts` keeps a list of known deployments — **v3.1** is the trusted
build (labelled "current, deployed on testnet"; `ZI_CODE_HASH` overrides it), **v3**, **v2** and **v1** are historical. They are
accepted **only to verify recorded history**: `zi verify`, `zi receipt` and `zi replay` check a v1/v2/v3 invoice or fixture
against its own hash, and `zi verify` prints which deployment an invoice uses; `pay`, `sweep` and `init` refuse
a historical or foreign invoice. A foreign hash is never accepted. The v1 mitigation in `zi pay` (refuse to pay when a
plain transfer already parked funds, `--allow-parked` overrides) stays for any hash that is not known to fix contract-3,
and is off for v2, v3 and v3.1. To operate a v3 invoice that is still owed money (the L3 sweep of `LATE-V3`), pin its hash on purpose: `ZI_CODE_HASH=<v3 hash> zi sweep LATE-V3`.

## v2 → v3

Contract **v3** is a new wasm and a new code hash (`Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa`, 161,213 bytes, built from `contract/`), deployed by the operator as a global
contract: tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT`, burn about 16.1226 NEAR (v2: 8.2949). The state layout changes (layout 3: `grace_ms`, `token`, the owed fields,
`busy_until_ms`; statuses `SETTLING` and `REFUNDED`), so the same terms derive a different address than under v2. Existing v1/v2 invoices and their recordings are untouched;
nothing is migrated. `docs/STABLECOIN.md` is the interface spec ("Live results" at its end says what the runs showed); `docs/SPIKES.md` "Contract v3 live" has every transaction.

**The v2 residuals, and what v3 does instead, with the live evidence** (all on testnet 2026-11-10; replay offline with `npm run zi -- replay fixtures/v3/<file>.json`):

| v2 residual | v3 mechanism | Live evidence |
|---|---|---|
| `invoice_paid` is emitted before the transfers run | `pay`/`sweep` emit nothing; the private `on_settled` checks every payout and is the only emitter of `invoice_paid`; `SETTLING` in between | `fixes.json` `LATE-V3`, merchant `late.sm1110-zi3-merchant.testnet` does not exist: pay `Gp1zyoBYjd2T9NKUU8z68hQqCanFt7Agv3TWzjuTMXJ1` → `PAYOUT_PENDING`, `transfer_failed`, status `SETTLING`, no `invoice_paid`. Every settled payment's `invoice_paid` sits in an `on_settled` receipt (`invoice-paid-after-callback`) |
| a missing merchant strands its share | `owed_merchant` (and `owed_tax`) record a failed payout; `sweep` retries it to that recipient only; after `grace_ms`, `refund_payer` returns the undelivered shares to `paid_by` and nobody else | `REFUND-V3` (merchant never created, grace 60 s): `refund_payer` at once fails `NOT_YET` (`B7CN44eo…`), after the window `EKXYxx7R…` → `REFUNDED`, 0.092 back to the payer. Tokens: `TOK-V3-G` (unregistered merchant) → `refund_payer` `5bPgAQZc…` → 0.92 tUSDC back. Retry to success: `UNREG-V3` (merchant not registered on tUSDC): pay `E7wFzkiE…` fails the merchant share, after `zi token register` the sweep `8bPrFWhh…` re-sends exactly 0.92 (`owed_resent`) and `invoice_paid` with `retried: true`. (The NEAR version of this retry, L3, was not run in that first round; it was run afterwards, see "v3 → v3.1".) |
| a partially parked transfer followed by a full `pay` reaches the merchant untaxed | every merchant-side amount goes through `split_of`: overpayments, extras and the pro-rata release are taxed too | `TAX-V3`: plain 0.05 `C1brBZRj…`, pay 0.1 `99naQTxX…` (0.092 / 0.008), sweep `EMaHjcPp…` splits the parked 0.05 as 0.046 / 0.004: the vault got 0.012 in total. `TOK-V3-I`: expired underpay released 0.46 / 0.04 tUSDC |
| extra funds arriving while a tax transfer is in flight | a 5-minute payout lock (`busy_until_ms`): a second sweep panics `PAYOUT_IN_FLIGHT`, a pay refunds `REFUNDED_BUSY`; a stale lock is taken over | one run of two simultaneous token sweeps of `CONC-V3` (not a fixture): `Hkxwhtku…` paid, `D8rvD86f…` panicked `PAYOUT_IN_FLIGHT`. One run only; the Rust tests cover the rest (`sweep_while_busy_panics_in_flight`, `no_double_tax_during_flight`) |

**Tokens (tUSDC, a testnet mock).** One asset per invoice: `None` (NEAR, as before) or one NEP-141 contract in the terms. Incoming tokens come through `ft_on_transfer`
(strict msg `{"action":"pay"}`; overpay is returned by the token, underpay/expiry/bad-msg/wrong-token/low-gas/not-open are returned whole with `payment_rejected <reason>`) or a
plain `ft_transfer` that sits on the token contract until a `sweep` reads `ft_balance_of` in a callback. Outgoing tokens are `ft_transfer` with 1 yocto from a 1,000-yocto float
(`fund`). NEP-145 registration is the payer's/exchange's job for the `0u` id and the merchant's/vault's for their own accounts; the client checks it at issue and before paying.
The allow-list (symbol, 6 decimals, contract) lives in the client, because a list inside the global, ownerless contract would bake an account id into the code hash. Live:

| Case | Evidence (invoice, tx) |
|---|---|
| plain path: register the `0u` id, plain `ft_transfer`, anyone sweeps in one tx (state init + fund + sweep) | `TOK-V3-A`, `TOK-1111-V3-A`: sweep `EXpJhWoh…` / `D6UbC33j…` → 0.92 / 0.08 tUSDC; before it NEAR says `UNKNOWN_ACCOUNT` and the token balance is 1 |
| one-step path: `zi init`, then `ft_transfer_call` | `TOK-V3-B`: `Gx21RYXA…` → `invoice_paid`, payer recorded |
| overpay | `TOK-V3-C`: 1.5 sent, 1 used, the token refunds 0.5 (`6coHo3fs…`) |
| underpay, expired, double claim, wrong token, wrong msg, little gas | `TOK-V3-D`, `TOK-V3-F`, `TOK-V3-B` (again), `WRONGTOK-V3`, `BADMSG-V3`, `LOWGAS-V3`: each `payment_rejected` with its reason and the whole amount refunded by the token |
| NEAR attached to a token invoice | `TOK-V3-H` → `REFUNDED_WRONG_ASSET` |
| `ft_transfer_call` to a never-initialized id | `NOINIT-V3`: the call fails on NEAR, the token refunds the whole amount, the id stays `UNKNOWN_ACCOUNT` |

**What the live runs found** (each fixed with a test that fails without the fix): `ft_transfer_call` returns the amount *used*, not the unused amount, as the spec said
(`"1000000"` for a settled payment, `"0"` for a rejected one; the refund is proven by the token's `ft_transfer` event with `memo: "refund"`); the v3 replay rules had no NEAR split
check and wrongly failed real recordings (second pay on an initialized invoice, setup transactions, repeated snapshots); `zi pay` said "the deposit was refunded" after
`PAYOUT_PENDING`; `zi token register` printed `[object Object]`. An invoice that expired untouched stays `OPEN` until a late call sets `EXPIRED`; this is how the design works, and it
is now documented.

**Measured** (single runs; `docs/SPIKES.md` has the table): storage 393 to 472 B (limit 770 B), 0.00756 NEAR burnt for a NEAR `pay` that creates the account, 2 to 22 Tgas per
transaction, 0.00125 NEAR per token registration.

**Not done in that round.** L3 and S-F4 (both run later, see "v3 → v3.1"), a reproducible wasm build, a browser walk-through of the dashboard, wallet checks, an audit,
mainnet. Tests at the time of the v3 round: 64 Rust tests in `contract/`, 14 in `contract-v2/`, about 150 JavaScript tests (see the README for the current counts).

**v3 limits that stay.** One token per invoice, `0u` only for tokens (`0s` is untested), testnet only, mock tUSDC; a NEAR plain transfer to a token invoice and a plain `ft_transfer`
of another token are not recoverable; a callback that never runs leaves the lock stale after 5 minutes and the share unrecorded; a second different payer refund while the payer
slot is taken is not protected; a merchant that never exists and an unknown payer (plain-transfer settle) leave shares owed forever (they are never given to anyone else); a
partially parked transfer followed by a full `pay` still charges the payer twice (the tax is now right, the double payment is not refunded). **For token invoices this holds for a *full* parked amount too:** `ft_on_transfer` cannot read the token balance already parked (that needs an async `ft_balance_of`), so a plain `ft_transfer` of the full price followed by `ft_transfer_call` is accepted and the parked amount is later swept as an extra (`EXTRA_SWEPT`, split 92/8). Nothing returns it to the payer. The v3 and v3.1 contracts have no guard; since the audit round the client refuses (`zi pay` and the dashboard check `ft_balance_of` first and say to run `zi sweep`; `--allow-parked` overrides on the CLI). A contract fix would need a new code hash.

## v3 → v3.1

Contract **v3.1** is a new wasm and a new code hash (`2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX`, 163,771 bytes, sha256 `1b1dcc75…e278`, built from commit `49ec835`), deployed by the
operator as another global contract (tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, burn about 16.38 NEAR, from the deployer's balances before and after). The state layout and the interface did not
change; the one difference is the final-review finding **F1**. The `invoice_paid` and payout rules are the v3 ones. v3 (`Ut7EQhLD…reWa`) stays on testnet as recorded history;
because the code hash is part of the invoice address, the same terms give a different address under v3.1 (new ids end in `-V31`). Nothing is migrated.

**F1 (the bug).** In v3 a token `sweep` reads `ft_balance_of(self)` in a callback. If an `ft_transfer_call` credit is already on the invoice but its `ft_on_transfer` has not run yet,
the balance includes that credit. `ft_on_transfer` then rejects it as `busy` (the sweep holds the payout lock) and the token returns it, so the sweep had planned payouts with
tokens the invoice no longer held: the invoice went to `SETTLING` with `paid_by = None`, both payouts failed and were recorded as owed with nothing behind them, a retry was rejected
`not_open` and `refund_payer` panicked `NO_PAYER`. `sweep` is permissionless, so anyone could trigger it. **The fix:** `sweep` hands the lock value it set to `on_token_balance`;
`ft_on_transfer` raises the lock by 1 when it rejects as `busy` on an `OPEN` invoice; if the lock no longer matches, the callback clears it, plans nothing and returns
`CONCURRENT_PAYMENT`. Rust test: `token_sweep_racing_a_busy_ft_transfer_call_plans_nothing`. Not fixed: someone who repeats `sweep` every few blocks can still keep
`ft_transfer_call` rejected as `busy` (each sweep costs gas); a plain `ft_transfer` of the full price followed by a `sweep` is not blocked.

**The race on testnet.** `scripts/race-v31.ts` signs the sweeper's `sweep` and the payer's `ft_transfer_call` first and sends both at the same moment, so they usually land in the same
block. The invoice must be registered on the token first (the first three attempts forgot that and failed in the token, see `docs/SPIKES.md`). The fourth attempt (`RACE-V31-4`,
offset 0 ms) produced it: sweep `8vtV5twiaxVdUvTUopcs2eUAG2hzANxdeMWSSqoYJZ9Y` returned `CONCURRENT_PAYMENT` with no payout and no event; the payment
`7BZsoa9Sc5wCe9pbWvJhs3Pc7QuZcKZWR1sQRtvZoKQe` got `payment_rejected busy` and the token returned the whole 1 tUSDC; the invoice stayed `OPEN` with nothing owed and no payer recorded;
the retried `ft_transfer_call` `3GuRUGcm8CMUHsqhu55thgU8NARadEjYD57JwkarWgpK` was accepted and paid 0.92 / 0.08 tUSDC. This is one run that hit the right block alignment, not a
proof that the race can never happen; the Rust test covers the logic. The replay rules `concurrent-payment-plans-nothing` and `concurrent-payment-nothing-owed` check it offline.

**Re-recorded on v3.1** (all with the operator's `sm1110-zi3-*` accounts; transactions in `docs/SPIKES.md` "Contract v3.1 live"): the NEAR demo (`INV-1111-V31-A/B/C`: pay, plain transfer +
sweep, underpay), the tUSDC demo (`TOK-1111-V31-A`: plain `ft_transfer`, then a sweep by anyone), the one-step path (`TOK-V31-B`: `zi init`, one `ft_transfer_call` settles, a second is
returned `not_open`), the race (`RACE-V31-4`) and L3.

**L3 (a missing merchant is paid once it exists), now run.** `late.sm1110-zi3-merchant.testnet` did not exist. `LATE-V31` (v3.1): pay `8FS68syB7ETYjMEXzRHRrePhyxcMEPnSFS5K1Nzo5jTC` →
`PAYOUT_PENDING`, `transfer_failed` for the merchant, status `SETTLING`, no `invoice_paid`, 0.092 NEAR kept on the invoice. The parent `sm1110-zi3-merchant.testnet` then created the account
with its own key (`scripts/create-late-merchant.ts`, tx `6eX2vJwSSZ1n8wB7VtzUvzfADXPZhseik4uupNGpPq6v`), and `zi sweep LATE-V31` (`4nXzCkeCZxyvW5rN3kx55jG39RDj8VqSfyfPPxq647jJ`) delivered exactly 0.092 NEAR
(`owed_resent`, `invoice_paid` with `retried: true`, `PAID`). The v3 invoice `LATE-V3`, whose 0.092 NEAR was owed on the v3 account, was swept the same way with the v3 hash pinned
(`ZI_CODE_HASH=<v3 hash>`), tx `DracoGyTgSuxYAqHH35ySGbnRXmfETrt1Z5TuKTjF6y1`: `PAID`, recorded in `fixtures/v3/late-resweep.json` (the replay marks such a continued invoice as `resumed`).

**S-F4 (is the state-init deposit credited?), now run: no.** `SF4-V31` was initialised with a 0.02 NEAR deposit on the `UniversalStateInit` action (tx `ENrFCa9DS1yUpPukQ6qSkAPcheNs3JH12DyEKnx5dXee`). The new account
held 0 NEAR afterwards and the system sent a `Transfer` of 0.02 NEAR back to the signer, so the signer lost only gas. That is why a token invoice gets its 1-yocto float with `fund`
instead (`fixtures/v31/sf4.json`).

**Not done.** A reproducible wasm build, a browser walk-through of the dashboard, wallet checks, an audit, mainnet. The v3.1 deploy burn is derived from the deployer's balances before and after the deploy tx (17.8774031 → 1.4989866 NEAR, gas included): about 16.3784 NEAR.
Tests at the time of the v3.1 round: 65 Rust tests in `contract/` (the v3.1 source, `git show 49ec835:contract/src/lib.rs`), 14 in `contract-v2/`, 169 JavaScript tests.

## v3.1 → v3.2 (source only, not deployed)

After the final audit round, `contract/src/lib.rs` holds a **v3.2 source** that closes four contract findings: the busy-lock bump now applies to every rejection reason while a token sweep's
lock is held (not only `busy` on an `OPEN` invoice), an `OPEN` invoice past its expiry is treated as `EXPIRED` by `sweep` itself, "never settled" is `paid_at_ms == 0`, and `on_settled`
decides success from the promise status only (`docs/STABLECOIN.md` §5.3 has the details and the residual). **It is not deployed.** The deployed contract, the pinned code hash
(`ZI_CODE_HASH` default) and `contract/res/zeroinit_invoice.wasm` are still **v3.1** (`2prMzXHZ…DaYX`, built from commit `49ec835`; its source is `git show 49ec835:contract/src/lib.rs`).
`npm run contract:build` on the current tree would produce a different wasm (a different hash) than the deployed one. Until the operator deploys v3.2 as a new global contract
(new hash, new invoice addresses) the live contract still has the findings v3.2 fixes. The 94 Rust tests in `contract/` run against the v3.2 source.

## Older claims and how to verify them

| Claim | Verify with | Expected |
|---|---|---|
| v2: the tax vault is not skipped after expiry (contract-1) | `npm run zi -- replay fixtures/v2/audit-scenarios.json` | `PASS refund-event AUD1-V2 REFUNDED_EXPIRED`, `PASS sweep-tx-success AUD1-V2 8WQr2GUm… result=PAID`, `PASS split-vault AUD1-V2 0.008` |
| v2: a payer who already sent a plain transfer is not charged twice (contract-3) | same replay | `PASS refund-already-funded AUD3-V2 refunded 0.1 to sm1110-zi-payer.testnet`, `PASS split-vault AUD3-V2 0.008` |
| v2: a failed transfer is recorded, the tax stays owed, and a later sweep delivers it (contract-2) | same replay | `PASS transfer-failures-recorded AUD2-V2 1 failed, 1 transfer_failed events`, `PASS sweep-tx-success AUD2-V2 HECqnmtE… result=TAX_RESENT` (the second sweep, after the vault account was created) |
| The v2 and v1 recordings still check out (history) | `npm run zi -- replay fixtures/v2/demo-run.json`, `fixtures/v1/demo-run.json` and `npm run zi -- verify INV-1111-A --offline` | `INFO deployment v2 (history…` / `v1 (history, frozen…`, all `PASS` |

## Deploy transactions and burns

- **v3.1** (current): `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`, burn about 16.3784 NEAR (deployer balance 17.8774031 → 1.4989866 NEAR across that tx, gas included), built from commit `49ec835`.
- **v3** (`Ut7EQhLD…reWa`): `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT`, wasm digest `0724781d…0b1f`, 161,213 bytes, burn about 16.1226 NEAR (balance 27 → 10.8774031 NEAR, gas included). `git show 49ec835:contract/res/zeroinit_invoice.wasm` prints the v3 wasm (sha256 verified).
- **v2** (`4bQ61AgH…yx9zEA`): `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG` (signer `sm1110-zi-deployer.testnet`, burn 8.2949 NEAR). `shasum -a 256 contract-v2/res/zeroinit_invoice.wasm` → `3562e978e6924a2c538e9906fc42d15a652947891f18f7816e3c7807d20f622f` (82,942 bytes).
- **v1** (`Amg4WXKy…GW6k`): `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h` (burn 7.8526 NEAR); wasm digest `912ae75e…c3c9`; `git show e5581e8:contract/res/zeroinit_invoice.wasm` prints it. This tx
  is already outside the default RPC's window (`UNKNOWN_TRANSACTION`); the archival endpoint still has it.

### The v2 wasm rebuild (not re-run by us)

`contract-v2/` was built with `cargo near build reproducible-wasm` by a judge-side test run, reported as byte-identical (sha256 `3562e978…f622f`); **we did not re-run it**, and the committed settings cannot be
repeated as written: `[package.metadata.near.reproducible_build]` names the image tag `sourcescan/cargo-near:0.23.0-rust-1.95.0`, which is not in Docker Hub's tag list (checked 2026-11-10), and `image_digest` is `UNSET`.
Treat the byte-identical v2 rebuild as an unverified report.
