/**
 * Habitat module: the central system for an agent.
 */

export { Habitat } from "./habitat.js";

export type {
  AgentHost,
  HabitatConfig,
  HabitatOptions,
  AgentEntry,
  HabitatCommands,
  HabitatSessionMetadata,
  HabitatSessionType,
  OnboardingResult,
  RequiredSecret,
} from "./types.js";

export { HabitatAgent, buildAgentStimulus } from "./habitat-agent.js";
export { getAgentMemoryPath } from "./agent-paths.js";

export { runClaudeSDK } from "./claude-sdk-runner.js";
export type {
  ClaudeSDKRunnerOptions,
  ClaudeSDKResult,
  ClaudeSDKProgress,
} from "./claude-sdk-runner.js";

export type { ToolSet } from "./tool-sets.js";
export {
  standardToolSets,
  containerToolSets,
  managedContainerToolSets,
  fileToolSet,
  timeToolSet,
  urlToolSet,
  agentToolSet,
  sessionToolSet,
  externalInteractionToolSet,
  agentRunnerToolSet,
  secretsToolSet,
  searchToolSet,
  provisionToolSet,
  execToolSet,
  artifactToolSet,
} from "./tool-sets.js";

export { HabitatSessionManager } from "./session-manager.js";
export type { SessionManagerSessionOptions } from "./session-manager.js";

export {
  loadDiscordRouting,
  resolveDiscordChannelRoute,
  appendDiscordChannelRoute,
  setDiscordChannelRoute,
  discordRouteSignature,
  coerceDiscordChannelBinding,
  peekExactDiscordBinding,
  setDiscordChannelInfoMessageId,
  updateDiscordChannelRuntime,
} from "./discord-routing.js";
export type {
  DiscordRoutingConfig,
  DiscordRouteResolution,
  DiscordChannelRuntimeMode,
  DiscordChannelBinding,
} from "./discord-routing.js";

export { provisionDiscordAgentChannel } from "./discord-provision.js";
export type { DiscordProvisionOptions } from "./discord-provision.js";

export { coreMessagesToJSONL, writeSessionTranscript } from "./transcript.js";

export type {
  SessionHandle,
  LearningKind,
  LearningRecord,
  CompactionEventV1,
} from "../session-record/index.js";
export {
  FileLearningsStore,
  resolveHabitatSessionHandle,
  resolveClaudeCodeSessionHandle,
  listHabitatTranscriptReadPaths,
  compactHabitatTranscriptSegment,
  loadHabitatSessionTranscriptMessages,
  loadRecentHabitatTranscriptCoreMessages,
  buildHabitatIntrospectionContextMessages,
  LEARNING_KINDS,
  LEARNING_FILENAMES,
} from "../session-record/index.js";

export { loadStimulusOptionsFromWorkDir } from "./load-prompts.js";

// MCP server library — turn any upstream OAuth service into a hosted MCP server
export { createMcpServer } from "./mcp-serve/server.js";
export type { McpHttpServer } from "./mcp-serve/server.js";
export { NeonStore } from "./mcp-serve/neon-store.js";
export type {
  UpstreamOAuthProvider,
  UpstreamTokens,
  McpToolRegistrar,
  McpServeConfig,
  McpServeStore,
} from "./mcp-serve/types.js";
export { getPublicBaseUrl } from "./mcp-serve/public-url.js";

// Habitat MCP local server — expose habitat tools over Streamable HTTP (no OAuth)
export { startHabitatMcpServer } from "./mcp-local-server.js";
export type {
  HabitatMcpServerOptions,
  StartedHabitatMcpServer,
} from "./mcp-local-server.js";

// Unified container server — MCP + LLM chat + web UI + A2A on one port
export { startContainerServer } from "./container-server.js";
export type {
  ContainerServerOptions,
  StartedContainerServer,
} from "./container-server.js";

// A2A (Agent-to-Agent) protocol handler
export { createA2AHandler, buildAgentCard, HabitatAgentExecutor } from "./a2a-handler.js";
export type { A2AHandler, A2AHandlerOptions, AgentCardOptions } from "./a2a-handler.js";

// Gaia Orchestrator — manage multiple habitat containers
export { GaiaRegistryManager, GaiaSecretVault, DockerManager, createGaiaToolSet, handleGaiaRoute } from "./gaia/index.js";
export type {
  GaiaHabitatEntry,
  GaiaRegistry,
  GaiaOrchestratorOptions,
  GaiaToolsContext,
  GaiaRouteContext,
} from "./gaia/index.js";

