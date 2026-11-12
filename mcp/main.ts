// Entry point: node mcp/main.ts (or the bundle mcp/dist/zeroinit-mcp.mjs). Talks MCP over stdio; logs to stderr only.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../src/config.ts';
import { createServer } from './server.ts';

try {
  const cfg = loadConfig();
  await createServer(cfg).connect(new StdioServerTransport());
  console.error(`zeroinit-mcp ready (testnet, rpc ${cfg.rpcUrl}); read-only, never signs`);
} catch (e) {
  console.error(`zeroinit-mcp failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
