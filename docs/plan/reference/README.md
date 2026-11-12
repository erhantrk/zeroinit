# reference/ — verified code to COPY (do not rewrite)

Everything here was written and run on 2026-11-09 by the planner. Task T02 copied it into this repository.

| Path | What | Verified how |
|---|---|---|
| `contract/` | the complete invoice contract (near-sdk 5.30.1) + Cargo.lock | `cargo test` → 7 passed; `cargo near build non-reproducible-wasm` → 78,423-byte wasm (rustc 1.95.0, cargo-near 0.22.0) |
| `ts/src/bytes.ts, stateinit.ts, tx.ts` | Borsh helpers, invoice STATE, 0u/0s derivation, tx encoder/signing | `node --test test/vectors.test.ts` → 6 pass (nearcore 2.14 vectors; near-api-js 7.4.0 byte parity) |
| `ts/src/config.ts, rpc.ts, outcome.ts, send.ts, invoice.ts, vectors.ts, replay.ts, cli.ts` | CLI `zi` | `zi vectors` all PASS; `zi invoice new` reproduces the frozen example id; `zi verify --offline` PASS; `zi status` against live testnet → `STATE NONEXISTENT`; `zi replay fixtures/synthetic-demo.json` all PASS |
| `ts/src/server.ts`, `ts/web/index.html` | SHOULD dashboard | in-process smoke test: list, live status, HTML served |
| `ts/test/*.test.ts` | tests | `node --test test/*.test.ts` → 11 tests, 9 pass, 2 skipped (real fixtures not recorded yet), 0 fail |
| `ts/fixtures/synthetic-demo.json` | SYNTHETIC fixture (`"synthetic": true`) shaped like a real EXPERIMENTAL_tx_status | built by `ts/scripts/make-synthetic-fixture.mjs`; replace with real recordings on Day 2–3 |

NOT verified here (no keys, no transactions allowed for the planner): `pay`, `sweep`, `init`, `receipt` against the real chain.
Those are the Day-0 spikes (tasks T06–T09).

Sandbox notes (irrelevant on a normal laptop): in the planning sandbox `npm test` could not spawn a shell, so tests were run
with `node --test …` directly, and Node `fetch` needed `NODE_USE_ENV_PROXY=1` to reach the RPC through a proxy.
