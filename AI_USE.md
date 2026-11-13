# AI use and code provenance

Everything in this repository was written with AI assistance. The human author, Erhan Türker, decided what to build, ran the accounts and is responsible for the result.
Every protocol claim is meant to be checked by a test, a replay or an on-chain read ([docs/VERIFY.md](docs/VERIFY.md)); the AI reviews below are not an independent audit.

## Who did what

The "operator" below is the model that held the testnet accounts and ran the deploys, on the author's approval.

- **Planning (2026-11-08/09):** Claude (Anthropic) wrote the plan and a reference implementation: most of `src/*.ts` and the first `contract/src/lib.rs`, later copied verbatim into the repository.
- **First build (v1 and the days after):** **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4.1-flash`, max effort), in Command Code agent sessions orchestrated by Conductor (a Claude Code based orchestrator):
  the scaffold, the first live testnet checks, the fixtures, the scripts, the dashboard and server additions, the docs, and the fixes after each daily review.
- **Token support (v3, 2026-11-10):** **Claude Sonnet 5.5** designed the interface ([docs/STABLECOIN.md](docs/STABLECOIN.md)); **DeepSeek V4.1 Flash** built the NEP-141 contract, its unit tests, the client, CLI and dashboard changes, the tests and the docs from it.
- **Claude Sonnet 5.5, reviews and live runs:** the daily code reviews and fixes; the v2 work (contract v2, the known-deployments list in the client, re-recorded fixtures and the live audit scenarios); the review of v3 and its fixes
  (four bugs, [docs/SPIKES.md "Findings of the live runs"](docs/SPIKES.md#findings-of-the-live-runs-each-fixed-with-a-test-that-fails-without-the-fix)); the live v3 and v3.1 runs and recordings, including the token-sweep race,
  the late-merchant run and the state-init deposit check; and the client, test and doc updates for v3.1.
- **Claude Opus 5.5, operator:** testnet accounts and funding, the tUSDC mock token and its registrations, the global contract deploys (v2, v3, v3.1, v3.2), the live runs it was asked to perform,
  the earlier final reviews and audits, and the browser screenshots in `docs/img/` (Chrome, 2026-11-10, v2 dashboard).
- **Final audit (2026-11-11):** **Claude Fable 5.2** audited the repository; **Claude Sonnet 5.5** fixed the findings (the v3.2 contract source, client, tests and documentation), with a test for each code fix.
- **v3.2 (2026-11-11):** **Claude Opus 5.5** built the v3.2 wasm, deployed it from `sm1110-zi32-deployer.testnet` and re-checked it; **Claude Sonnet 5.5** ran the live flows on v3.2 with the operator's accounts
  (NEAR pay, tUSDC plain transfer + sweep, the one-step `ft_transfer_call`, the `bad_msg` race), recorded and replayed them, and updated the client, tests and docs.
- **After v3.2 (2026-11-12 onward):** the v3.2r reproducible build and its live re-runs, the MCP server, the landing site and this documentation were also made with AI assistance (Claude models); they are not broken down by model here.
- **v3.3 (2026-11-13):** **Claude Fable 5.2** (in the morning) and then **Claude Opus 5.5** (after the author switched the session model), in Claude Code, built the v3.3 contract change
  (parked funds count toward the price) and the client changes (registration in the same transaction as a token payment, the address check code, the new default token), ran the live testnet runs and recorded them.
  Before the deploy, an independent **Claude Opus 5.5** review of the contract change found that a person who topped up parked funds could later reclaim them with `refund_payer` (fixed: such a settlement
  records no payer), that the replay checks would misread such payments (fixed: new checks), and smaller items (the `busy` bounce, event timing, the `late` flag, tests, stale docs), each handled.
  A **Claude Opus 5.5** agent made the site fixes (narrow-phone header, npm commands, share image), and another wrote this round's documentation update from the recorded facts.
  The author decided, approved the contract change and the new testnet accounts, and is responsible. v3.3 is still not audited by a human auditor.

Testnet transactions were signed with the repository's own encoder using keys from a local `.env` file, which is gitignored and was never printed or committed.

## Code provenance

There is no code from before the hackathon window: every commit is inside it.

- The first commit, `ea8d0fb` (2026-11-09 21:52 UTC), is the frozen plan. It contains `docs/plan/reference/` (removed from the current tree; still in that commit): a reference implementation
  (the TypeScript sources, tests and the contract) drafted with Claude during the planning phase of this hackathon (2026-11-08/09), not before it.
- Commit `1435bbf` (the scaffold commit) copied it verbatim into `src/` and `contract/`. The v1 deployed contract was that reference contract; v2 is the same contract with the audit fixes.
- **Only `src/vectors.ts` is still identical to the reference:** `git diff ea8d0fb:docs/plan/reference/ts/src/vectors.ts HEAD:src/vectors.ts` is empty.
  `src/outcome.ts` and `src/tx.ts` were extended for the token work; `bytes.ts`, `config.ts`, `rpc.ts`, `send.ts` and `stateinit.ts` were changed by the audit fixes (range checks, the pinned code hash, the testnet check).
- A diff that starts after `ea8d0fb` does not show the reference code. Because every commit is inside the window there is no earlier baseline and no compare link; use `git log --reverse --stat`
  (`git show ea8d0fb --stat` lists what the first commit contained).
- Added after the reference: the scaffold and toolchain, the live testnet runs and fixtures, the replay and dashboard extensions, the scripts, the extra tests, the docs, the review and audit fixes,
  v2, v3 (NEP-141 tokens), v3.1, v3.2, v3.2r, v3.3, the MCP server and the site. Test vectors are copied from nearcore (MIT/Apache-2.0) and cited inline.
- Code comments cite the internal plan and task numbers, which are not published.
