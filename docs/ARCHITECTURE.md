# ZeroInit architecture: measured costs and the design by version

How the deployed contract works (diagrams, lifecycle, methods, rules, transactions, events) is in [HOW-IT-WORKS.md](HOW-IT-WORKS.md). This file keeps what that page does not:
the measured storage, gas and cost numbers, and what each contract version changed in the design. The live transactions behind every number are in [SPIKES.md](SPIKES.md);
the fixes and evidence per version are in [HISTORY.md](HISTORY.md).

| Version | Code hash | Status |
|---|---|---|
| **v3.2r** | `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry` (publish tx `DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs`) | **current**: the v3.2 source built reproducibly, so everything below about v3.2 holds for it |
| v3.2 | `6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ` (tx `GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg`) | history: v3.1 plus the final audit's contract fixes |
| v3.1 | `2prMzXHZVWdeHfmdqqxzb5ahLy2pWBWZjuE25EDJDaYX` | history: v3 plus the token-sweep race fix (for the `busy` rejection) |
| v3 | `Ut7EQhLDrvYVarHb6ZaXk6m7o9kQqYPCpyqiamvreWa` | history: NEP-141 invoices (tUSDC, a testnet mock), `SETTLING`, owed ledger, payout lock |
| v2 | `4bQ61AgHWWmYXp5c3fwj9NJxS79D9R3cGZAZxHyx9zEA` | history: v1 plus three audit fixes |
| v1 | `Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` | history: the first contract |

All six stay on testnet and keep replaying. The account model (one global code hash, one `0u` id derived from code + terms, no init method, no access keys) is the same in all of them.

## Costs measured

v1 numbers were measured on testnet on 2026-11-10 (protocol 88); the raw output and tx hashes are in [SPIKES.md "Storage, payer cost and deploy burn"](SPIKES.md#storage-payer-cost-and-deploy-burn).
The v2 rows come from the re-recorded fixtures ([SPIKES.md "Contract v2 live"](SPIKES.md#contract-v2-live)).

| What | Measured | Evidence |
|---|---|---|
| `storage_usage` after `pay()` | v1 **352 B**, v2 **358 B**, well under the 770 B zero-balance limit ([SPEC.md](../SPEC.md) §4.3 estimated about 312 B before and about 329 B after) | v1 `SMOKE-1`, `zi status SMOKE-1 --json`; v2 `INV-1111-V2-A` (`storage=358`) |
| `storage_usage` after `sweep()` (plain-transfer path) | v1 **325 B**, v2 **331 B** | v1 `SMOKE-2`; v2 `INV-1111-V2-B` (`storage=331`) |
| `storage_usage` while a tax share is owed (v2 `OWED_TAX` key) | **429 B** | `AUD2-V2` (`storage=429`) |
| State-init deposit needed | **0**; the 0.01 NEAR fallback deposit was not needed | all rows above ≤ 770 B |
| Tokens burnt by one `pay` tx that creates the account (all receipts summed) | v1 **0.0073621 NEAR**, v2 **0.0077197 NEAR** (11.5 vs 15.5 Tgas: v2 adds two `on_transfer` callbacks) | `INV-1111-A` and `INV-1111-V2-A` in the fixtures. v1 payer cost on a 0.1 NEAR invoice (balance diff): 0.0073617847981195 NEAR, pay tx `AaVJr8jgAZ2jwG4j4xR5pYvFnDPbfFADvBWpNrDuHY3M`. The protocol's 0.007 NEAR account-creation charge is included; when a plain transfer created the account first (`AUD3-V2`) the pay tx itself burnt 0.0015 NEAR |
| One-time global deploy burn | v1 **7.8526 NEAR** (78,519-byte wasm), v2 **8.2949 NEAR** (82,942-byte wasm); not per-invoice costs | v1 deploy tx `DSXd2Sjq59zRF2ZX9j3D8SMYd6GZ44XpsW1aJbKfpJ1h`; v2 deploy tx `DvNnUtvqMg5Q5e2Mn4fMx7GYBFNFhTo7z9wo64szAFKG` |

**v3 rows** (measured on testnet on 2026-11-10, [SPIKES.md "Contract v3 live"](SPIKES.md#contract-v3-live-2026-11-10) → "Measured"; single runs, tokens burnt summed over all receipts, deposits not included):

| What | Measured |
|---|---|
| `storage_usage` after a NEAR `pay()` / after a plain transfer + `sweep` | **421 B** (0.1 NEAR invoice; 426 B for a 1 NEAR one) / **393 B**; 426 to 429 B while a merchant share is owed; 457 B after `refund_payer` |
| `storage_usage` of a token invoice | 417 B initialized, 416 to 422 B after a plain-transfer sweep, 445 B after a paid `ft_transfer_call`, 472 B after `refund_payer` (largest seen; the limit is 770 B) |
| Tokens burnt, NEAR `pay` that creates the account | **0.0075600 NEAR** (13.70 Tgas) (v2 0.0077197) |
| Tokens burnt, token init `[UniversalStateInit, fund]` / settling `ft_transfer_call` / token sweep with state init | 0.0072530 NEAR (9.96 Tgas) / 0.0011780 NEAR (13.13 Tgas) / 0.0083450 NEAR (21.99 Tgas) |
| NEP-145 registration of one account (token side) | 0.00125 NEAR deposit, kept by the token, plus 0.000182 NEAR burnt |
| One-time global deploy burn, v3 (161,213-byte wasm) | **about 16.1226 NEAR** (operator's balance 27 → 10.8774031 NEAR, gas included); deploy tx `43D4EifRGJJBtWUVhFPXPFsZqooPwz1czD8LwRz6sjYT` |
| One-time global deploy burn, v3.2 (164,040-byte wasm) | **about 16.41 NEAR** (deployer balance 17 → 0.5946814 NEAR across the tx; `tokens_burnt` 16.405318 NEAR); deploy tx `GHHsammf6Mg4nNZWtdB9sBYPJtSojSE46JVUs7nyd3Pg` (v3.1: about 16.38 NEAR, `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`) |

**v3.1, v3.2 and v3.2r** (single runs; [SPIKES.md](SPIKES.md) "Measured on v3.1", "Measured on v3.2", "Measured on v3.2r"): a NEAR `pay` that creates the account burnt 13.70 Tgas / 0.007561 NEAR (v3.1),
13.71 Tgas / 0.007562 NEAR (v3.2) and 13.70 Tgas / 0.0075612 NEAR (v3.2r); a settling `ft_transfer_call` 13.14 to 13.15 Tgas / about 0.00118 NEAR; a token sweep with state init 22.04 Tgas / about 0.00835 NEAR
(200 Tgas attached); the sweep that returned `CONCURRENT_PAYMENT` 5.58 to 5.59 Tgas / about 0.00049 NEAR. The token figures were not re-measured on v3.2r. The v3.2r publish burn was not computed.

Issuing an invoice costs nothing and sends no transaction. After a completed payment the account sits at 0 NEAR (v3.2r: 428 B after `pay()`, 400 B after a plain transfer + `sweep`, read from
`fixtures/v32r/demo-run.json`; every version stays below the zero-balance limit), so there is no per-invoice storage to fund and nothing left behind for the merchant to reclaim.

## v1 → v2

v1 was a global contract and cannot be patched. An audit found three issues in it; **v2** fixes them in a new wasm (new code hash, same borsh state layout, same methods and events
plus additions): the tax vault was skipped when parked funds were swept after expiry; `pay()` ignored funds already parked by a plain transfer (the payer was charged twice); a failed
transfer after `PAID` let the bounced tax share reach the merchant. v2 still emitted `invoice_paid` in the same receipt that scheduled the transfers, so atomicity between the record and the
money movement was not claimed. Full table with transactions: [HISTORY.md "v1 → v2"](HISTORY.md#v1--v2).

## v3: what changed in the design

Contract v3 keeps the v2 account model and changes what an invoice can hold and how a payment settles. The interface is [STABLECOIN.md](STABLECOIN.md).

- **State.** Layout 3 adds `grace_ms` and `token` (a NEP-141 contract id, or None = NEAR) to the terms, and `owed_merchant`, `owed_tax`, `owed_payer`, `refund_to`, `busy_until_ms` to the
  record. A NEAR invoice is 201 bytes, a token invoice 226; the maximum-length state is 519 bytes, so 519 + 45 (record) + 132 (account overhead) = 696 B stays under the 770-byte zero-balance limit.
- **Settlement.** One batch of payouts and one private callback (`on_settled`), the only emitter of `invoice_paid`; `SETTLING` in between; an owed ledger per recipient; a 5-minute payout lock
  ([HOW-IT-WORKS.md "Settlement and tax"](HOW-IT-WORKS.md#settlement-and-tax)).
- **Tax.** Every merchant-side amount goes through `split_of`, including overpayments, extras and the pro-rata release after expiry.
- **Tokens.** One token per invoice, fixed in the terms; a plain path (register, `ft_transfer`, anyone sweeps) and a one-step path (`zi init`, `ft_transfer_call`).

**What the live runs changed in the design** ([SPIKES.md "Contract v3 live"](SPIKES.md#contract-v3-live-2026-11-10)): the final value of `ft_transfer_call` is the amount used, not the unused amount; an invoice that expired
untouched is still `OPEN` until some call sets `EXPIRED`, and only then does `sweep` release a plain underpay pro rata; everything else behaved as specified.

## v3.1: the token-sweep race

Same layout, interface and events as v3; one change in the token `sweep` path. `sweep` takes the payout lock and asks the token for `ft_balance_of(self)`; the
lock value it set is passed to the callback `on_token_balance`. An `ft_transfer_call` whose credit is already on the invoice but whose `ft_on_transfer` runs while the lock is
held is rejected as `busy` and raises the lock by 1 (only while the invoice is `OPEN`); the token then returns the tokens to the payer. If the lock in the callback is not the
one `sweep` set, the balance may include those tokens, so the callback clears the lock, plans no payout and returns `CONCURRENT_PAYMENT`: the invoice stays `OPEN`, nothing is
owed, and the payer can retry. Under v3 the same sequence planned a settlement with tokens that were no longer there. The v3.1 wasm was 163,771 bytes (sha256 `1b1dcc75…e278`,
tx `52dRw7RcBom9EbUJ6hCExDF5esWjsHPh5e1sUa87XyvB`).

The race was produced once on testnet (`fixtures/v31/race.json`); the logic is covered by the Rust test `token_sweep_racing_a_busy_ft_transfer_call_plans_nothing`. The `UniversalStateInit`
deposit is not credited to the new account (the system refunds it to the signer), which is why a token invoice is given its 1-yocto float by a separate `fund` call.

## v3.2 and v3.2r: the race guard on every rejection

Same layout, interface and events as v3.1; the changes are the final audit's contract findings ([HISTORY.md "v3.1 → v3.2"](HISTORY.md#v31--v32), [STABLECOIN.md §5.3](STABLECOIN.md#53-sweep-anyone-settles-funds-that-arrived-without-a-call)).
While a lock is held, `ft_on_transfer` raises the lock by 1 for `bad_msg`, `not_open`, `expired` and `busy` alike (v3.1 did it only for `busy` on an `OPEN` invoice), so a token `sweep` whose
balance read included a credit the token is about to take back answers `CONCURRENT_PAYMENT` and plans nothing. `sweep` treats an `OPEN` invoice past its expiry as `EXPIRED`; "never settled" is
`paid_at_ms == 0`; `on_settled` decides success from the promise status only. The v3.2 wasm is 164,040 bytes (sha256 `016bf5ba…5e63d`); v3.2r is the same source built reproducibly,
163,788 bytes (sha256 `9a8f368d…5b92`, [REPRODUCE.md](REPRODUCE.md)).

The race on the `bad_msg` path was produced once on v3.2 and once on v3.2r (`fixtures/v32/race.json`, `fixtures/v32r/race.json`); the other paths and fixes are covered by Rust tests only.
What stays open: [LIMITS.md "Token invoices"](LIMITS.md#token-invoices).
