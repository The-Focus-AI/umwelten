/**
 * Re-export shim. The implementation moved to ./gaia-tools/ (one
 * file per domain) in Wave G. This file exists so the established
 * import path (`./gaia-tools.js`) keeps working for `gaia.ts`,
 * `routes.ts`, the tests, and the index barrel.
 */

export type {
	GaiaToolsContext,
	AuditResult,
	AuditSummary,
	StandardsAuditContext,
} from "./gaia-tools/index.js";
export {
	createGaiaToolSet,
	entryToEndpoint,
	buildSeedFiles,
	runStandardsAudit,
	STANDARDS_AUDIT_MSG,
} from "./gaia-tools/index.js";
