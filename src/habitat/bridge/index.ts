/**
 * Habitat Bridge System
 *
 * Provides persistent agent containers with MCP-based communication.
 */

export { BridgeAgent, BridgeAgentConfig, BridgeAgentState, SavedProvisioning } from "./agent.js";
export { BridgeAnalyzer, AnalysisResult } from "./analyzer.js";
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
