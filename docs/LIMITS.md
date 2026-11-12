# Limits

Everything ZeroInit does not do, does not protect against, or has not been run. The deployed contract is **v3.2r** (code hash `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`, the v3.2 source built reproducibly);
every contract limit below holds for it and for v3.2.

Sections: [Scope](#scope) · [Token invoices](#token-invoices) · [Contract behaviour](#contract-behaviour) · [Client and tooling](#client-and-tooling) · [Costs](#costs) · [Who holds keys](#who-holds-keys) · [What was not run live](#what-was-not-run-live)

## Scope

- **Nothing here is audited by a third party.** The audit rounds were AI reviews ([AI_USE.md](../AI_USE.md)). The deployed source is the source after the fixes for the last of them; those fixes were checked by unit tests and, for the race on the `bad_msg` path, by one live run ([HISTORY.md "v3.1 → v3.2"](HISTORY.md#v31--v32)).
- **Testnet only.** `src/config.ts` refuses a non-testnet network and an RPC URL containing the word `mainnet` (a substring test: a mainnet endpoint without that word, such as `https://free.rpc.fastnear.com`, passes that check). The real guard is
  `chain_id == testnet`, which `checkNetwork` asserts over RPC on every signing path (the CLI, the dashboard server, `scripts/plain-transfer.ts`) before a key is used. Mainnet was not tested.
- **tUSDC is a testnet mock, not a stablecoin, and its key holder is trusted.** The token `sm1110-tusdc.testnet` is a copy of the [`test-usdc`](https://github.com/erhantrk/test-usdc) mock (not public yet; 6 decimals, owner-only mint) with a full-access key held by the operator ([Who holds keys](#who-holds-keys)). It has no value and no
  issuer behind it. The contract does not know tUSDC: each invoice names one NEP-141 token in its terms (so in its address), the contract accepts only that token, and the
  client allow-list (`src/config.ts`, `ZI_TUSDC_ACCOUNT`) pins symbol, decimals and account. On mainnet the allow-list would name a real issuer's NEP-141 contract with its real decimals, checked against `ft_metadata`; that was not tried.
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u` dual UI, and any indexer.

## Token invoices

- **A token invoice is not payable from an exchange until its id is registered on the token.** An `ft_transfer` to an unregistered `0u` id fails in the token. One `storage_deposit` transaction (0.00125 NEAR, sent by the merchant, the payer or anyone) must come first;
  `zi pay` does it, an exchange withdrawal does not. "No transaction until paid" and "plain transfer from an exchange" hold for **NEAR invoices**; for tokens only issuing is free.
- **A token payer can be charged twice.** `ft_on_transfer` cannot see tokens already parked by a plain `ft_transfer` (that would need an asynchronous `ft_balance_of`). A payer who sends a plain `ft_transfer` of the full price and then pays by `ft_transfer_call`
  is accepted a second time (92/8), and the parked amount is later swept as an extra (`EXTRA_SWEPT`, split 92/8) with no refund path. The "not charged twice" guarantee holds for **NEAR** `pay()` only (since v2). The client refuses a one-step token `zi pay` and the dashboard's Pay while
  `ft_balance_of(invoice) > 0` and says to run `zi sweep` instead (`--allow-parked` overrides on the CLI); a hand-built `ft_transfer_call` is not stopped, and a contract fix needs a new code hash.
- **One token per invoice, `0u` only.** `0s` is refused for tokens. A plain NEAR transfer to a token invoice and a plain `ft_transfer` of a
  different token are not recoverable (the NEAR stays on the account, the other token sits on its own contract).
- **Every payout receiver must be registered on the token (NEP-145).** An unregistered merchant or vault makes that payout fail (recorded as owed); `zi invoice new` refuses unregistered ones unless `--offline`.
- **A residual race stays open.** A sweep that lands in the same block as an already-executed rejected `ft_transfer_call` (no lock held yet) can still read a balance the token is about to take back. A payer's single call cannot produce it ([STABLECOIN.md §5.3](STABLECOIN.md#53-sweep-anyone-settles-funds-that-arrived-without-a-call)).
- **Repeated sweeps can delay a token payment.** Anyone who calls `sweep` every few blocks keeps an `ft_transfer_call` rejected as `busy` (the token returns it; each sweep costs the caller gas).

## Contract behaviour

- **The contract cannot reject a bad merchant or tax vault at pay time.** `zi invoice new` and the dashboard check that both exist (and, for tokens, are registered) when the invoice is issued; `--offline` skips that check.
- **A failed payout stays owed.** The share is recorded (`SETTLING`, no `invoice_paid`) and retried by `sweep` to that recipient only, or returned to the payer by `refund_payer` after the grace period. If the merchant never exists and the payer is unknown (a
  settlement made from a plain transfer), the share stays owed forever; it is never given to anyone else.
- **Two unprotected cases.** A callback that never runs would leave the 5-minute payout lock stale and the failure unrecorded. A second failed refund to a different payer while the payer slot is taken is not protected (the event says `recorded: false`).
- **An invoice that expired untouched stays `OPEN` in storage** until a call sets `EXPIRED` (`sweep` does it itself since v3.2).
- **Partly parked funds followed by a full payment charge the payer twice** (NEAR): the tax is right, the double payment is not refunded. For tokens even a *full* parked amount does ([above](#token-invoices)).
- **Plain-transfer underpayments are never refunded.** They stay parked, and after expiry they are released to merchant and vault.
- **Plain-transfer overpayments go to the merchant side, taxed.** `sweep()` cannot know the payer, so everything parked above `amount` is split like the price (92/8 at 800 bps). With `pay()` or `ft_transfer_call` the excess goes back to the payer.
- **No checksum.** A mistyped `0u…` address is still a valid address for different bytes; funds sent to a wrong id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a fallback, but every result in this repository is `0u`.

## Client and tooling

- **Wallet support is untested.** Exchange-style `Transfer`s built by near-cli-rs and by the `zi` CLI were tested. Which browser wallets accept a `0u…` receiver is not known.
- **The dashboard was tried in a browser for NEAR invoices only.** On v3.2r (Chrome, 2026-11-12): three 0.1 NEAR invoices created from the page; `DASH-53NMD-A` paid with **Pay (one transaction)** ([`BKKA7RZ7…`](https://testnet.nearblocks.io/txns/BKKA7RZ7S279y87FQqsGrvMrNeQsHLw4abvKV6GvGtxa)), `DASH-53NMD-B` paid by a plain transfer ([`3ZXKEeGh…`](https://testnet.nearblocks.io/txns/3ZXKEeGhhPMjspK1inNyqfWqC3J5DYyATFVF2DyXrqxd)) and swept ([`FofRUtoY…`](https://testnet.nearblocks.io/txns/FofRUtoYFmvRwtmxGWpLEt9FpXYtcMCC72M1PHZbn7yy)), `DASH-53NMD-C` left unpaid (files in `invoices/demo/`, screenshot `docs/img/dashboard-v32r.png`). Token invoices, the `SETTLING`/`REFUNDED` badges and Refund payer were not tried in a browser; they are covered by tests only.
- **Transaction lookups need an archival RPC** after about 1.5 days ([VERIFY.md](VERIFY.md#live-read-only-checks)). State checks and offline replays keep working.
- **Exit codes.** `zi verify`, `zi receipt` and `zi replay` exit 1 on any failed check. `zi pay` exits 1 unless the result is
  `PAID` (a `REFUNDED_*` result means the deposit came back); the dashboard answers 409 with `paid:false` in that case. `zi pay` and `zi sweep` also exit 1 (with a `WARNING` and
  `TRANSFER_FAILED` lines) when a transfer failed downstream. `zi pay` exits 1 on `SETTLING`/`PAYOUT_PENDING` (it says `NOT PAID (yet)` and to run `zi sweep`);
  a token `zi pay` exits 0 only when `invoice_paid` was seen, the dashboard answers 202 with `paid:false, pending:true`; a token sweep exits 1 on `UNDERPAID`,
  `NOTHING_TO_SWEEP`, `NEEDS_YOCTO`, `BALANCE_UNAVAILABLE`, `CONCURRENT_PAYMENT`.

## Costs

The payer pays for the first touch: gas plus the protocol's 0.007 NEAR account-creation charge. Measured, single runs:

| What | Cost |
|---|---|
| NEAR `pay` that creates the account (v3.2r) | **0.0075612 NEAR** of tokens burnt (v3.2: 0.0075620; older versions: [HISTORY.md](HISTORY.md#what-a-first-payment-cost-on-each-version)) |
| token invoice: initialize (`[UniversalStateInit, fund]`) / settling `ft_transfer_call` | about 0.0072540 / 0.0011810 NEAR (measured on v3.2, not re-measured on v3.2r) |
| NEP-145 registration, per account | 0.00125 NEAR deposit, kept by the token |
| one-time global deploy | v3.2 about 16.41 NEAR, v3.1 about 16.38; the v3.2r publish burn was not computed |
| issuing an invoice | nothing |

## Who holds keys

The invoice contract has no owner and no admin call, and **invoice accounts have no keys**. That is not true of every account around it. Checked with RPC `view_access_key_list` on 2026-11-11;
the operator has not deleted or rotated any of these keys.

| Account | What it is | Keys | What the holder could do |
|---|---|---|---|
| invoice `0u…` accounts (`INV-1111-V32R-A` …) | the payment account | **none** (`zi verify` → `PASS no-access-keys`) | nothing: the code is fixed by hash, the terms are in the address |
| the v3.2r code (`BQLSk5ca…zCFry`; v3.2 `6YtW5oJ8…vMCNHJ` and older likewise) | a global contract published **by hash** | n/a | content-addressed, so nobody can change what that hash runs |
| `sm1110-zi-deployer.testnet` (v3.2r publisher; v2 and v1), `sm1110-zi32-deployer.testnet` (v3.2), `sm1110-zi3-deployer.testnet` (v3.1, v3) | operator accounts | 1 **full-access** key each, held by the operator | publish other wasm under other hashes (the client does not trust them), spend their own NEAR. **Cannot** alter `BQLSk5ca…zCFry` or any earlier hash |
| **`sm1110-tusdc.testnet`** (the tUSDC mock token, a contract account, owner = itself) | the token that token invoices trust | 1 **full-access** key, held by the operator | mint, redeploy or replace the token code, move or burn any tUSDC, including tokens parked on or paid through an invoice. **Token invoices trust this key**; NEAR invoices do not |
| merchant, tax vault, payer, sweeper (`sm1110-zi3-*`) | ordinary testnet accounts | 1 full-access key each | spend what they receive (they are the recipients, by design) |

So: **the invoice contract trusts nobody**, but a token invoice trusts whoever controls the token contract, and on testnet that is the operator's full-access key. On mainnet an invoice would name a real issuer's token
and inherit that issuer's trust model; that was not tried. Anyone can re-check:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"sm1110-tusdc.testnet"}}'
# → "keys":[{"public_key":"ed25519:…","access_key":{"nonce":…,"permission":"FullAccess"}}]   (a 0u… invoice account answers "keys":[])
```

## What was not run live

What ran live on v3.2r (2026-11-12): NEAR pay, plain transfer + sweep, an underpayment, tUSDC plain `ft_transfer` + sweep, the one-step `ft_transfer_call`, and the sweep-vs-`ft_transfer_call` race on the `bad_msg` rejection path
(transactions in [SPIKES.md "Contract v3.2r live"](SPIKES.md#contract-v32r-live-2026-11-12)). Not run live:

- the `expired` and `not_open` variants of that race (Rust unit tests only);
- the other v3.2 fixes: an `OPEN` invoice past its expiry released by one `sweep`, `paid_at_ms == 0` as "never settled", success decided from the promise status only (Rust unit tests only);
- the race more than once per version: each run is one run that hit the right block alignment, not a rate;
- the same race sequence on v3.1, so the evidence that v3.1 had the hole is a Rust test, not a testnet run;
- the dashboard in a browser with a token invoice, a `SETTLING`/`REFUNDED` badge or Refund payer (the NEAR pay, plain transfer + sweep and unpaid cases were run in Chrome on v3.2r), and any wallet;
- anything on mainnet;
- an independent audit, and an independent third-party rebuild of the wasm ([REPRODUCE.md](REPRODUCE.md)).
