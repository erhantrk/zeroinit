# @erhantrk/zeroinit

The command line and library of [ZeroInit](https://github.com/erhantrk/zeroinit): every invoice gets its own NEAR address, computed from the invoice terms, so issuing an invoice sends no transaction. The payer's one transaction creates the account, pays the merchant and sets the tax aside.

**NEAR testnet only. Mock token only. Not audited.** Site: <https://zeroinit.vercel.app>

## Try it, no keys needed

Node 22 or newer. The package has no dependencies; the recorded run of the current contract (v3.3) and its invoices ship with it.

```bash
npx @erhantrk/zeroinit verify INV-1111-V33-A               # read-only live check over testnet RPC: every line PASS, ends INFO status=PAID
npx @erhantrk/zeroinit replay fixtures/v33/demo-run.json   # the recorded live run, replayed offline: every line PASS
npx @erhantrk/zeroinit status INV-1111-V33-A               # the live state of that invoice
npx @erhantrk/zeroinit invoice new --id TEST-1 --merchant example-zi-merchant.testnet --tax-vault example-zi-taxvault.testnet \
    --tax-bps 800 --amount 0.1 --expires-in 2h --offline    # issues an invoice: no transaction, writes ./invoices/TEST-1.json
```

`npx @erhantrk/zeroinit` alone prints the command list. Installed globally (`npm i -g @erhantrk/zeroinit`) the commands are `zeroinit` and `zi`.

## Paying, sweeping and the local dashboard

These sign transactions, so they need your own testnet accounts in the environment (`ZI_PAYER_ACCOUNT`, `ZI_PAYER_KEY`, `ZI_SWEEPER_ACCOUNT`, `ZI_SWEEPER_KEY`). The walkthrough is [docs/RUN-ON-TESTNET.md](https://github.com/erhantrk/zeroinit/blob/main/docs/RUN-ON-TESTNET.md).

```bash
npx @erhantrk/zeroinit pay TEST-1
npx @erhantrk/zeroinit serve --port 8787     # the local dashboard; open the OPEN address it prints
```

## Library

The same code the CLI uses, as plain JavaScript (no type declarations in this version):

```js
import { createInvoiceDoc, checkDoc, DEPLOYED_CODE_HASH, parseNear, randomSalt, GRACE_DEFAULT_MS } from '@erhantrk/zeroinit';

const doc = createInvoiceDoc('0u', DEPLOYED_CODE_HASH, {
  invoice_id: 'TEST-1', merchant: 'example-zi-merchant.testnet', tax_vault: 'example-zi-taxvault.testnet', tax_bps: 800,
  amount: parseNear('0.1'), expires_at_ms: BigInt(Date.now() + 7_200_000), salt: randomSalt(),
  layout: 3, grace_ms: GRACE_DEFAULT_MS, token: null,
});
console.log(doc.account_id);                        // the 0u… pay address; nothing was sent to the chain
console.log(checkDoc(doc, DEPLOYED_CODE_HASH));     // re-derives the address from the terms
```

## MCP server for AI agents

The package also installs `zeroinit-mcp`, an MCP server with `issue_invoice`, `invoice_status` and `verify_invoice`. It is read-only: it never signs, never reads a key and never sends a transaction.

```bash
claude mcp add zeroinit -- npx -y -p @erhantrk/zeroinit zeroinit-mcp
```

Tool details: [mcp/README.md](https://github.com/erhantrk/zeroinit/blob/main/mcp/README.md).

## Limits

Testnet only; the token is a mock with no value; the reviews were AI reviews, not an audit. The full list is in [docs/LIMITS.md](https://github.com/erhantrk/zeroinit/blob/main/docs/LIMITS.md).

MIT.
