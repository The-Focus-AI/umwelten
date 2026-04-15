/**
 * Habitat module: the central system for an agent.
 */

export { Habitat } from "./habitat.js";

export type {
  HabitatConfig,
  HabitatOptions,
  AgentEntry,
  AgentMCPStatus,
  HabitatCommands,
  HabitatSessionMetadata,
  HabitatSessionType,
  OnboardingResult,
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
  fileToolSet,
  timeToolSet,
  urlToolSet,
  agentToolSet,
  sessionToolSet,
  externalInteractionToolSet,
  agentRunnerToolSet,
  secretsToolSet,
  searchToolSet,
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

export { AgentDiscovery, isMCPServerRunning } from "./agent-discovery.js";
export type {
  DiscoveredAgent,
  AgentDiscoveryOptions,
} from "./agent-discovery.js";
