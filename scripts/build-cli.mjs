// Assembles the npm package `zeroinit` in cli/: the CLI and the library as bundled files (Node >= 22, no dependencies),
// plus the MCP server bundle, the dashboard page, the recorded v3.3 run and its invoices, so the keyless commands work from any directory.
import { build } from 'esbuild';
import { cpSync, rmSync, readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('cli/package.json', 'utf8')).version;
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'none', logLevel: 'info' };
for (const d of ['dist', 'web', 'invoices', 'fixtures']) rmSync(`cli/${d}`, { recursive: true, force: true });
await build({ ...common, entryPoints: ['cli/main.ts'], outfile: 'cli/dist/zeroinit.mjs', define: { __ZI_VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __zi_cr } from 'node:module'; const require = __zi_cr(import.meta.url);" } });
await build({ ...common, entryPoints: ['cli/lib.ts'], outfile: 'cli/dist/index.mjs' });
// The MCP server: the same single file `npm run build:mcp` writes and commits, installed as the `zeroinit-mcp` command.
cpSync('mcp/dist/zeroinit-mcp.mjs', 'cli/dist/zeroinit-mcp.mjs');
cpSync('web', 'cli/web', { recursive: true });
for (const d of ['v33', 'examples', 'demo']) cpSync(`invoices/${d}`, `cli/invoices/${d}`, { recursive: true });
cpSync('fixtures/v33', 'cli/fixtures/v33', { recursive: true });
cpSync('LICENSE', 'cli/LICENSE');
