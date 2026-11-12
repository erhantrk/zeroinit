# ZeroInit — Interface specification (v1)

The byte layouts, method names, arguments, JSON fields and CLI flags of ZeroInit v1. They are frozen: a change needs a
version bump (v2 and v3 are specified in [`docs/STABLECOIN.md`](docs/STABLECOIN.md) and [`docs/HISTORY.md`](docs/HISTORY.md)).
Every byte-level claim below is checked by a test (`test/vectors.test.ts`, the contract's unit tests); the first
versions of those tests ran on 2026-11-09 in the planning-phase reference implementation (see [AI_USE.md "Code provenance"](AI_USE.md#code-provenance)).

Sources for every protocol fact were listed in an internal sources file (not published). Short tags used here:
`[NC]` = nearcore tag `2.14.0-rc.5` (the exact build testnet runs), `[NEP655]`, `[NEP616]`, `[DOCS-UA]` = docs.near.org
"Creating Universal Accounts".

---

## 0. Glossary and constants

| Name | Value | Source |
|---|---|---|
| Network | `testnet`, RPC `https://rpc.testnet.near.org` (fallback `https://test.rpc.fastnear.com`) | live `status` call 2026-11-09: protocol 88, build 2.14.0-rc.5 |
| Scheme (primary) | `0u` universal account (NEP-655), action `UniversalStateInit` = Action discriminant **15** | [NC] `core/primitives/src/action/mod.rs` |
| Scheme (fallback) | `0s` deterministic account (NEP-616), action `DeterministicStateInit` = discriminant **11** | [NC] same file |
| Code reference | Global contract **by code hash** (`GlobalContractIdentifier::CodeHash` = tag 0, then 32 bytes) | [NC] `core/primitives-core/src/global_contract.rs` |
| Contract state key | `STATE` (ASCII, 5 bytes), near-sdk's default | near-sdk 5.30.1 `src/environment/env.rs` `const STATE_KEY: &[u8] = b"STATE"` |
| Zero-balance limit | storage_usage ≤ **770** bytes needs no NEAR for storage | [NC] `runtime/runtime/src/verifier.rs` `ZERO_BALANCE_ACCOUNT_STORAGE_LIMIT` |
| Account creation charge | 0.007 NEAR, taken from the gas refund of the receipt that creates the account (the creator pays, not the account) | [NC] `core/parameters/res/runtime_configs/85.yaml`, `runtime/runtime/src/lib.rs` |
| Gas for `pay` / `sweep` | `50_000_000_000_000` (50 Tgas) each | our choice |
| Max invoice_id | `^[A-Za-z0-9_-]{1,32}$` | our choice |
| tax_bps | integer 0..=10000 (800 = 8%) | our choice |

Invoice status codes (u8 in storage, string in JSON): `0 = OPEN`, `1 = PAID`, `2 = EXPIRED`.

---

## 1. Account lifecycle of one invoice (what the protocol does)

```
             (merchant computes id offline; nothing on chain)
NONEXISTENT ──── plain Transfer (any wallet/exchange) ────► UNINITIALIZED (holds NEAR, no code)
     │                                                           │
     │ [UniversalStateInit, FunctionCall pay(deposit)]           │ [UniversalStateInit, FunctionCall sweep()]
     ▼                                                           ▼
  INITIALIZED, status OPEN → pay() splits → PAID      INITIALIZED, status OPEN → sweep() splits → PAID
```

Facts this relies on (all verified in source / official tests; the first live testnet checks in docs/SPIKES.md re-prove them):

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

---

## 2. On-chain data: the invoice contract state

### 2.1 Rust struct (FROZEN — field order is the byte layout)

```rust
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Invoice {
    pub v: u8,                      // format version, always 1
    pub invoice_id: String,         // ^[A-Za-z0-9_-]{1,32}$
    pub merchant: AccountId,        // receives amount - tax (+ overpayment on sweep)
    pub tax_vault: AccountId,       // receives tax
    pub tax_bps: u16,               // 0..=10000
    pub amount: u128,               // exact price, yoctoNEAR
    pub expires_at_ms: u64,         // unix ms; pay() after this refunds
    pub salt: u64,                  // random; makes two invoices with equal terms different accounts
    pub status: u8,                 // 0 OPEN, 1 PAID, 2 EXPIRED  (initial: 0)
    pub paid_by: Option<AccountId>, // initial: None; Some(payer) after pay(); None after sweep()
    pub paid_at_ms: u64,            // initial: 0
    pub paid_amount: u128,          // initial: 0
    pub tax_amount: u128,           // initial: 0
}
```

### 2.2 Borsh encoding rules (what `invoiceStateBytes()` writes)

| Field | Encoding |
|---|---|
| u8 / u16 / u64 / u128 | little-endian, 1 / 2 / 8 / 16 bytes |
| String, AccountId | u32 LE byte length, then UTF-8 bytes |
| Option<AccountId> | `00` for None; `01` + string for Some |

### 2.3 Worked example (FROZEN test vector)

Terms: `invoice_id="INV-0001"`, `merchant="zi-merchant.testnet"`, `tax_vault="zi-taxvault.testnet"`, `tax_bps=800`,
`amount=1 NEAR = 1000000000000000000000000`, `expires_at_ms=1794700800000` (2026-11-15T00:00:00Z), `salt=42`.

STATE bytes (135 bytes, hex):
```
01                                      v = 1
08000000 494e562d30303031               "INV-0001"
13000000 7a692d6d65726368616e742e746573746e6574   "zi-merchant.testnet"
13000000 7a692d7461787661756c742e746573746e6574   "zi-taxvault.testnet"
2003                                    tax_bps = 800
000000a1edccce1bc2d3000000000000      amount = 10^24  (u128 LE)
00f080dca1010000                        expires_at_ms = 1794700800000
2a00000000000000                        salt = 42
00                                      status OPEN
00                                      paid_by None
0000000000000000                        paid_at_ms 0
00000000000000000000000000000000        paid_amount 0
00000000000000000000000000000000        tax_amount 0
```
As one string:
`0108000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

The Rust test `state_layout_is_frozen` and the TS test `ZeroInit invoice example` both assert this exact hex.

---

## 3. Account-id derivation (FROZEN)

### 3.1 `0u` (primary) — NEP-655

```
raw = borsh(UniversalStateInit::V1(UniversalStateInitV1 {
        code: Some(GlobalContractIdentifier::CodeHash(<32 bytes>)),
        data: { b"STATE": <STATE bytes> },
        access_keys: {} }))
account_id = "0u" + crockford_base32_lower( SHA3-256(raw) )      // 54 chars total
```

Byte layout of `raw`:
```
00                    UniversalStateInit::V1
01                    Option::Some (code)
00 <32 bytes>         GlobalContractIdentifier::CodeHash      (AccountId variant would be: 01 + u32 len + utf8)
01000000              data: map with 1 entry (entries sorted bytewise by key; no duplicates)
05000000 5354415445   key "STATE"
<u32 len> <STATE>     value
00000000              access_keys: empty set
```

Crockford alphabet: `0123456789abcdefghjkmnpqrstvwxyz` (no i, l, o, u). Read the 32-byte hash MSB-first, 5 bits per
symbol, 52 symbols. The last symbol carries 1 data bit plus 4 zero pad bits, so it is always `0` or `g`.
Algorithm (copy of nearcore `base32_encode`):
```
acc = 0; nbits = 0; out = "0u"
for byte in hash:
    acc = (acc << 8) | byte; nbits += 8
    while nbits >= 5: nbits -= 5; out += ALPHABET[(acc >> nbits) & 31]
    acc &= (1 << nbits) - 1
out += ALPHABET[(acc << (5 - nbits)) & 31]      # here nbits == 1
```

**Test vectors** (all pass in `test/vectors.test.ts`):

| Input | Expected |
|---|---|
| hash = 32×`00` | `0u0000000000000000000000000000000000000000000000000000` |
| hash = 32×`ff` | `0uzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzg` |
| hash = `00 01 02 … 1f` | `0u000g40r40m30e209185gr38e1w8124gk2gahc5rr34d1p70x3rfg` |
| hash[i] = 7·i mod 256 | `0u003gw58w4cn32e1z8s6n8pv2d5r7ezm5hj9sn8d8nyvbvh6btbcg` |
| NEP-655 Appendix A raw (near/intents wallet, code by AccountId `0sb0d7…23a3`, key `""`) | `0u4bfkw2qvgfzbf7zzkxykcppqymn0p2hbayjee3ygzrbhmmtyejx0` |
| ZeroInit example (§2.3), code hash = 32×`11` (base58 `29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2`) | raw is 191 bytes → `0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0` |

The ZeroInit example raw (hex, 191 bytes):
`000100111111111111111111111111111111111111111111111111111111111111111101000000050000005354415445870000000108000000494e562d30303031130000007a692d6d65726368616e742e746573746e6574130000007a692d7461787661756c742e746573746e65742003000000a1edccce1bc2d300000000000000f080dca10100002a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

The real code hash is only known after building the wasm. On testnet the invoice ids will differ from the example, and that is expected.

### 3.2 `0s` (fallback) — NEP-616

```
raw0s = borsh(DeterministicAccountStateInit::V1 { code: GlobalContractIdentifier, data })
      = 00 | 00 <32-byte code hash> | 01000000 | 05000000 "STATE" | <u32 len> <STATE>
account_id = "0s" + hex( keccak256(raw0s)[12..32] )            // 42 chars total
```
Vectors: NEP-655 wallet state → `0scdb6cfeed476fc878af9d3246768cbe803714c87` (this account exists on mainnet: `view_account`
returned storage_usage 251, `global_contract_account_id` `0sb0d7ef4f935c6ef78e08ad03569767aaec4223a3`).
ZeroInit example with code hash 32×`11` → `0s36a782a21608104487f1334939347baebedfc7e1`.

---

## 4. Transactions (FROZEN wire format)

near-api-js 7.4.0 has RPC *types* for `DeterministicStateInit`, but its Borsh schema only holds a placeholder for it
(`{ deterministicStateInit: "string" } // placeholder ... should not be used`), and it has no `UniversalStateInit` at all.
So we encode transactions ourselves (`src/tx.ts`).

### 4.1 Transaction V0 layout
```
signer_id    : string
public_key   : u8 key_type (0 = ED25519) + 32 bytes
nonce        : u64
receiver_id  : string
block_hash   : 32 bytes (base58-decode of a recent block hash)
actions      : u32 count + each action (u8 discriminant + body)
```
Signature: `ed25519.sign( sha256(tx_bytes), seed )`. SignedTransaction = `tx_bytes || 00 || sig(64)`.
Send base64 of SignedTransaction with RPC `send_tx`. Tx hash = base58(sha256(tx_bytes)).

### 4.2 Actions used

| Action | Discriminant | Body |
|---|---|---|
| FunctionCall | `02` | method: string, args: Vec<u8>, gas: u64, deposit: u128 |
| Transfer | `03` | deposit: u128 |
| DeterministicStateInit (fallback) | `0b` | DeterministicAccountStateInit borsh (inline, no length prefix) + deposit u128 |
| UniversalStateInit | `0f` | RawStateInit = **u32 length + raw bytes**, then deposit u128 |

Note: the account id hashes `raw` only, never the length-prefixed form ([NC] `core/primitives-core/src/universal_state_init.rs` doc comment).

### 4.3 The three transaction shapes ZeroInit sends

| Name | signer | receiver | actions |
|---|---|---|---|
| PAY | payer | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"pay", "{}", 50 Tgas, deposit = amount}]` |
| SWEEP | sweeper (anyone) | invoice `0u` id | `[UniversalStateInit{raw, deposit:0}, FunctionCall{"sweep", "{}", 50 Tgas, 0}]` |
| (external) PLAIN TRANSFER | any wallet | invoice `0u` id | `[Transfer{amount}]`, sent by the payer's own wallet, not by us |

`deposit:0` on UniversalStateInit is correct while storage ≤ 770 bytes. The estimate is ~312 bytes before `pay()` and ~329 after;
the first live storage measurement (docs/SPIKES.md) gives the real number. If a run shows `LackBalanceForState`, set it to `10000000000000000000000` (0.01 NEAR);
the unused part is refunded to the signer.

### 4.4 Signed PAY vector (FROZEN test vector, passes against near-api-js parity test)

- secret key: `ed25519:2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6iuCXagjUCKEQF21awZnUGxmwD4m9vGXuC3qieHXJQHAcT` (seed = 32×`01`; TEST ONLY, never fund it)
- public key: `ed25519:AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9`
- signer `payer.testnet`, nonce `5`, block hash 32×`07` (base58 `US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx`)
- receiver = §3.1 example id, actions = PAY shape with raw from §3.1, amount 1 NEAR
- tx bytes: 402 bytes, sha256 `f837a322ed4cf0307bca7a9b403800b162aca9a172d2829e5a4653a5ce8981d9`
- signature: `19ef11bd3c9d15bf361c9522b1ee5c8c1346af278d3bdd4ad4c784399d241561633743a05baeda5b255b4f27540f0269e0c3d2d61f05698a631cde87fea7a30e`
- signed tx base64: see the literal in `test/vectors.test.ts`.

Encoder parity vector (Transfer 1 NEAR + FunctionCall `pay` `{}` 30 Tgas 1 yocto, same key/nonce/block, receiver
`0u4bfkw2…ejx0`): our bytes equal `near-api-js@7.4.0 encodeTransaction()` exactly (207 bytes).

---

## 5. Contract methods (FROZEN)

All methods take **no arguments** (send args `{}`, i.e. bytes `7b7d`). Strings returned are JSON strings.

### 5.1 `pay() -> String`  — `#[payable]`, callable by anyone

Let `d` = attached deposit, `payer` = predecessor, `now` = block_timestamp_ms.

| Condition (checked in this order) | Effect | Returns | Event |
|---|---|---|---|
| status ≠ OPEN | transfer `d` back to payer | `"REFUNDED_NOT_OPEN"` | `payment_refunded` reason `not_open` |
| now > expires_at_ms | refund `d`; status := EXPIRED | `"REFUNDED_EXPIRED"` | `payment_refunded` reason `expired` |
| d < amount | refund `d`; status stays OPEN | `"REFUNDED_UNDERPAID"` | `payment_refunded` reason `underpaid` |
| else | tax = amount·tax_bps/10000 (floor); net = amount − tax; excess = d − amount; transfer net→merchant, tax→tax_vault, excess→payer (each only if > 0); status := PAID, paid_by := payer, paid_at_ms := now, paid_amount := amount, tax_amount := tax | `"PAID"` | `invoice_paid` via `pay` |

`pay()` never panics on business rules. It refunds instead, so the account still materializes and the refund shows up on-chain.
Example: amount 1 NEAR, 800 bps → merchant `920000000000000000000000`, vault `80000000000000000000000`.

### 5.2 `sweep() -> String` — no deposit, callable by anyone

`avail` = account_balance − storage reserve (reserve = 0 while storage_usage ≤ 770, else storage_usage × storage_byte_cost).

| Condition | Effect | Returns / panic | Event |
|---|---|---|---|
| status OPEN and avail < amount | **panic** `UNDERPAID: available <avail> < amount <amount>`; whole receipt reverts, funds stay parked | (tx fails) | none |
| status OPEN and avail ≥ amount | tax = amount·bps/10000; net = avail − tax (overpayment goes to merchant: payer unknown); transfer; status := PAID, paid_by := None, paid_amount := avail | `"PAID"` | `invoice_paid` via `transfer`, `late` = now > expires_at_ms |
| status PAID/EXPIRED and avail == 0 | **panic** `NOTHING_TO_SWEEP` | (tx fails) | none |
| status PAID/EXPIRED and avail > 0 | transfer avail → merchant | `"EXTRA_SWEPT"` | `extra_swept` |

### 5.3 `get_invoice() -> InvoiceView` — view

```json
{
  "v": 1,
  "account_id": "0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0",
  "invoice_id": "INV-0001",
  "merchant": "zi-merchant.testnet",
  "tax_vault": "zi-taxvault.testnet",
  "tax_bps": 800,
  "amount": "1000000000000000000000000",
  "expires_at_ms": "1794700800000",
  "salt": "42",
  "status": "PAID",
  "paid_by": "zi-payer.testnet",
  "paid_at_ms": "1794651234567",
  "paid_amount": "1000000000000000000000000",
  "tax_amount": "80000000000000000000000"
}
```
(u64/u128 are JSON strings, near-sdk `U64`/`U128`.) A view call on an uninitialized or nonexistent account fails; the
CLI handles that through `view_account` first (§7).

### 5.4 Events (NEP-297 style log lines, FROZEN)

Each log line is `EVENT_JSON:` + compact JSON, with `data` an array of exactly one object:
```
EVENT_JSON:{"standard":"zeroinit","version":"1.0.0","event":"invoice_paid","data":[{"invoice_id":"INV-0001","account_id":"0u…","via":"pay","payer":"zi-payer.testnet","amount":"1000000000000000000000000","merchant_amount":"920000000000000000000000","tax_amount":"80000000000000000000000","excess_refunded":"0","late":false}]}
EVENT_JSON:{"standard":"zeroinit","version":"1.0.0","event":"payment_refunded","data":[{"invoice_id":"INV-0001","account_id":"0u…","payer":"zi-payer.testnet","amount":"500000000000000000000000","reason":"underpaid"}]}
EVENT_JSON:{"standard":"zeroinit","version":"1.0.0","event":"extra_swept","data":[{"invoice_id":"INV-0001","account_id":"0u…","amount":"…","to":"zi-merchant.testnet"}]}
```
For `via:"transfer"`, `payer` is `null`. Key order inside objects is whatever serde_json emits. **Parsers must parse the JSON,
never compare strings.**

### 5.5 Access rules and storage
- No owner, no keys: `access_keys` is empty, so the account can never sign anything. Only `pay`, `sweep` and `get_invoice` exist.
- Code is immutable (referenced by hash). Terms are immutable except the status/paid fields.
- Storage: account record 100 B + code ref + one `STATE` record (5 + len + 40 B). Must stay ≤ 770 B (zero-balance account).

---

## 6. Off-chain data formats (FROZEN)

### 6.1 Invoice document `invoices/<invoice_id>.json` (written by `zi invoice new`)

```json
{
  "format": "zeroinit-invoice/1",
  "network": "testnet",
  "scheme": "0u",
  "code_hash": "29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2",
  "invoice_id": "INV-0001",
  "merchant": "zi-merchant.testnet",
  "tax_vault": "zi-taxvault.testnet",
  "tax_bps": 800,
  "amount_yocto": "1000000000000000000000000",
  "amount_near": "1",
  "expires_at_ms": "1794700800000",
  "expires_at_iso": "2026-11-15T00:00:00.000Z",
  "salt": "42",
  "state_hex": "0108000000494e…",
  "raw_state_init_hex": "000100111111…",
  "account_id": "0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0",
  "created_at_iso": "2026-11-09T12:00:00.000Z"
}
```
Rules: `account_id` MUST equal the derivation of `raw_state_init_hex`, and `raw_state_init_hex` MUST equal the encoding of the
terms. `zi verify` recomputes both from the terms alone. `scheme` is `"0u"` or `"0s"`. `code_hash` is base58 of 32 bytes.

### 6.2 Receipt `invoices/<invoice_id>.receipt.json` (written by `zi receipt`)

```json
{
  "format": "zeroinit-receipt/1",
  "invoice": { "...": "the full invoice document from 6.1" },
  "onchain": { "...": "get_invoice() result from 5.3" },
  "account": { "amount": "0", "storage_usage": 329, "global_contract_hash": "<base58>" },
  "tx_hash": "<base58 or null>",
  "events": [ { "...": "parsed EVENT_JSON objects found in the tx receipts" } ],
  "checks": { "id_matches_terms": true, "code_hash_matches": true, "terms_match_onchain": true, "status": "PAID" },
  "generated_at_iso": "2026-11-09T12:05:00.000Z"
}
```

### 6.3 Fixture / replay file `fixtures/demo-run.json` (written live with `ZI_RECORD=…`, read by `zi replay`)

```json
{
  "format": "zeroinit-fixture/1",
  "recorded_at_iso": "2026-11-12T10:00:00.000Z",
  "rpc_url": "https://rpc.testnet.near.org",
  "invoices": [ { "...": "invoice document §6.1" } ],
  "calls": [
    { "seq": 0, "invoice_id": "INV-1001", "label": "before: view_account", "method": "query",
      "params": {"request_type":"view_account","finality":"final","account_id":"0u…"},
      "response": {"jsonrpc":"2.0","id":"zi","error":{"name":"HANDLER_ERROR","cause":{"name":"UNKNOWN_ACCOUNT","info":{}}}} },
    { "seq": 5, "invoice_id": "INV-1001", "label": "pay: tx_status", "method": "EXPERIMENTAL_tx_status",
      "params": {"tx_hash":"…","sender_account_id":"…","wait_until":"FINAL"},
      "response": { "jsonrpc":"2.0","id":"zi","result": { "...": "full EXPERIMENTAL_tx_status result (has receipts with actions)" } } }
  ]
}
```
Written by `src/rpc.ts` when `ZI_RECORD` is set. `zi invoice new` adds the doc to `invoices`, and every later RPC call is
tagged with the current `invoice_id`. `label` values the CLI writes (exact):
`before: view_account` (`pay`), `before: get_invoice`, `transfer-path: view_account (uninitialized)` (`sweep`/`init`, before sending),
`transfer-path: get_invoice (uninitialized)`, `pay: send_tx`, `pay: tx_status`, `sweep: send_tx`, `sweep: tx_status`,
`init: send_tx`, `init: tx_status`, `after: view_account`, `after: get_invoice`, `sweep-after: view_account`,
`sweep-after: get_invoice`. All other calls (status, block, view_access_key) use `aux: <method>`.
A synthetic example that passes `zi replay` is `fixtures/v2/synthetic-demo.json` (`"synthetic": true`; never present it as real).

### 6.4 Environment variables (never commit values; `.env.example` lists names only)

| Var | Meaning | Example (placeholder) |
|---|---|---|
| `ZI_RPC_URL` | RPC endpoint | `https://rpc.testnet.near.org` |
| `ZI_NETWORK` | must be `testnet` (CLI refuses anything else) | `testnet` |
| `ZI_CODE_HASH` | base58 code hash of the deployed global contract | `<CODE_HASH_B58>` |
| `ZI_SCHEME` | `0u` (default) or `0s` | `0u` |
| `ZI_PAYER_ACCOUNT` / `ZI_PAYER_KEY` | payer account and `ed25519:…` secret | `<you>-zi-payer.testnet` / `<SECRET>` |
| `ZI_SWEEPER_ACCOUNT` / `ZI_SWEEPER_KEY` | sweeper account and secret | `<you>-zi-merchant.testnet` / `<SECRET>` |
| `ZI_RECORD` | if set, append every RPC request/response to this fixture path | `fixtures/demo-run.json` |
| `ZI_INVOICE_DIR` | where invoice docs live | `invoices` |

---

## 7. CLI `zi` (FROZEN). Run as `node src/cli.ts <command> [flags]` or `npm run zi -- <command> [flags]`

Common: exit code 0 = success, 1 = check failed / business failure, 2 = usage error. Output is human text by default,
`--json` prints one JSON object instead. Amount flags take NEAR decimal strings (`1`, `0.5`).

| Command | Flags | Network? | Keys? | Output (text mode, exact first token per line) |
|---|---|---|---|---|
| `zi vectors` | — | no | no | `PASS crockford-kat` …, `PASS wallet-0u`, `PASS wallet-0s`, `PASS example-0u`, `PASS example-0s`; exit 1 if any FAIL |
| `zi invoice new` | `--id <ID> --merchant <acct> --tax-vault <acct> --tax-bps <n> --amount <NEAR> (--expires-in <Nh\|Nm> \| --expires-at <ISO>) [--salt <u64>] [--scheme 0u\|0s] [--code-hash <b58>]` | no | no | `INVOICE <ID>`, `ACCOUNT <0u…>`, `PAY <amount> NEAR before <ISO>`, `FILE invoices/<ID>.json` |
| `zi status <ID>` | — | yes | no | `STATE NONEXISTENT` \| `STATE UNINITIALIZED balance=<NEAR>` \| `STATE INITIALIZED status=<OPEN\|PAID\|EXPIRED> paid_by=<acct\|null> balance=<NEAR> storage=<bytes>` |
| `zi pay <ID>` | `[--amount <NEAR>]` (default = invoice amount) `[--no-init]` (omit the state-init action; a fallback in case the one-transaction batch failed) | yes | payer | `TX <hash>`, `RESULT <PAID\|REFUNDED_…>`, `EVENT <event> …`, `TRANSFER <to> <NEAR>` per outgoing transfer, `LINK https://testnet.nearblocks.io/txns/<hash>` |
| `zi init <ID>` | — | yes | sweeper | sends only `[UniversalStateInit]` (fallback flow) → `TX <hash>`, `STATE INITIALIZED …` |
| `zi sweep <ID>` | — | yes | sweeper | same lines as `pay` |
| `zi verify <ID>` | `[--offline]` | yes unless `--offline` | no | `PASS id-from-terms`, `PASS raw-from-terms`, (online) `PASS code-hash-onchain`, `PASS terms-onchain`, `INFO status=<…>`; exit 1 on any FAIL |
| `zi receipt <ID>` | `[--tx <hash>]` | yes | no | writes §6.2 file; prints `RECEIPT invoices/<ID>.receipt.json` and a Markdown table |
| `zi replay <fixture>` | — | **no** | no | one line per check, format `PASS|FAIL <check> <invoice_id> [detail]`. Checks per invoice in the fixture: `id-from-terms`, `before-unknown-account` (if recorded), `transfer-path-uninitialized`, `pay-tx-success` / `sweep-tx-success` (tx succeeded, receiver = invoice id, tx carried exactly the recomputed raw state init), `split-merchant <NEAR>`, `split-vault <NEAR>` (from the receipts' Transfer actions), `refund-event REFUNDED_…`, `sweep-underpaid-reverted` (a sweep that panicked UNDERPAID: expected, funds stay parked), `after-terms-match`, `after-status-<STATUS>`. Only the first `before: view_account` and the first `transfer-path: …` snapshot per invoice are checked. Exit 1 on any FAIL or if no checks ran |
| `zi serve` (SHOULD) | `[--port 8787]` | yes | payer+sweeper (server side) | HTTP API §8 + `web/index.html` |

Status mapping from RPC (exact):
- `query view_account` error with `cause.name == "UNKNOWN_ACCOUNT"` → `NONEXISTENT`
- result has `"state":"uninitialized"` → `UNINITIALIZED`
- otherwise → `INITIALIZED`, then call `get_invoice` for the status.

---

## 8. Local HTTP API of `zi serve` (SHOULD; localhost only, binds 127.0.0.1)

| Method & path | Body | Response 200 |
|---|---|---|
| `GET /` | — | `web/index.html` |
| `GET /api/invoices` | — | `[{invoice doc §6.1}, …]` |
| `POST /api/invoices` | `{"id","merchant","tax_vault","tax_bps","amount_near","expires_in_minutes"}` | invoice doc |
| `GET /api/invoices/:id/status` | — | `{"state":"NONEXISTENT\|UNINITIALIZED\|INITIALIZED","balance_yocto":"…","storage_usage":n\|null,"invoice":InvoiceView\|null}` |
| `POST /api/invoices/:id/pay` | `{"amount_near"?: "1"}` | `{"tx_hash","result","events":[…],"transfers":[{"to","yocto"}]}` |
| `POST /api/invoices/:id/sweep` | `{}` | same as pay |
Errors: `{"error":"<message>"}` with status 400 (bad input) or 502 (RPC/tx failure).

---

## 9. RPC calls used (JSON-RPC 2.0, POST, `Content-Type: application/json`, id `"zi"`)

| Purpose | method | params |
|---|---|---|
| network check | `status` | `[]` → assert `chain_id == "testnet"`, `protocol_version >= 88` |
| account state | `query` | `{"request_type":"view_account","finality":"final","account_id":X}` |
| nonce | `query` | `{"request_type":"view_access_key","finality":"final","account_id":S,"public_key":"ed25519:…"}` → `result.nonce` |
| block hash | `block` | `{"finality":"final"}` → `result.header.hash` (base58) |
| view call | `query` | `{"request_type":"call_function","finality":"final","account_id":X,"method_name":"get_invoice","args_base64":"e30="}` → `result.result` is a byte array, decode UTF-8 then JSON.parse |
| send | `send_tx` | `{"signed_tx_base64":B,"wait_until":"EXECUTED_OPTIMISTIC"}` |
| tx + receipts lookup | `EXPERIMENTAL_tx_status` | `{"tx_hash":H,"sender_account_id":S,"wait_until":"FINAL"}` |

`EXPERIMENTAL_tx_status` result shape (checked live on a testnet tx on 2026-11-09): keys `final_execution_status`, `receipts`,
`receipts_outcome`, `status`, `transaction`, `transaction_outcome`. `receipts[i] = {predecessor_id, receiver_id, receipt_id,
receipt: {Action: {actions: [{Transfer: {deposit: "…"}} | {FunctionCall: {…}} …], …}}}`. Gas refunds have
`predecessor_id: "system"`. In `transaction.actions` the state init appears as
`{"UniversalStateInit": {"state_init": "<base64 raw>", "deposit": "0"}}` ([NC] `core/primitives/src/views.rs` `ActionView::UniversalStateInit`).

Outcome parsing (`src/outcome.ts`, tested): success = `status` has no `Failure` AND no `receipts_outcome[*].outcome.status`
has `Failure`. Logs = all `receipts_outcome[*].outcome.logs`. Events = logs starting `EVENT_JSON:` with `standard == "zeroinit"`.
Transfers = Transfer actions in `receipts` whose `predecessor_id` is the invoice account. Return value = base64-decode
`status.SuccessValue`, then JSON.parse → e.g. `"PAID"`.
