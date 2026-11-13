# ZeroInit MCP server

An [MCP](https://modelcontextprotocol.io) server (stdio) so an AI agent can issue ZeroInit invoices and check them. It reuses the repo's own library code (derivation, verification, RPC and status parsing); nothing is re-implemented.

**Testnet only. Issuing is free. Paying is the payer's own transaction. This server never signs, never reads a key and never sends a transaction.**

## Tools

| Tool | What it does |
|---|---|
| `issue_invoice` | Takes `merchant`, `amount`, `invoice_number` and optionally `tax_vault`, `tax_bps`, `asset` (`NEAR` or `tUSDC`), `expires_in` / `expires_at`, `payout_grace_ms`, `salt`, `offline`. Returns the invoice document exactly as `zi invoice new` writes it (same fields, the layout and code hash of the current deployment, v3.2r), the derived `0u...` pay address and the pay instructions. A NEAR invoice is paid by the payer's one transaction (state init + `pay`) or by a plain transfer from any wallet that anyone then sweeps. A token invoice needs one `storage_deposit` registration of the pay address on the token first. The result states that no transaction was sent. Unless `offline` is true, it checks on testnet that merchant and tax vault exist (and are registered on the token). The document is not saved to disk. |
| `invoice_status` | Takes the invoice document (checked against its own terms and the pinned code hash) or a bare `account_id`. Returns the live testnet state: `NONEXISTENT`, `FUNDED_NOT_MATERIALIZED`, or the contract's status (`OPEN`, `PAID`, ...), the `get_invoice` view, token balance for token invoices and an explorer link. A forged document is `UNVERIFIED`. A network error comes back as data (`state: "UNKNOWN"`, `network_error`), not as a failure. |
| `verify_invoice` | The checks of `zi verify`: pay address and raw state init re-derived from the terms and the pinned code hash, token on the allow-list, and (unless `offline`) the on-chain code hash, terms and zero access keys. Returns each check as `{name, ok, detail}` (`ok: null` for information lines). If testnet is unreachable the offline checks are still returned with `onchain: "unreachable"`. |

Inputs are validated like the CLI: testnet accounts only, `NEAR` and the allow-listed token only (the mock tUSDC), strict amounts, a future expiry, `invoice_number` 1 to 32 characters of `A-Za-z0-9_-`. A refused input is an MCP error starting with `REFUSED:`. The server refuses to issue under a historical (v1 to v3.2) code hash.

## Install

From npm (it ships in the package [`@erhantrk/zeroinit`](https://www.npmjs.com/package/@erhantrk/zeroinit) as the `zeroinit-mcp` command; Node 22 or newer, no accounts or keys needed):

```bash
claude mcp add zeroinit -- npx -y -p @erhantrk/zeroinit zeroinit-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zeroinit": {
      "command": "npx",
      "args": ["-y", "-p", "@erhantrk/zeroinit", "zeroinit-mcp"]
    }
  }
}
```

From a clone of [the repo](https://github.com/erhantrk/zeroinit) instead: the package is one bundled file with no dependencies, committed as `mcp/dist/zeroinit-mcp.mjs`. Rebuild it with `npm ci --include=dev` once and then `npm run build:mcp`, and point the client at it: `claude mcp add zeroinit -- node /path/to/zeroinit-mcp.mjs`.

Optional environment, the same variables as the CLI (`.env.example`): `ZI_RPC_URL`, `ZI_CODE_HASH`, `ZI_TUSDC_ACCOUNT`, `ZI_SCHEME`. Signing keys (`ZI_PAYER_KEY` and friends) are never used by this server.

## Limits

- Testnet only. The token is a mock (tUSDC) with no value. Not audited.
- Issuing sends no transaction because the pay address is computed from the terms. The account does not exist until the payer's transaction creates it, so a status of `NONEXISTENT` means "not paid yet", not "wrong address".
- Token invoices: issuing is free, paying is not just one transaction, because the pay address must be registered on the token first (about 0.00125 NEAR, by the merchant, the payer or anyone).
- A plain transfer to a NEAR invoice that is smaller than the price is not refunded (it stays parked); see [docs/LIMITS.md](https://github.com/erhantrk/zeroinit/blob/main/docs/LIMITS.md).
- The status of an invoice reflects the final block of the RPC you configured. This server trusts that RPC for liveness, but verifies the document and the on-chain contract hash itself.
- Tests: `node --test test/mcp.test.ts` (fake RPC, no real network; one test builds the bundle, copies it alone into an empty directory and talks to it over stdio).
