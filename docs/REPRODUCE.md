# Is the wasm built from the source?

**Yes for the current deployment, v3.3, and you can rebuild it.** This is an optional deep check; the main judge path ([VERIFY.md](VERIFY.md)) does not need Docker or a checkout of an older commit.

## What is deployed

| | |
|---|---|
| Deployment | **v3.3**, published on testnet as a global contract by hash |
| Code hash | `CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb` |
| Committed wasm | `contract/res/v3.3/zeroinit_invoice.wasm`, 170,344 bytes, sha256 `b03c1b08a2b45b9f87163c9b9412e081a221fbb06b229dae26deecc416512a8e` (base58 of that digest = the code hash) |
| Built by | `cargo near build reproducible-wasm` at commit `7727a1c` |
| Publish tx | `2Sr5wa1TF117WpEyjBDPFx5jULPJQKVzZ4ooy8hA6TPS`, signer `zeroinit-deployer.testnet`, burn 17.0358 NEAR (the `tokens_burnt` of that tx). The deployer was funded by two 9.9 NEAR transfers from `zeroinit-funder1.testnet` and `zeroinit-funder2.testnet` |
| Source | the v3.3 contract source (`contract/src`): `git diff 7727a1c HEAD -- contract/src` is empty |

Three links connect the source to the chain:

1. **Source → wasm:** the reproducible build below produces the committed file byte for byte.
2. **wasm → code hash:** `shasum -a 256 contract/res/v3.3/zeroinit_invoice.wasm` gives `b03c1b08…2a8e`, whose base58 is `CrwuvfSL…aVsb` (`test/wasm-files.test.ts` checks this in `npm test`).
3. **code hash → chain:** `npm run zi -- verify INV-1111-V33-A` prints `PASS code-hash-onchain CrwuvfSL…aVsb` (the invoice account runs that hash), and the on-chain bytes
   returned by `view_global_contract_code` for that hash were compared with the committed file on 2026-11-13: 170,344 bytes, same sha256.

## Rebuild it

`contract/Cargo.toml` has a pinned `[package.metadata.near.reproducible_build]`: image `sourcescan/cargo-near:0.23.0-rust-1.99.1`, pinned by digest
`sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc` (the same image as for v3.2r). Needs Docker and cargo-near.

```bash
git checkout 7727a1c          # the build commit (see below why it must be this one)
cd contract && cargo near build reproducible-wasm
shasum -a 256 target/near/zeroinit_invoice.wasm       # b03c1b08a2b45b9f87163c9b9412e081a221fbb06b229dae26deecc416512a8e, 170,344 bytes
```

Compare the digest with `contract/res/v3.3/zeroinit_invoice.wasm` and with the code hash `zi verify` prints. (`npm run contract:build` runs the same build on the current checkout.)

**Why only commit `7727a1c`.** The reproducible build records its commit in the contract metadata, so a build from a *later* commit gives a different wasm and a different
hash, even though `contract/src` did not change. Only `7727a1c` reproduces `CrwuvfSL…`.

The project's operator ran this build twice on 2026-11-13; both gave the same hash, and that is the committed file.

## One command, straight from the chain

Every v3.3 invoice account answers `contract_source_metadata` (NEP-330): the repository link at commit `7727a1c`, the pinned image and the build command. near-cli-rs (0.31.1) reads
that, rebuilds the recorded commit in Docker and compares the result with the account's code:

```bash
near contract verify deployed-at 0us40y0dm1767jkzzxynmwjer15h4xy5wc96rg3xv5hfgs8fx421ag network-config testnet now
# … The code obtained from the contract account ID and the code calculated from the repository are the same.
#   Contract code hash: CrwuvfSLJoHs4GkkqqL22PeHG2BdcxmnMoxX2zcfaVsb
```

The account is `INV-1111-V33-A`; any v3.3 invoice account gives the same answer, since they all run the same global code. The workflow
[`verify-contract.yml`](../.github/workflows/verify-contract.yml) runs this command on every push to `main` (checksum-verified near-cli-rs release, GitHub's runner, no key)
and also checks that the committed wasm hashes to the same code hash; its badge is in the README. That is a rebuild by a party other than the operator's machine.

## Earlier versions

- **v3.2r** (`BQLSk5carin64UMreToJHT15gvow6wqZSyKqDz7zCFry`, history since v3.3): the v3.2 source built reproducibly at commit `4116e69`. The committed wasm `contract/res/v3.2r/zeroinit_invoice.wasm` is 163,788 bytes,
  sha256 `9a8f368d406392f566d64293d148dcbbee016db8a4d6948c82f6996ce7775b92`; it equals the on-chain bytes (compared on 2026-11-12). Publish tx `DYP9bS9hn7Laip759uTCZ1t3uVF9caWKGZxHM7SdUuNs`, signer `sm1110-zi-deployer.testnet`; the burn was not computed.
  To rebuild it, run the same commands at `git checkout 4116e69`; only that commit reproduces `BQLSk5ca…`. The operator ran that build once, on 2026-11-12.
- **v3.2** (`6YtW5oJ8UtCrzUePQf14zqKMb9G3DUtMynEnZvMCNHJ`, history): the committed wasm `contract/res/v3.2/zeroinit_invoice.wasm` (164,040 bytes, sha256 `016bf5ba…5e63d`) equals the on-chain bytes (compared on 2026-11-11),
  but it was a local, non-reproducible build from commit `2a57328`, so that it was built from `contract/src` rests on trust in that local build.
  v3.2r is the same source built reproducibly; the unit tests and all recorded runs behave the same (`test/live-v32r.test.ts` pins the same check names as v3.2's). The two wasm files were not compared semantically.
- **v1 to v3.1:** no reproducible build. v3.1 was a local build from commit `d1c185a`; older wasm files are in git history ([HISTORY.md "Deploy transactions and burns"](HISTORY.md#deploy-transactions-and-burns)).
  `contract-v2/Cargo.toml` still names an image tag that does not exist and `image_digest = "UNSET"`. A byte-identical v2 rebuild was reported by a judge-side run and was not repeated here, so treat it as unverified
  ([HISTORY.md "The v2 wasm rebuild"](HISTORY.md#the-v2-wasm-rebuild-not-re-run-here)).
