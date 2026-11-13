# Limits

Everything ZeroInit does not do, does not protect against, or has not been run. The deployed contract is **v3.3** (code hash `CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb`, the reproducible build of commit `7727a1c`);
every contract limit below holds for it. v3.3 removed one limit of the earlier versions: a payment on top of funds already parked by a plain transfer is now charged once ([HISTORY.md "v3.2r → v3.3"](HISTORY.md#v32r--v33)).

Sections: [Scope](#scope) · [Token invoices](#token-invoices) · [Contract behaviour](#contract-behaviour) · [Client and tooling](#client-and-tooling) · [Costs](#costs) · [Who holds keys](#who-holds-keys) · [What was not run live](#what-was-not-run-live)

## Scope

- **Nothing here is audited by a third party.** The audit rounds were AI reviews ([AI_USE.md](../AI_USE.md)). The v3.3 change was reviewed by one more AI review before the deploy; its fixes were checked by unit tests and live runs ([HISTORY.md "v3.2r → v3.3"](HISTORY.md#v32r--v33)).
- **Testnet only.** `src/config.ts` refuses a non-testnet network and an RPC URL containing the word `mainnet` (a substring test: a mainnet endpoint without that word, such as `https://free.rpc.fastnear.com`, passes that check). The real guard is
  `chain_id == testnet`, which `checkNetwork` asserts over RPC on every signing path (the CLI, the dashboard server, `scripts/plain-transfer.ts`) before a key is used. Mainnet was not tested.
- **tUSDC is a testnet mock, not a stablecoin, and its key holder is trusted.** The token `zeroinit-tusdc.testnet` is built from the [`test-usdc`](https://github.com/erhantrk/test-usdc) mock at commit `94396e4` (public; 6 decimals, owner-only mint) with a full-access key held by the operator ([Who holds keys](#who-holds-keys)). It has no value and no
  issuer behind it. The contract does not know tUSDC: each invoice names one NEP-141 token in its terms (so in its address), the contract accepts only that token, and the
  client allow-list (`src/config.ts`, `ZI_TUSDC_ACCOUNT`) pins symbol, decimals and account. On mainnet the allow-list would name a real issuer's NEP-141 contract with its real decimals, checked against `ft_metadata`; that was not tried.
- **Not an indexer or a payment processor.** Invoice documents live in `invoices/`; there is no database, no webhook and no memo matching. `zi serve` is a local dashboard, not a hosted service.
- **Out of scope:** mainnet, NEAR Intents, wallet-selector integration, a bulk-issuance UI, a `0s`/`0u` dual UI, and any indexer.

## Token invoices

- **A token invoice is not payable from an exchange until its id is registered on the token.** An `ft_transfer` to an unregistered `0u` id fails in the token; that is the token standard (NEP-145), not this contract.
  `zi pay` and `zi pay --plain` send the registration (`storage_deposit`, 0.00125 NEAR) in the **same transaction** as the payment (`[storage_deposit, ft_transfer_call]` or `[storage_deposit, ft_transfer]`).
  An exchange withdrawal is a plain `ft_transfer` sent by someone else's software, so someone (the merchant, the payer or anyone) must register the id first, in its own transaction.
  "No transaction until paid" and "plain transfer from an exchange" hold fully for **NEAR invoices**; for tokens only issuing is free.
- **A token payment takes 2 to 3 blocks, and a second call from the same token in that window returns both.** Since v3.3 `ft_on_transfer` reads the invoice's token balance before it decides, holding the payout lock.
  Any other `ft_transfer_call` from the same token that arrives meanwhile changes the lock, and both payments are returned in full as `busy`. Nothing is lost; the client says to try again.
  Recorded once: two payments from two accounts at the same moment were both returned, then one retry paid (`fixtures/v33/two-payments.json`).
- **One token per invoice, `0u` only.** `0s` is refused for tokens. A plain NEAR transfer to a token invoice and a plain `ft_transfer` of a
  different token are not recoverable (the NEAR stays on the account, the other token sits on its own contract).
- **Every payout receiver must be registered on the token (NEP-145).** An unregistered merchant or vault makes that payout fail (recorded as owed); `zi invoice new` refuses unregistered ones unless `--offline`.
- **A residual race stays open.** A sweep, or since v3.3 a token payment, whose balance read lands in the same block as an already-executed rejected `ft_transfer_call` (no lock held yet) could read a balance the token is about to take back.
  The lock check catches a competing call that arrives before the callback; a call emitted earlier is excluded only because receipts from the token reach the invoice in order. Nothing breaks under in-order delivery, and no ordering that breaks it was found. A payer's single call cannot produce it ([STABLECOIN.md §5.3](STABLECOIN.md#53-sweep-anyone-settles-funds-that-arrived-without-a-call), [§5.7](STABLECOIN.md#57-on_pay_balance-v33-the-balance-read-of-a-token-payment)).
- **Repeated sweeps or payments can delay a token payment.** Anyone who calls `sweep`, or sends `ft_transfer_call` from the same token, every few blocks keeps another `ft_transfer_call` rejected as `busy` (the token returns it; each call costs the caller gas).

## Contract behaviour

- **The contract cannot reject a bad merchant or tax vault at pay time.** `zi invoice new` and the dashboard check that both exist (and, for tokens, are registered) when the invoice is issued; `--offline` skips that check.
- **A failed payout stays owed.** The share is recorded (`SETTLING`, no `invoice_paid`) and retried by `sweep` to that recipient only, or returned to the payer by `refund_payer` after the grace period. If the merchant never exists and the payer is unknown (a
  settlement made from a plain transfer), the share stays owed forever; it is never given to anyone else.
- **Two unprotected cases.** A callback that never runs would leave the 5-minute payout lock stale and the failure unrecorded. A second failed refund to a different payer while the payer slot is taken is not protected (the event says `recorded: false`).
- **An invoice that expired untouched stays `OPEN` in storage** until a call sets `EXPIRED` (`sweep` does it itself since v3.2).
- **A payment on top of parked funds records no payer.** Since v3.3, funds parked by a plain transfer count toward the price: `pay()` or `ft_transfer_call` then needs only the rest, and gets back what it sent above that. Because the parked part may be someone else's money, such a settlement records no payer (`paid_by` null, `invoice_paid` `via: "transfer"`, with `parked_applied` and `topped_up_by`). So `refund_payer` cannot return its shares if a payout later fails; they stay owed to their own recipient.
- **Plain-transfer underpayments are never refunded.** They stay parked, and after expiry they are released to merchant and vault.
- **Plain-transfer overpayments go to the merchant side, taxed.** `sweep()` cannot know the payer, so everything parked above `amount` is split like the price (92/8 at 800 bps). With `pay()` or `ft_transfer_call` the excess goes back to the payer.
- **No checksum in the address.** The `0u…` format belongs to NEAR and has no checksum: a mistyped address is still a valid address for different bytes, and funds sent to a wrong id are lost, like a mistyped implicit address. The invoice file (or its QR code) is the source of truth.
  Since v3.3 the client adds a 4-character check code (Crockford base32 of SHA-256 of `zeroinit-check-code/1:` + the address, 20 bits): `zi invoice new` prints `CHECK XXXX`, `zi check <address> <code>` says `PASS` or `FAIL` offline, the MCP `issue_invoice` returns `check_code`, and the dashboard shows it next to the address.
  It only helps a payer who checks; a raw address pasted into a wallet is still unprotected.
- **`0s` exists too.** Deterministic accounts (NEP-616, live since protocol 82) can do a similar flow; `0u` is the canonical scheme and adds the uninitialized state and batched creation. The CLI keeps `--scheme 0s` as a fallback, but every result in this repository is `0u`.

## Client and tooling

- **Wallet support is untested.** Exchange-style `Transfer`s built by near-cli-rs and by the `zi` CLI were tested. Which browser wallets accept a `0u…` receiver is not known.
- **The dashboard was tried in a browser for NEAR and tUSDC invoices, not for every badge.** On v3.3 (Chrome, 2026-11-13): three 0.1 NEAR invoices and one 0.5 tUSDC invoice created from the page; `DASH-R3STU-A` paid with **Pay (one transaction)** ([`5tmr68M2…`](https://testnet.nearblocks.io/txns/5tmr68M2hDhrcFPP8BQBtiyK7PYQmBsxbV9R2DoUknP8)), `DASH-R3STU-B` paid by a plain transfer ([`9dLa7rGU…`](https://testnet.nearblocks.io/txns/9dLa7rGUAWYJD6MyGXugDmeuqfeYFk9tzNtuR85ASdmW)) and swept ([`CYXnBAiV…`](https://testnet.nearblocks.io/txns/CYXnBAiVX8tZmiDuL5DiAT7PFUJvPgMAWSrgGkRZCV6Z)), `DASH-R3STU-C` left unpaid, `DASH-R3STU-T` (tUSDC) paid with **Pay**, registration and `ft_transfer_call` in one transaction ([`BAoTJ2Kb…`](https://testnet.nearblocks.io/txns/BAoTJ2Kbr3UtMmpGP3PKBTMaJGUJJzUyrbp8GPeyknRC)); files in `invoices/demo/`, screenshot `docs/img/dashboard-v33.png`. The `SETTLING`/`REFUNDED` badges and Refund payer were not tried in a browser; they are covered by tests only. On v3.3 the dashboard's token Pay also goes through when tokens are already parked, like `zi pay`.
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
| NEAR `pay` that creates the account (v3.3) | **0.0075647 NEAR** of tokens burnt, 13.74 Tgas (v3.2r: 0.0075612; older versions: [HISTORY.md](HISTORY.md#what-a-first-payment-cost-on-each-version)) |
| NEAR `pay` on top of 0.3 NEAR already parked (the plain transfer created the account) | 0.0013415 NEAR, 14.53 Tgas; the plain transfer itself 0.0070946 NEAR |
| token invoice: initialize (`[UniversalStateInit, fund]`) / `[storage_deposit, ft_transfer_call]` that settles | 0.0072541 NEAR (9.96 Tgas) / 0.0016780 NEAR (18.56 Tgas), plus the 0.00125 NEAR registration deposit |
| token sweep with state init | 0.0083572 NEAR, 22.11 Tgas |
| NEP-145 registration, per account | 0.00125 NEAR deposit, kept by the token |
| one-time global deploy | v3.3 17.0358 NEAR (170,344 bytes), v3.2 about 16.41, v3.1 about 16.38; the v3.2r publish burn was not computed |
| issuing an invoice | nothing |

## Who holds keys

The invoice contract has no owner and no admin call, and **invoice accounts have no keys**. That is not true of every account around it. The v3.3 accounts were created on 2026-11-13 with the testnet faucet, one full-access key each, held by the operator.
The older accounts (`sm1110-*`, used by the v1 to v3.2r recordings) were checked with RPC `view_access_key_list` on 2026-11-11; no v3.3 step used them.

| Account | What it is | Keys | What the holder could do |
|---|---|---|---|
| invoice `0u…` accounts (`INV-1111-V33-A` …) | the payment account | **none** (`zi verify` → `PASS no-access-keys`) | nothing: the code is fixed by hash, the terms are in the address |
| the v3.3 code (`CrwuvfSL…aVsb`; v3.2r `BQLSk5ca…zCFry` and older likewise) | a global contract published **by hash** | n/a | content-addressed, so nobody can change what that hash runs |
| `zeroinit-deployer.testnet` (v3.3 publisher); older publishers `sm1110-*-deployer.testnet` | operator accounts | 1 **full-access** key each, held by the operator | publish other wasm under other hashes (the client does not trust them), spend their own NEAR. **Cannot** alter `CrwuvfSL…aVsb` or any earlier hash |
| **`zeroinit-tusdc.testnet`** (the tUSDC mock token, a contract account, owner = itself) | the token that token invoices trust | 1 **full-access** key, held by the operator | mint, redeploy or replace the token code, move or burn any tUSDC, including tokens parked on or paid through an invoice. **Token invoices trust this key**; NEAR invoices do not. (The older mock `sm1110-tusdc.testnet` is used only to check history documents.) |
| `zeroinit-merchant.testnet`, `zeroinit-taxvault.testnet`, `zeroinit-payer.testnet`, `zeroinit-sweeper.testnet`, `zeroinit-unreg.testnet` (not registered on tUSDC; unused so far) | ordinary testnet accounts | 1 full-access key each | spend what they receive (they are the recipients, by design) |
| `zeroinit-funder1.testnet`, `zeroinit-funder2.testnet` | faucet accounts that only funded the deployer | 1 full-access key each | spend their own NEAR |

So: **the invoice contract trusts nobody**, but a token invoice trusts whoever controls the token contract, and on testnet that is the operator's full-access key. On mainnet an invoice would name a real issuer's token
and inherit that issuer's trust model; that was not tried. Anyone can re-check:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"zeroinit-tusdc.testnet"}}'
# → "keys":[{"public_key":"ed25519:…","access_key":{"nonce":…,"permission":"FullAccess"}}]   (a 0u… invoice account answers "keys":[])
```

## What was not run live

What ran live on v3.3 (2026-11-13): NEAR pay, plain transfer + sweep, an underpayment, tUSDC plain `ft_transfer` + sweep, the one-step `ft_transfer_call` with the registration in the same transaction, a direct call of the private callback (refused),
payments on top of parked funds (NEAR partly parked; tUSDC partly parked, fully parked, and too little), the sweep-vs-`ft_transfer_call` race on the `bad_msg` rejection path, and two token payments at the same moment
(transactions in [SPIKES.md "Contract v3.3 live"](SPIKES.md#contract-v33-live-2026-11-13)). Not run live:

- the `expired` and `not_open` variants of that race (Rust unit tests only);
- a token payment whose balance read fails (`balance_unavailable`), and a NEAR `pay` on top of a full parked amount on v3.3 (unchanged since v2; Rust unit tests on v3.3);
- the other v3.2 fixes: an `OPEN` invoice past its expiry released by one `sweep`, `paid_at_ms == 0` as "never settled", success decided from the promise status only (Rust unit tests only);
- the race more than once per version: each run is one run that hit the right block alignment, not a rate;
- the same race sequence on v3.1, so the evidence that v3.1 had the hole is a Rust test, not a testnet run;
- the dashboard's `SETTLING`/`REFUNDED` badges and Refund payer in a browser (NEAR and tUSDC pay, plain transfer + sweep and the unpaid case were run in Chrome on v3.3), and any wallet;
- anything on mainnet;
- an independent audit, and an independent third-party rebuild of the wasm ([REPRODUCE.md](REPRODUCE.md)).
