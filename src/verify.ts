// The `zi verify` checks (shared by the CLI and the MCP server): offline re-derivation, plus the on-chain checks unless `offline`.
import { formatNear } from './bytes.ts';
import { trustedCodeHash, pinForVerification, deploymentLabel, tokenBySymbol, type Config } from './config.ts';
import { checkNetwork, viewAccount, viewInvoice, rpcCall } from './rpc.ts';
import { checkDoc, termsMatchOnchain, isV3Doc, docToken, docUnit, type InvoiceDoc } from './invoice.ts';
import { ftBalanceOf, ftMetadata, formatUnits } from './ft.ts';

export async function verifyDoc(cfg: Config, doc: InvoiceDoc, offline: boolean): Promise<{ ok: boolean; lines: string[] }> {
    const trusted = pinForVerification(trustedCodeHash(cfg), doc.code_hash);   // v1/v2 history docs verify against their own hash (read-only); the rest against the trusted hash
    const c = checkDoc(doc, trusted, cfg.allowedTokens);
    const token = docToken(doc);
    const entry = token ? tokenBySymbol(cfg.allowedTokens, isV3Doc(doc) && doc.asset.kind === 'ft' ? doc.asset.symbol : '') : null;
    const tokenAllowed = token === null || (entry !== null && entry.accountId === token);
    const lines = [`${c.codeHashTrusted ? 'PASS' : 'FAIL'} code-hash-trusted ${doc.code_hash}${c.codeHashTrusted ? '' : ` (trusted ${trusted})`}`,
      `INFO deployment ${c.codeHashTrusted ? deploymentLabel(trusted) : 'none: the invoice uses a code hash that is not trusted'}`,
      `${c.formatMatchesDeployment ? 'PASS' : 'FAIL'} format-matches-deployment ${doc.format}`,
      `${c.idFromTerms ? 'PASS' : 'FAIL'} id-from-terms ${c.expectedId}`, `${c.rawFromTerms ? 'PASS' : 'FAIL'} raw-from-terms`,
      `${c.fieldsConsistent ? 'PASS' : 'FAIL'} doc-fields-from-terms`];
    if (token !== null) lines.push(`${tokenAllowed ? 'PASS' : 'FAIL'} token-allowed ${docUnit(doc)} ${token}${tokenAllowed ? '' : ' (set ZI_TUSDC_ACCOUNT / use a token on the allow-list)'}`);
    let ok = c.codeHashTrusted && c.formatMatchesDeployment && c.idFromTerms && c.rawFromTerms && c.fieldsConsistent && tokenAllowed;
    if (!offline) {
      await checkNetwork(cfg);
      const s = await viewAccount(cfg, doc.account_id);
      if (s.kind === 'INITIALIZED') {
        const codeOk = s.globalContractHash === trusted;   // the pinned hash, never the doc's own
        const inv = await viewInvoice(cfg, doc.account_id);
        const termsOk = termsMatchOnchain(doc, inv);
        const keys = await rpcCall(cfg, 'query', { request_type: 'view_access_key_list', finality: 'final', account_id: doc.account_id });
        const noKeys = !keys.error && Array.isArray(keys.result?.keys) && keys.result.keys.length === 0;
        lines.push(`${codeOk ? 'PASS' : 'FAIL'} code-hash-onchain ${s.globalContractHash}`, `${termsOk ? 'PASS' : 'FAIL'} terms-onchain`,
          `${noKeys ? 'PASS' : 'FAIL'} no-access-keys`, `INFO status=${inv.status}`);
        if (token !== null && entry) {
          try {
            const meta = await ftMetadata(cfg, token);
            const metaOk = meta.symbol === entry.symbol && meta.decimals === entry.decimals;
            lines.push(`${metaOk ? 'PASS' : 'FAIL'} token-metadata-onchain ${meta.symbol} ${meta.decimals}`);
            ok = ok && metaOk;
          } catch (e) {
            lines.push(`FAIL token-metadata-onchain ${e instanceof Error ? e.message : String(e)}`);
            ok = false;
          }
        }
        if (token !== null && entry) {
          const bal = await ftBalanceOf(cfg, token, doc.account_id);
          lines.push(`INFO token-balance ${formatUnits(bal, entry.decimals)} ${entry.symbol}`);
        }
        ok = ok && codeOk && termsOk && noKeys;
      } else {
        lines.push(`INFO state=${s.kind}`);
        if (token !== null && entry) {
          const bal = await ftBalanceOf(cfg, token, doc.account_id);
          lines.push(`INFO token-balance ${formatUnits(bal, entry.decimals)} ${entry.symbol}`);
        }
      }
    }
    return { ok, lines };
}
