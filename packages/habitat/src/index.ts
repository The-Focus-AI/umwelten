/**
 * @umwelten/habitat — Agent container runtime.
 *
 * Habitats, agents, tools, sessions, Gaia orchestrator, and container serving.
 */

// ── Habitat core ────────────────────────────────────────────────────────
export { Habitat } from "./habitat.js";

// ── CLI subcommand wiring (consumed by @umwelten/cli) ───────────────────
export { registerSessionsHabitatCommands } from "./cli/sessions-habitat.js";
export { serveHabitat } from "./serve.js";
export type { ServeMode, ServeOptions, ServedHabitat } from "./serve.js";
export { getHabitatSlashCommands } from "./slash-commands.js";
export type {
	SlashCommand,
	SlashCommandContext,
} from "./slash-commands.js";

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
	CapabilityHint,
	CapabilityGap,
	AgentSurface,
	ScopeTemplate,
	HabitatCommands,
	HabitatSessionMetadata,
	HabitatSessionType,
	OnboardingResult,
	RequiredSecret,
} from "./types.js";

// ── Agent identity / vaults ─────────────────────────────────────────────
// Vault classes (InlineVault/HabitatVault/OnePasswordVault) are internals;
// consumers should call `habitat.getVaultForAgent(id)` instead of instantiating.
export type { AgentVault } from "./identity/vault.js";

export { HabitatAgent, buildAgentStimulus } from "./habitat-agent.js";
export { getAgentMemoryPath } from "./agent-paths.js";

// ── Dialogue participants (agent-to-agent conversations) ────────────────
export {
	createHabitatAgentParticipant,
	participantFromHabitatAgent,
	cloneStimulus,
} from "./dialogue/habitat-agent-participant.js";
export type { DialogueAgentHost } from "./dialogue/habitat-agent-participant.js";

// ── Claude SDK runner ───────────────────────────────────────────────────
export { runClaudeSDK } from "./claude-sdk-runner.js";
export type {
	ClaudeSDKRunnerOptions,
	ClaudeSDKResult,
	ClaudeSDKProgress,
} from "./claude-sdk-runner.js";

// ── pi runner ───────────────────────────────────────────────────────────
export {
	runPi,
	createPiRuntimeRunner,
	piNativeSessionPath,
	piProjectDirName,
	piSessionFileName,
} from "./pi-runner.js";
export type {
	PiRunnerOptions,
	PiRunResult,
	PiProgress,
} from "./pi-runner.js";

// ── Config-declared CLI runtimes (codex, opencode, anything via mise) ───
export {
	runCliAgent,
	createCliRuntimeRunner,
	buildConfiguredRuntimeRunners,
	resolveRuntimeSpec,
	buildRuntimeEnv,
	buildInvocation,
	materializeCredentialFiles,
	findCodexSessionPath,
	RUNTIME_PRESETS,
} from "./cli-runner.js";
export type {
	CliRunOptions,
	CliRunResult,
	CliProgress,
	RuntimeSecretSource,
	RuntimeConfigSource,
} from "./cli-runner.js";

// ── Tool sets ───────────────────────────────────────────────────────────
export type { ToolSet } from "./tool-sets.js";
export {
	selectEnabledToolSets,
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
	remoteAgentToolSet,
} from "./tool-sets.js";

// ── Session management ──────────────────────────────────────────────────
export { HabitatSessionManager } from "./session-manager.js";
export type { SessionManagerSessionOptions } from "./session-manager.js";

// ── Context retrieval (A2A contextId → Source Session) ──────────────────
export { resolveContextSession } from "./context-resolver.js";
export type { ResolvedContext, NativeSessionRef } from "./context-resolver.js";

// ── Discord ─────────────────────────────────────────────────────────────
// Discord channel → agent routing was unified with the platform-agnostic
// bridge/routing.ts in Wave E. Use loadRouting / saveRouting / setChannelRoute
// / peekExactChannelBinding / setChannelInfoMessageId from ./bridge/routing.js,
// and the ChannelRuntimeMode / RouteResolution / RoutingConfig / ChannelBinding
// types from ./bridge/types.js. Existing `discord.json` files are still read as
// a fallback by loadRouting, so no data migration is required.
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

// ── Re-export MCP serve from @umwelten/protocols ───────────────────────────
export {
	createMcpServer,
	NeonStore,
	getPublicBaseUrl,
} from "@umwelten/protocols";
export type {
	McpHttpServer,
	UpstreamOAuthProvider,
	UpstreamTokens,
	McpToolRegistrar,
	McpServeConfig,
	McpServeStore,
} from "@umwelten/protocols";

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

// ── Gaia orchestrator (lives in tools/gaia/) ────────────────────────────
// Public surface: just the factory + types. Internals (registry/vault/docker/
// catalog/resolver/tool set/route handler) live behind `Gaia.start()` and are
// not exported.
export { Gaia } from "./tools/gaia/gaia.js";
export type { GaiaStartOptions, StartedGaia } from "./tools/gaia/gaia.js";
export type {
	GaiaHabitatEntry,
	GaiaRegistry,
	GaiaOrchestratorOptions,
} from "./tools/gaia/index.js";

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
