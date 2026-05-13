/**
 * Gaia Orchestrator — manages multiple habitat containers.
 */

export { Gaia } from "./gaia.js";
export type { GaiaStartOptions, StartedGaia } from "./gaia.js";

export type {
	GaiaHabitatEntry,
	GaiaRegistry,
	GaiaHabitatWithStatus,
	ContainerStatus,
	CreateHabitatOptions,
	GaiaOrchestratorOptions,
	CredentialEntry,
	CredentialStatus,
} from "./types.js";
export type { CapabilityBinding } from "../../types.js";

export { GaiaRegistryManager } from "./registry.js";
export { GaiaSecretVault } from "./secrets.js";
export { CredentialCatalog } from "./credential-catalog.js";
export { CapabilityResolver } from "./capability-resolver.js";
export {
	CredentialAuditLogger,
	credentialEntry,
	bindingEntry,
} from "./credential-audit.js";
export type { AuditEntry, AuditOperation } from "./credential-audit.js";
export type { ResolverResult } from "./capability-resolver.js";
export { DockerManager } from "./docker.js";
export { proxyRequest, fetchFromContainer } from "./proxy.js";
export {
	createGaiaToolSet,
	buildSeedFiles,
	runStandardsAudit,
	entryToEndpoint,
	STANDARDS_AUDIT_MSG,
} from "./gaia-tools.js";
export type {
	GaiaToolsContext,
	StandardsAuditContext,
	AuditResult,
	AuditSummary,
} from "./gaia-tools.js";
export { handleGaiaRoute } from "./routes.js";
export type { GaiaRouteContext } from "./routes.js";
export {
	seedOrgReadonly,
	orgReadonlyBindings,
	ORG_READONLY_AGENT_ID,
	ORG_READONLY_TEMPLATE_ID,
	ORG_READONLY_TOKENS,
	STANDARDS_AGENT_ID,
	seedStandardsAgent,
} from "./gaia-seed.js";
export {
	FnoxResolver,
	FNOX_TEMPLATE,
	BOOTSTRAP_TOKEN_ENV_VARS,
} from "./fnox.js";
export type {
	FnoxResolutionResult,
	FnoxMode,
	BootstrapToken,
} from "./fnox.js";
