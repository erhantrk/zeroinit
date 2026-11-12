# Is the wasm built from the source?

**Yes for the current deployment, v3.2r, and you can rebuild it.** This is an optional deep check; the main judge path ([VERIFY.md](VERIFY.md)) does not need Docker or a checkout of an older commit.

## What is deployed

| | |
|---|---|
| Deployment | **v3.2r**, published on testnet as a global contract by hash |
| Code hash | `BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry` |
| Committed wasm | `contract/res/v3.2r/zeroinit_invoice.wasm`, 163,788 bytes, sha256 `9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92` (base58 of that digest = the code hash) |
| Built by | `cargo near build reproducible-wasm` at commit `4116e69` |
| Publish tx | `DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs`, signer `sm1110-zi-deployer.testnet` (funded by three transfers from the retired v2 accounts; the burn was not computed) |
| Source | the v3.2 contract source (`contract/src`), unchanged since the v3.2 build: `git diff 2a57328 4116e69 -- contract/src` and `git diff 4116e69 HEAD -- contract/src` are both empty |

Three links connect the source to the chain:

1. **Source → wasm:** the reproducible build below produces the committed file byte for byte.
2. **wasm → code hash:** `shasum -a 256 contract/res/v3.2r/zeroinit_invoice.wasm` gives `9a8f368d…5b92`, whose base58 is `BQLSk5ca…zCFry` (`test/wasm-files.test.ts` checks this in `npm test`).
3. **code hash → chain:** `npm run zi -- verify INV-1111-V32R-A` prints `PASS code-hash-onchain BQLSk5ca…zCFry` (the invoice account runs that hash), and the on-chain bytes
   returned by `view_global_contract_code` for that hash were compared with the committed file on 2026-11-12: identical.

## Rebuild it

`contract/Cargo.toml` has a pinned `[package.metadata.near.reproducible_build]`: image `sourcescan/cargo-near:0.23.0-rust-1.99.1`, pinned by digest
`sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc`. Needs Docker and cargo-near.

```bash
git checkout 4116e69          # the build commit (see below why it must be this one)
cd contract && cargo near build reproducible-wasm
shasum -a 256 target/near/zeroinit_invoice.wasm       # 9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92, 163,788 bytes
```

Compare the digest with `contract/res/v3.2r/zeroinit_invoice.wasm` and with the code hash `zi verify` prints. (`npm run contract:build` runs the same build on the current checkout.)

**Why only commit `4116e69`.** The reproducible build records its commit in the contract metadata, so a build from a *later* commit gives a different wasm and a different
hash, even though `contract/src` did not change. Only `4116e69` reproduces `BQLSk5ca…`.

This build was run once by the project's operator, on 2026-11-12, and produced the committed file. No independent party has reported repeating it.

## Earlier versions

- **v3.2** (`6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ`, history): the committed wasm `contract/res/v3.2/zeroinit_invoice.wasm` (164,040 bytes, sha256 `016bf5ba…5e63d`) equals the on-chain bytes (compared on 2026-11-11),
  but it was a local, non-reproducible build from commit `2a57328`, so that it was built from `contract/src` rests on trust in that local build.
  v3.2r is the same source built reproducibly; the unit tests and all recorded runs behave the same (`test/live-v32r.test.ts` pins the same check names as v3.2's). The two wasm files were not compared semantically.
- **v1 to v3.1:** no reproducible build. v3.1 was a local build from commit `d1c185a`; older wasm files are in git history ([HISTORY.md "Deploy transactions and burns"](HISTORY.md#deploy-transactions-and-burns)).
  `contract-v2/Cargo.toml` still names an image tag that does not exist and `image_digest = "UNSET"`. A byte-identical v2 rebuild was reported by a judge-side run and was not repeated here, so treat it as unverified
  ([HISTORY.md "The v2 wasm rebuild"](HISTORY.md#the-v2-wasm-rebuild-not-re-run-here)).
