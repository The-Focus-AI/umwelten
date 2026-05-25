/**
 * umwelten — Meta-package re-exporting all @umwelten/* packages.
 *
 * For new code, prefer importing from individual packages:
 *   import { Stimulus, Interaction } from '@umwelten/core';
 *   import { Habitat } from '@umwelten/habitat';
 *   import { EvalSuite } from '@umwelten/evaluation';
 */

// ── @umwelten/core ──────────────────────────────────────────────────────
export {
	// Cognition
	BaseModelRunner,
	SmartModelRunner,
	getAllModels,
	searchModels,
	findModelByIdAndProvider,
	buildRequestOptions,
	// Stimulus
	Stimulus,
	// Interaction
	Interaction,
	InteractionStore,
	// Providers
	getModel,
	getModelDetails,
	getModelProvider,
	getModelUrl,
	validateModel,
	registerProvider,
	getRegisteredProvider,
	listRegisteredProviders,
	BaseProvider,
	// Context
	estimateContextSize,
	getCompactionSegment,
	registerCompactionStrategy,
	getCompactionStrategy,
	listCompactionStrategies,
	serializeSegment,
	// Costs
	calculateCost,
	estimateCost,
	formatCostBreakdown,
	// Schema
	parseDSLSchema,
	toJSONSchema,
	loadZodSchema,
	convertZodToSchema,
	validateSchema,
	createValidator,
	coerceData,
	SchemaManager,
	schemaManager,
	parsedSchemaToZod,
	// Markdown
	fetchUrl,
	urlToMarkdown,
	parseFeed,
	// Session record
	FileLearningsStore,
	listHabitatTranscriptReadPaths,
	loadHabitatSessionTranscriptMessages,
	loadRecentHabitatTranscriptCoreMessages,
	buildHabitatIntrospectionContextMessages,
	resolveHabitatSessionHandle,
	resolveClaudeCodeSessionHandle,
	compactHabitatTranscriptSegment,
	writeSessionTranscript,
	coreMessagesToJSONL,
	LEARNING_KINDS,
	LEARNING_FILENAMES,
	// Stimulus tools & skills
	loadToolsFromDirectory,
	loadSkillsFromDirectory,
	loadSkillsFromGit,
	createSkillTool,
	SkillsRegistry,
	// Env
	loadEnv,
	findNearestEnvFile,
} from "@umwelten/core";

// Deep re-exports from @umwelten/core (not in barrel)
export { ClaudeCodeAdapter } from "@umwelten/core/interaction/adapters/claude-code-adapter.js";
export { CursorAdapter } from "@umwelten/core/interaction/adapters/cursor-adapter.js";
export {
	digestSession,
	digestProject,
	askAboutSession,
} from "@umwelten/core/interaction/analysis/session-digester.js";
export {
	messagesToBeats,
	formatBeatToolSummary,
} from "@umwelten/core/interaction/analysis/conversation-beats.js";
export {
	analyzeSession,
	analyzeSessionWithRetry,
	normalizedSessionToMarkdown,
} from "@umwelten/core/interaction/analysis/session-analyzer.js";
export {
	searchSessions,
	formatSearchResults,
	getTopTopics,
	getTopTools,
} from "@umwelten/core/interaction/analysis/session-search.js";

export type {
	NormalizedSession,
	NormalizedMessage,
	SessionSource,
} from "@umwelten/core/interaction/types/normalized-types.js";
export type { ConversationBeat } from "@umwelten/core/interaction/analysis/conversation-beats.js";

export type {
	ModelDetails,
	ModelRoute,
	ModelRunner,
	ModelResponse,
	ModelOptions,
	StreamObserver,
	StimulusOptions,
	CompactionInput,
	CompactionResult,
	CompactionStrategy,
	ContextSizeEstimate,
	CompactionSegment,
	TokenUsage,
	CostBreakdown,
	SessionRecordSource,
	LearningKind,
	LearningProvenance,
	LearningRecord,
	SessionHandle,
	CompactionEventV1,
} from "@umwelten/core";

// ── @umwelten/habitat ───────────────────────────────────────────────────
export {
	Habitat,
	Gaia,
	serveHabitat,
	HabitatAgent,
	buildAgentStimulus,
	getAgentMemoryPath,
	runClaudeSDK,
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
	HabitatSessionManager,
	provisionDiscordAgentChannel,
	loadStimulusOptionsFromWorkDir,
	startHabitatMcpServer,
	startContainerServer,
	createA2AHandler,
	buildAgentCard,
	HabitatAgentExecutor,
	startWebServer,
	WebAdapter,
	UiMessageStream,
	devAuth,
	defaultRoutes,
	ChannelBridge,
	loadRouting,
	saveRouting,
	resolveChannelRoute,
	routeSignature,
	setChannelRoute,
} from "@umwelten/habitat";

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
	ClaudeSDKRunnerOptions,
	ClaudeSDKResult,
	ClaudeSDKProgress,
	ToolSet,
	SessionManagerSessionOptions,
	DiscordProvisionOptions,
	HabitatMcpServerOptions,
	StartedHabitatMcpServer,
	ContainerServerOptions,
	StartedContainerServer,
	A2AHandler,
	A2AHandlerOptions,
	AgentCardOptions,
	GaiaHabitatEntry,
	GaiaRegistry,
	GaiaOrchestratorOptions,
	AuthProvider,
	UserContext,
	RouteHandler,
	RouteContext,
	WebServerConfig,
	StartedWebServer,
	ChannelMessage,
	ChannelAttachment,
	BridgeEventHandlers,
	BridgeResult,
	ChannelBridgeOptions,
	ChannelBinding,
	ChannelRuntimeMode,
	RoutingConfig,
	RouteResolution,
} from "@umwelten/habitat";

// ── @umwelten/protocols ────────────────────────────────────────────────────
export {
	createMcpServer,
	NeonStore,
	getPublicBaseUrl,
	hashToken,
	RemoteMcpClient,
	MCPClient,
	createMCPClient,
	createStdioConfig,
	MCPStimulusManager,
	createMCPStimulusManager,
	mcpToolToToolDefinition,
	fetchAgentCard,
	sendA2AMessage,
	createA2AServer,
} from "@umwelten/protocols";

export type {
	McpHttpServer,
	UpstreamOAuthProvider,
	UpstreamTokens,
	McpToolRegistrar,
	McpServeConfig,
	McpServeStore,
	OAuthClient,
	AuthSession,
	McpTokenRow,
	MCPStimulusConfig,
	MCPStimulusBaseConfig,
	MCPStimulusStdioConfig,
	MCPStimulusTransportWrapperConfig,
	TransportConfig,
	A2AEndpoint,
	AgentCardSummary,
	A2AMessageResponse,
	A2AServer,
	A2AServerOptions,
	AgentExecutor,
	RequestContext,
	ExecutionEventBus,
	AgentCard,
	AgentSkill,
} from "@umwelten/protocols";

// ── @umwelten/evaluation ────────────────────────────────────────────────
export {
	EvalSuite,
	PairwiseRanker,
	expectedScore,
	updateElo,
	buildStandings,
	allPairs,
	swissPairs,
	evaluationResultsToRankingEntries,
	loadSuite,
	findLatestRunDir,
	loadDimension,
	buildSuiteReport,
	buildNarrativeReport,
	Reporter,
} from "@umwelten/evaluation";

export {
	buildExploreBrowse,
	applyExploreFilter,
	loadDigest,
	saveDigest,
	getDigestPath,
} from "@umwelten/sessions";

export type {
	EvalSuiteConfig,
	EvalTask,
	VerifyTask,
	JudgeTask,
	VerifyResult,
	TaskResultRecord,
	RankingEntry,
	PairwiseResult,
	RankedModel,
	RankingOutput,
	PairwiseRankerConfig,
	EvalDimension,
	ModelScorecard,
	SuiteResult,
	DimensionScore,
	SuiteRunInfo,
	TaskResult,
	SuiteReportOptions,
	NarrativeReportOptions,
	Report,
	ReportSection,
	ReportType,
} from "@umwelten/evaluation";

export type {
	SessionBrowserEntry,
	ExplorationBrowserEntry,
	BuildBrowseOptions,
	DateWindow,
	StatusFilter,
	SourceFilter,
	FilterState,
	SessionSourceKind,
} from "@umwelten/sessions";
