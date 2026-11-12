// The MCP server (mcp/): tool list, issuing reproduces the recorded and the frozen ids, refused inputs, status and verify against a fake RPC,
// and the single-file bundle started alone over stdio. No real network. Run: node --test test/mcp.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { loadConfig } from '../src/config.ts';
import { createServer } from '../mcp/server.ts';
import { issueInvoice, invoiceStatus, verifyInvoice, InputError } from '../mcp/tools.ts';
import { makeDoc, makeTokenDoc, fakeRpc, handlers, onchainInvoice, DEPLOYED, V3, V2 } from './helpers.ts';

process.env.ZI_RPC_BACKOFF_MS = '1';
const TOKEN = 'tusdc.example.testnet';
const cfg = (env: Record<string, string> = {}) => loadConfig({ ZI_TUSDC_ACCOUNT: TOKEN, ...env });
const readDoc = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

async function connect(c = cfg()) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(c).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text as string, data: r.structuredContent as any };
};

const RECORDED = { merchant: 'sm1110-zi3-sweeper.testnet', tax_vault: 'sm1110-zi3-taxvault.testnet', tax_bps: 800, amount: '1', invoice_number: 'INV-1111-V32R-A',
  expires_at: '2026-11-12T15:25:41.094Z', salt: '2503984667641585463', offline: true };
const RECORDED_NOW = Date.parse('2026-11-12T13:25:41.406Z');

test('tool list: the three read-only tools', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['invoice_status', 'issue_invoice', 'verify_invoice']);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true);
});

test('issue_invoice reproduces the recorded v3.2r invoice byte for byte (same id, same fields, same layout)', async () => {
  const r = await issueInvoice(cfg(), RECORDED, RECORDED_NOW) as any;
  assert.deepEqual(r.invoice, readDoc('invoices/v32r/INV-1111-V32R-A.json'));
  assert.equal(r.pay_address, '0u7hdnprw7z1gfz4b6qj8pn683cnhwp4ges18hfbsk03nmdees4ppg');
  assert.equal(r.invoice.format, 'zeroinit-invoice/2');
  assert.equal(r.invoice.code_hash, DEPLOYED);
  assert.equal(r.transaction_sent, false);
  assert.match(r.cost, /no transaction/i);
  assert.equal(r.pay_instructions.one_transaction.actions[0].UniversalStateInit.raw_state_init_hex, r.invoice.raw_state_init_hex);
  assert.ok(r.pay_instructions.plain_transfer);
});

test('issue_invoice reproduces the frozen SPEC example id (v1 layout, code hash 0x11 repeated)', async () => {
  const r = await issueInvoice(cfg({ ZI_CODE_HASH: '29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2' }),
    { merchant: 'zi-merchant.testnet', tax_vault: 'zi-taxvault.testnet', tax_bps: 800, amount: '1', invoice_number: 'INV-0001', expires_at: '2026-11-15T00:00:00.000Z', salt: '42', offline: true },
    Date.parse('2026-11-08T21:29:31.788Z')) as any;
  assert.deepEqual(r.invoice, readDoc('invoices/examples/INV-0001.json'));
  assert.equal(r.pay_address, '0u6q65zr4tx168kat1mjv6rszh8m8jkq5afzcv72w608dd9jsaa3j0');
  assert.ok(r.warnings.some((w: string) => /not a known ZeroInit deployment/.test(w)));
});

test('issue_invoice for a token: storage_deposit registration is part of the pay instructions', async () => {
  const r = await issueInvoice(cfg(), { ...RECORDED, asset: 'tUSDC', amount: '1.5', invoice_number: 'TOK-1', salt: '7' }, RECORDED_NOW) as any;
  assert.deepEqual(r.invoice.asset, { kind: 'ft', contract: TOKEN, symbol: 'tUSDC', decimals: 6 });
  assert.equal(r.invoice.amount_raw, '1500000');
  assert.equal(r.pay_instructions.step_1_register_once.action.FunctionCall.method_name, 'storage_deposit');
  assert.equal(r.pay_instructions.step_1_register_once.action.FunctionCall.args.account_id, r.pay_address);
  assert.equal(r.pay_instructions.plain_transfer, undefined);
});

test('issue_invoice refuses bad input', async () => {
  const bad = async (over: Record<string, unknown>, re: RegExp, c = cfg()) =>
    assert.rejects(issueInvoice(c, { ...RECORDED, ...over } as any, RECORDED_NOW), (e: unknown) => e instanceof InputError && re.test(e.message));
  await bad({ merchant: 'alice.near' }, /not a testnet account/);
  await bad({ tax_vault: 'alice.near' }, /not a testnet account/);
  await bad({ asset: 'USDT' }, /unknown asset/);
  await bad({ asset: 'tUSDC' }, /only NEAR/, cfg({ ZI_TUSDC_ACCOUNT: '' }));
  await bad({ amount: '1e3' }, /bad amount/);
  await bad({ amount: '0' }, /amount must be > 0/);
  await bad({ asset: 'tUSDC', amount: '0.0000001' }, /more than 6 decimals/);
  await bad({ invoice_number: 'has space' }, /invoice_id/);
  await bad({ tax_bps: 10001 }, /tax_bps/);
  await bad({ expires_at: '2026-11-01T00:00:00Z' }, /future/);
  await bad({ salt: '-1' }, /salt/);
  await bad({ payout_grace_ms: 5 }, /payout_grace_ms/);
  await bad({ tax_bps: undefined }, /tax_vault needs tax_bps/);
  await bad({}, /historical|history/, cfg({ ZI_CODE_HASH: V2 }));
  await bad({}, /history/, cfg({ ZI_CODE_HASH: V3 }));
  assert.throws(() => loadConfig({ ZI_NETWORK: 'mainnet' }), /testnet/);
});

test('issue_invoice over MCP: a refusal is an MCP error, success carries structured content, nothing is sent', async () => {
  const client = await connect();
  const bad = await call(client, 'issue_invoice', { merchant: 'alice.near', amount: '1', invoice_number: 'X', offline: true });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /^REFUSED:.*testnet/);
  const ok = await call(client, 'issue_invoice', { merchant: 'm.testnet', tax_vault: 't.testnet', tax_bps: 800, amount: '2', invoice_number: 'MCP-1', expires_in: '2h', offline: true });
  assert.equal(ok.isError, false);
  assert.match(ok.data.pay_address, /^0u[0-9a-z]{52}$/);
  assert.equal(ok.data.invoice.invoice_id, 'MCP-1');
  assert.ok(ok.data.warnings.some((w: string) => /offline/.test(w)));
});

test('issue_invoice online checks that merchant and tax vault exist (fake RPC), no transaction is sent', async () => {
  const doc = makeDoc();
  const rpc = await fakeRpc(handlers(doc, { invoice: null }));
  try {
    // the fake RPC answers UNKNOWN_ACCOUNT for every account: the merchant "does not exist"
    const c = cfg({ ZI_RPC_URL: rpc.url });
    await assert.rejects(issueInvoice(c, { ...RECORDED, offline: false }, RECORDED_NOW), /does not exist on testnet.*offline: true/);
    assert.ok(rpc.calls.every((x) => x.method !== 'send_tx'));
    const live = await fakeRpc({ ...handlers(doc, { invoice: onchainInvoice(doc) }) });
    try {
      const r = await issueInvoice(cfg({ ZI_RPC_URL: live.url }), { ...RECORDED, offline: false }, RECORDED_NOW) as any;
      assert.match(r.pay_address, /^0u[0-9a-z]{52}$/);
      assert.equal(r.warnings.length, 0);
      assert.ok(live.calls.every((x) => x.method !== 'send_tx'));
    } finally { await live.close(); }
  } finally { await rpc.close(); }
});

test('invoice_status: NONEXISTENT, FUNDED_NOT_MATERIALIZED, OPEN, PAID (fake RPC)', async () => {
  const doc = makeDoc();
  const run = async (ch: any, args: Record<string, unknown> = { invoice: doc }) => {
    const rpc = await fakeRpc(handlers(doc, ch));
    try { return await invoiceStatus(cfg({ ZI_RPC_URL: rpc.url }), args as any) as any; } finally { await rpc.close(); }
  };
  let r = await run({ invoice: null });
  assert.equal(r.state, 'NONEXISTENT'); assert.equal(r.ok, true);
  assert.match(r.explorer.account, new RegExp(`/address/${doc.account_id}$`));
  r = await run({ invoice: null, uninitialized: true });
  assert.equal(r.state, 'FUNDED_NOT_MATERIALIZED');
  r = await run({ invoice: onchainInvoice(doc) });
  assert.equal(r.state, 'OPEN');
  r = await run({ invoice: onchainInvoice(doc, { status: 'PAID', paid_by: 'payer.testnet', paid_amount: '1000000000000000000000000', tax_amount: '80000000000000000000000' }) });
  assert.equal(r.state, 'PAID'); assert.equal(r.detail.invoice.paid_by, 'payer.testnet'); assert.match(r.summary, /status=PAID/);
  r = await run({ invoice: onchainInvoice(doc, { status: 'PAID' }) }, { account_id: doc.account_id });
  assert.equal(r.state, 'PAID'); assert.match(r.note, /UNVERIFIED/);
  r = await run({ invoice: null }, { account_id: doc.account_id });
  assert.equal(r.state, 'NONEXISTENT');
});

test('invoice_status: a forged document is UNVERIFIED and borrows no state; a wrong-code account is UNVERIFIED', async () => {
  const doc = makeDoc();
  const forged = { ...doc, amount_raw: '5', amount_display: '0.000000000000000000000005' };
  let rpc = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc, { status: 'PAID' }) }));
  try {
    const r = await invoiceStatus(cfg({ ZI_RPC_URL: rpc.url }), { invoice: forged as any }) as any;
    assert.equal(r.state, 'UNVERIFIED'); assert.equal(r.ok, false);
    assert.ok(rpc.calls.every((c) => c.method !== 'query' || c.params.request_type !== 'call_function'));
  } finally { await rpc.close(); }
  rpc = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc), hash: 'someotherhash' }));
  try { assert.equal(((await invoiceStatus(cfg({ ZI_RPC_URL: rpc.url }), { invoice: doc }) as any)).state, 'UNVERIFIED'); } finally { await rpc.close(); }
});

test('invoice_status: network errors and a non-testnet RPC come back as data, never thrown', async () => {
  const doc = makeDoc();
  const dead = await fakeRpc({}); const url = dead.url; await dead.close();
  const r = await invoiceStatus(cfg({ ZI_RPC_URL: url }), { invoice: doc }) as any;
  assert.equal(r.state, 'UNKNOWN'); assert.equal(r.ok, false); assert.match(r.network_error, /RPC request to .* failed/);
  const mainnetLike = await fakeRpc(handlers(doc, { invoice: null, chainId: 'mainnet' }));
  try {
    const m = await invoiceStatus(cfg({ ZI_RPC_URL: mainnetLike.url }), { invoice: doc }) as any;
    assert.equal(m.state, 'UNKNOWN'); assert.match(m.network_error, /expected testnet/);
  } finally { await mainnetLike.close(); }
  const client = await connect(cfg({ ZI_RPC_URL: url }));
  const viaMcp = await call(client, 'invoice_status', { invoice: doc });
  assert.equal(viaMcp.isError, false); assert.equal(viaMcp.data.state, 'UNKNOWN');
});

test('invoice_status refuses missing / both / odd inputs', async () => {
  const client = await connect();
  for (const args of [{}, { account_id: 'a.testnet', invoice: makeDoc() }, { account_id: 'https://evil/x' }]) assert.equal((await call(client, 'invoice_status', args)).isError, true);
});

test('invoice_status for a token invoice reports the parked balance (fake RPC)', async () => {
  const doc = makeTokenDoc();
  const rpc = await fakeRpc(handlers(doc, { invoice: null, ftBalance: '1500000' }));
  try {
    const r = await invoiceStatus(cfg({ ZI_RPC_URL: rpc.url }), { invoice: doc }) as any;
    assert.equal(r.state, 'NONEXISTENT'); assert.equal(r.detail.token_balance_raw, '1500000');
  } finally { await rpc.close(); }
});

test('verify_invoice: offline checks pass for a fresh doc and fail for a tampered one', async () => {
  const doc = makeDoc();
  let r = await verifyInvoice(cfg(), { invoice: doc, offline: true }) as any;
  assert.equal(r.ok, true); assert.equal(r.onchain, 'skipped');
  assert.deepEqual(r.checks.filter((c: any) => c.ok !== null).map((c: any) => c.name),
    ['code-hash-trusted', 'format-matches-deployment', 'id-from-terms', 'raw-from-terms', 'doc-fields-from-terms']);
  assert.ok(r.checks.every((c: any) => c.ok !== false));
  r = await verifyInvoice(cfg(), { invoice: { ...doc, merchant: 'evil.testnet' } as any, offline: true }) as any;
  assert.equal(r.ok, false); assert.equal(r.checks.find((c: any) => c.name === 'id-from-terms').ok, false);
  r = await verifyInvoice(cfg(), { invoice: { format: 'zeroinit-invoice/2', invoice_id: 'X', account_id: 'a' } as any, offline: true }) as any;
  assert.equal(r.ok, false);
  r = await verifyInvoice(cfg(), { invoice: { ...makeTokenDoc(), asset: undefined } as any, offline: true }) as any;
  assert.equal(r.ok, false);
});

test('verify_invoice: on-chain checks against a fake RPC, and an unreachable RPC is reported, not thrown', async () => {
  const doc = makeDoc();
  const rpc = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc) }));
  try {
    const r = await verifyInvoice(cfg({ ZI_RPC_URL: rpc.url }), { invoice: doc }) as any;
    assert.equal(r.ok, true); assert.equal(r.onchain, 'checked');
    for (const n of ['code-hash-onchain', 'terms-onchain', 'no-access-keys']) assert.equal(r.checks.find((c: any) => c.name === n)?.ok, true, n);
  } finally { await rpc.close(); }
  const bad = await fakeRpc(handlers(doc, { invoice: onchainInvoice(doc, { merchant: 'other.testnet' }) }));
  try { assert.equal(((await verifyInvoice(cfg({ ZI_RPC_URL: bad.url }), { invoice: doc }) as any)).ok, false); } finally { await bad.close(); }
  const dead = await fakeRpc({}); const url = dead.url; await dead.close();
  const u = await verifyInvoice(cfg({ ZI_RPC_URL: url }), { invoice: doc }) as any;
  assert.equal(u.onchain, 'unreachable'); assert.equal(u.offline_ok, true); assert.equal(u.ok, false); assert.match(u.network_error, /failed/);
});

test('the bundle is one self-contained file: started alone in an empty directory it lists the tools and issues an invoice over stdio', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'zi-mcp-')), 'zeroinit-mcp.mjs');
  await build({ entryPoints: ['mcp/main.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    banner: { js: "import { createRequire as __zi_cr } from 'node:module'; const require = __zi_cr(import.meta.url);" } });
  const empty = mkdtempSync(join(tmpdir(), 'zi-mcp-empty-'));
  copyFileSync(out, join(empty, 'zeroinit-mcp.mjs'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(empty, 'zeroinit-mcp.mjs')], cwd: empty, stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', ZI_TUSDC_ACCOUNT: TOKEN } });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['invoice_status', 'issue_invoice', 'verify_invoice']);
    const r: any = await client.callTool({ name: 'issue_invoice', arguments: { merchant: 'm.testnet', amount: '1', invoice_number: 'BUNDLE-1', offline: true } });
    assert.match(r.structuredContent.pay_address, /^0u/);
  } finally { await client.close(); }
});

test('the server refuses to start on a mainnet config', async () => {
  const code = await new Promise<number>((res) => {
    const p = spawn(process.execPath, ['mcp/main.ts'], { env: { PATH: process.env.PATH ?? '', ZI_NETWORK: 'mainnet' }, stdio: 'ignore' });
    p.on('close', (c) => res(c ?? -1));
  });
  assert.equal(code, 1);
});
