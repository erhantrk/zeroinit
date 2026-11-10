# T21 judge-simulation notes

Fresh-reader simulation: a clean clone of the repo, no `.env`, no `ZI_*` variables, prompt
“Follow README.md exactly. Report every command that does not produce the stated output.”

## First-pass findings (before the fixes)

1. `npm ci` under `NODE_ENV=production` installed 3 packages instead of 68; `npm test` then failed 1 of 21
   (`ERR_MODULE_NOT_FOUND: near-api-js`). README changed to `npm ci --include=dev`, matching
   `scripts/judge-offline.sh`; re-run gave 26/26 tests.
2. The “Claims” table `invoice new` command exited 2 in a clean clone
   (`ERROR set ZI_CODE_HASH or pass --code-hash`) because it assumed an ambient `ZI_CODE_HASH`. The command now
   includes `--code-hash Amg4WXKyZe2RAyjUjtX2cgU4RW5615abgccyKtiUGW6k` and works with no `.env`.

Both fixes are README-only. The clean final report is [JUDGE-DRYRUN.md](./JUDGE-DRYRUN.md)
(`JUDGE-DRYRUN: CLEAN`).
