// Bundles the MCP server into ONE self-contained file (no node_modules needed to run it; Node >= 22).
import { build } from 'esbuild';
await build({
  entryPoints: ['mcp/main.ts'], outfile: 'mcp/dist/zeroinit-mcp.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __zi_cr } from 'node:module'; const require = __zi_cr(import.meta.url);" },
  legalComments: 'none', logLevel: 'info',
});
