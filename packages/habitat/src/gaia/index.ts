/**
 * Gaia Orchestrator — manages multiple habitat containers.
 */

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
export type { CapabilityBinding } from "../types.js";

export { GaiaRegistryManager } from "./registry.js";
export { GaiaSecretVault } from "./secrets.js";
export { CredentialCatalog } from "./credential-catalog.js";
export { CapabilityResolver } from "./capability-resolver.js";
export type { ResolverResult } from "./capability-resolver.js";
export { DockerManager } from "./docker.js";
export { proxyRequest, fetchFromContainer } from "./proxy.js";
export { createGaiaToolSet, buildSeedFiles } from "./gaia-tools.js";
export type { GaiaToolsContext } from "./gaia-tools.js";
export { handleGaiaRoute } from "./routes.js";
export type { GaiaRouteContext } from "./routes.js";
export {
	seedOrgReadonly,
	orgReadonlyBindings,
	ORG_READONLY_AGENT_ID,
	ORG_READONLY_TEMPLATE_ID,
	ORG_READONLY_TOKENS,
} from "./gaia-seed.js";
