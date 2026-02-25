/**
 * Habitat Bridge System
 *
 * Provides persistent agent containers with MCP-based communication.
 * Containers are built by dag.llm() (reads repo, picks base image, installs deps)
 * and supervised with automatic health monitoring and rebuild on failure.
 */

export { BridgeAgent, BridgeAgentConfig, BridgeAgentState, SavedProvisioning } from "./agent.js";
export {
  BridgeLifecycle,
  BridgeProvisioning,
  BridgeInstance,
} from "./lifecycle.js";
export {
  HabitatBridgeClient,
  BridgeConnectionOptions,
  BridgeToolResult,
  BridgeHealth,
} from "./client.js";
export { BridgeSupervisor, SupervisorConfig } from "./supervisor.js";
export { buildContainerFromRepo, buildContainerWithLLM } from "./container-builder.js";
export type { SupervisorState, SupervisorStatus, BridgeState } from "./state.js";
