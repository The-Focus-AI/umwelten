/**
 * Gaia orchestrator ToolSet — composed from per-domain factories.
 *
 * Each domain file (./habitats.ts, ./secrets.ts, ./skills.ts,
 * ./credentials.ts, ./standards.ts) exports a `createXxxTools(ctx)`
 * factory returning a `Record<string, Tool>`. `createGaiaToolSet`
 * spreads them all into the single record that `tool-sets.ts`
 * registers on the Gaia habitat.
 *
 * Public surface (preserved from the pre-split gaia-tools.ts):
 * - `createGaiaToolSet(ctx)` — the ToolSet entry point.
 * - `GaiaToolsContext` — the context interface.
 * - `entryToEndpoint` — A2A endpoint adapter.
 * - `buildSeedFiles` — also used by `routes.ts` for REST handlers.
 * - `runStandardsAudit`, `STANDARDS_AUDIT_MSG`,
 *   `AuditResult`, `AuditSummary`, `StandardsAuditContext` —
 *   used by the standards audit REST route + tests.
 */

import type { ToolSet } from "../../../tool-sets.js";
import { type GaiaToolsContext } from "./context.js";
import { createHabitatLifecycleTools } from "./habitats.js";
import { createSecretsTools } from "./secrets.js";
import { createSkillsTools } from "./skills.js";
import { createCredentialsTools } from "./credentials.js";
import { createStandardsTools } from "./standards.js";
import { createModelDiscoveryTools } from "./models.js";

export type { GaiaToolsContext } from "./context.js";
export { entryToEndpoint } from "./context.js";
export { buildSeedFiles } from "./seed-files.js";
export {
	runStandardsAudit,
	STANDARDS_AUDIT_MSG,
	type AuditResult,
	type AuditSummary,
	type StandardsAuditContext,
} from "./standards-audit.js";

/** Create a ToolSet that adds Gaia orchestrator tools to a habitat. */
export function createGaiaToolSet(ctx: GaiaToolsContext): ToolSet {
	return {
		name: "gaia-orchestrator",
		description:
			"Manage multiple habitat containers — create, start, stop, query, and configure them via Docker. Manage the master secret vault and delegate tasks to running habitats via A2A.",
		createTools: () => ({
			...createHabitatLifecycleTools(ctx),
			...createSecretsTools(ctx),
			...createSkillsTools(ctx),
			...createCredentialsTools(ctx),
			...createStandardsTools(ctx),
			...createModelDiscoveryTools(ctx),
		}),
	};
}
