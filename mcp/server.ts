// The ZeroInit MCP server: three read-only tools over stdio (see mcp/README.md). It never signs and never reads a key.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../src/config.ts';
import { issueInvoice, invoiceStatus, verifyInvoice, InputError } from './tools.ts';

export const SERVER_VERSION = '0.1.0';

const asText = (r: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], structuredContent: r });
const refuse = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `REFUSED: ${e instanceof Error ? e.message : String(e)}` }] });
async function run(f: () => Promise<Record<string, unknown>>) {
  try { return asText(await f()); } catch (e) { return refuse(e); }
}
const invoiceDoc = z.object({ format: z.string(), invoice_id: z.string(), account_id: z.string() }).passthrough()
  .describe('The invoice document exactly as issue_invoice returned it (the "invoice" field)');

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: 'zeroinit', version: SERVER_VERSION });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };

  server.registerTool('issue_invoice', {
    title: 'Issue a ZeroInit invoice',
    description: 'Issue a ZeroInit invoice on NEAR testnet. Returns the invoice document, its own NEAR pay address (a 0u... id derived from the terms) and the pay instructions. '
      + 'No transaction is sent and issuing costs nothing; the payer\'s one transaction later creates the account, pays the merchant and sets the tax aside. Testnet only; tokens: tUSDC (a mock) and NEAR.',
    inputSchema: {
      merchant: z.string().describe('Testnet account that receives the payment minus tax'),
      tax_vault: z.string().optional().describe('Testnet account that receives the tax share (default: the merchant, with tax_bps 0)'),
      amount: z.string().describe('Price in display units, e.g. "1" or "1.5" (NEAR, or tUSDC with up to 6 decimals)'),
      asset: z.string().optional().describe('NEAR (default) or tUSDC'),
      tax_bps: z.number().int().min(0).max(10000).optional().describe('Tax in basis points, 800 = 8%'),
      invoice_number: z.string().describe('Invoice id, 1-32 chars of A-Z a-z 0-9 _ -'),
      expires_in: z.string().optional().describe('30m, 24h or 7d (default 24h); ignored when expires_at is set'),
      expires_at: z.string().optional().describe('ISO 8601 expiry time'),
      payout_grace_ms: z.number().int().optional().describe('Grace after expiry before a late payment is released, 60000 to 31536000000 ms (default 7 days)'),
      salt: z.string().optional().describe('u64 as a decimal string (default random); the same terms and salt give the same address'),
      offline: z.boolean().optional().describe('Skip the testnet check that merchant and tax vault exist (and are registered on the token)'),
    },
    annotations: { ...readOnly, title: 'Issue a ZeroInit invoice' },
  }, (a) => run(() => issueInvoice(cfg, a)));

  server.registerTool('invoice_status', {
    title: 'Live status of an invoice',
    description: 'Live testnet state of an invoice account: NONEXISTENT (nothing happened yet), FUNDED_NOT_MATERIALIZED (money was sent but nobody has initialised the account), OPEN / PAID / refunded etc. as the contract reports. '
      + 'Pass the invoice document (checked against its terms) or just an account_id. A network problem is returned as data (state UNKNOWN), not as an error.',
    inputSchema: { invoice: invoiceDoc.optional(), account_id: z.string().optional().describe('A 0u... pay address or other testnet account (no terms check)') },
    annotations: { ...readOnly, title: 'Live status of an invoice' },
  }, (a) => run(() => invoiceStatus(cfg, a as any)));

  server.registerTool('verify_invoice', {
    title: 'Verify an invoice document',
    description: 'The checks of `zi verify`: re-derive the pay address and raw state init from the terms and the pinned code hash, check the token against the allow-list, and (unless offline) check the on-chain code hash, terms and absence of access keys. Returns each check with ok/detail.',
    inputSchema: { invoice: invoiceDoc, offline: z.boolean().optional().describe('Only the offline checks (default false: on-chain checks too when testnet is reachable)') },
    annotations: { ...readOnly, title: 'Verify an invoice document' },
  }, (a) => run(() => verifyInvoice(cfg, a as any)));

  return server;
}
