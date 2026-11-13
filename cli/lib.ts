// Library entry of the npm package `zeroinit`: the same code the CLI and the MCP server use.
export { createInvoiceDoc, checkDoc, docProblem, onchainProblem, termsFromDoc, termsMatchOnchain, randomSalt, looksLikeInvoiceDoc,
  GRACE_DEFAULT_MS, GRACE_MIN_MS, GRACE_MAX_MS } from '../src/invoice.ts';
export { invoiceStateInit, invoiceStateBytes, deriveUniversalAccountId, isValidNearAccountId } from '../src/stateinit.ts';
export { verifyDoc } from '../src/verify.ts';
export { statusLine } from '../src/status.ts';
export { loadConfig, trustedCodeHash, DEPLOYED_CODE_HASH, KNOWN_DEPLOYMENTS, deploymentOf } from '../src/config.ts';
export { parseNear, formatNear } from '../src/bytes.ts';
export { checkCode, checkCodeMatches } from '../src/checkcode.ts';
