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
} from "./types.js";

export { GaiaRegistryManager } from "./registry.js";
export { GaiaSecretVault } from "./secrets.js";
export { DockerManager } from "./docker.js";
export { proxyRequest, fetchFromContainer } from "./proxy.js";
export { fetchAgentCard, sendA2AMessage, discoverHabitats } from "./a2a-client.js";
export type { AgentCardSummary, A2AMessageResponse } from "./a2a-client.js";
export { createGaiaToolSet, buildSeedFiles } from "./gaia-tools.js";
export type { GaiaToolsContext } from "./gaia-tools.js";
export { handleGaiaRoute } from "./routes.js";
export type { GaiaRouteContext } from "./routes.js";
