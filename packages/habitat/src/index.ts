/**
 * @umwelten/habitat — Agent container runtime.
 *
 * Habitats, agents, tools, sessions, Gaia orchestrator, and container serving.
 */

// ── Habitat core ────────────────────────────────────────────────────────
export { Habitat } from "./habitat.js";

export type {
	AgentHost,
	HabitatConfig,
	HabitatOptions,
	CapabilityBinding,
	AgentEntry,
	AgentKind,
	AgentIdentity,
	AgentScope,
	AgentVaultRef,
	AgentRequirements,
	AgentSurface,
	ScopeTemplate,
	HabitatCommands,
	HabitatSessionMetadata,
	HabitatSessionType,
	OnboardingResult,
	RequiredSecret,
} from "./types.js";

// ── Agent identity / vaults ─────────────────────────────────────────────
export {
	InlineVault,
	HabitatVault,
	OnePasswordVault,
} from "./identity/vault.js";
export type { AgentVault } from "./identity/vault.js";

export { HabitatAgent, buildAgentStimulus } from "./habitat-agent.js";
export { getAgentMemoryPath } from "./agent-paths.js";

// ── Claude SDK runner ───────────────────────────────────────────────────
export { runClaudeSDK } from "./claude-sdk-runner.js";
export type {
	ClaudeSDKRunnerOptions,
	ClaudeSDKResult,
	ClaudeSDKProgress,
} from "./claude-sdk-runner.js";

// ── Tool sets ───────────────────────────────────────────────────────────
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

// ── Session management ──────────────────────────────────────────────────
export { HabitatSessionManager } from "./session-manager.js";
export type { SessionManagerSessionOptions } from "./session-manager.js";

// ── Discord routing ─────────────────────────────────────────────────────
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

// ── Transcript ──────────────────────────────────────────────────────────
export { coreMessagesToJSONL, writeSessionTranscript } from "./transcript.js";

// ── Re-export session-record types from @umwelten/core ──────────────────
export type {
	SessionHandle,
	LearningKind,
	LearningRecord,
	CompactionEventV1,
} from "@umwelten/core";
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
} from "@umwelten/core";

// ── Stimulus loading ────────────────────────────────────────────────────
export { loadStimulusOptionsFromWorkDir } from "./load-prompts.js";

// ── Re-export MCP serve from @umwelten/server ───────────────────────────
export {
	createMcpServer,
	NeonStore,
	getPublicBaseUrl,
} from "@umwelten/server";
export type {
	McpHttpServer,
	UpstreamOAuthProvider,
	UpstreamTokens,
	McpToolRegistrar,
	McpServeConfig,
	McpServeStore,
} from "@umwelten/server";

// ── MCP local server ────────────────────────────────────────────────────
export { startHabitatMcpServer } from "./mcp-local-server.js";
export type {
	HabitatMcpServerOptions,
	StartedHabitatMcpServer,
} from "./mcp-local-server.js";

// ── Container server ────────────────────────────────────────────────────
export { startContainerServer } from "./container-server.js";
export type {
	ContainerServerOptions,
	StartedContainerServer,
} from "./container-server.js";

// ── A2A handler ─────────────────────────────────────────────────────────
export {
	createA2AHandler,
	buildAgentCard,
	HabitatAgentExecutor,
} from "./a2a-handler.js";
export type {
	A2AHandler,
	A2AHandlerOptions,
	AgentCardOptions,
} from "./a2a-handler.js";

// ── Gaia orchestrator ───────────────────────────────────────────────────
export {
	GaiaRegistryManager,
	GaiaSecretVault,
	DockerManager,
	CredentialCatalog,
	CapabilityResolver,
	createGaiaToolSet,
	handleGaiaRoute,
} from "./gaia/index.js";
export type {
	GaiaHabitatEntry,
	GaiaRegistry,
	GaiaOrchestratorOptions,
	GaiaToolsContext,
	GaiaRouteContext,
	CredentialEntry,
	CredentialStatus,
	ResolverResult,
} from "./gaia/index.js";

// ── Web server / adapter ────────────────────────────────────────────────
export {
	startWebServer,
	WebAdapter,
	UiMessageStream,
	devAuth,
	defaultRoutes,
} from "./web/index.js";
export type {
	AuthProvider,
	UserContext,
	RouteHandler,
	RouteContext,
	WebServerConfig,
	StartedWebServer,
} from "./web/index.js";

// ── ChannelBridge (unified adapter layer) ────────────────────────────────
export { ChannelBridge } from "./bridge/channel-bridge.js";
export type {
	ChannelMessage,
	ChannelAttachment,
	BridgeEventHandlers,
	BridgeResult,
	ChannelBridgeOptions,
	ChannelBinding,
	ChannelRuntimeMode,
	RoutingConfig,
	RouteResolution,
} from "./bridge/types.js";
export {
	loadRouting,
	saveRouting,
	resolveChannelRoute,
	routeSignature,
	setChannelRoute,
} from "./bridge/routing.js";
