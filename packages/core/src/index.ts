/// <reference path="./types.d.ts" />
/**
 * @umwelten/core — Foundation LLM runtime.
 *
 * Cognition, stimulus, interaction, providers, and all foundation modules.
 */

// ── Cognition (model runners, types) ────────────────────────────────────
export type {
	ModelDetails,
	ModelRoute,
	ModelRunner,
	ModelResponse,
	ModelOptions,
	StreamObserver,
} from "./cognition/types.js";
export { BaseModelRunner } from "./cognition/runner.js";
export { SmartModelRunner } from "./cognition/smart_runner.js";
export {
	getAllModels,
	searchModels,
	findModelByIdAndProvider,
} from "./cognition/models.js";
export { buildRequestOptions } from "./cognition/request-options.js";

// ── Stimulus (prompt configuration) ─────────────────────────────────────
export { Stimulus } from "./stimulus/stimulus.js";
export type { StimulusOptions } from "./stimulus/stimulus.js";

// ── Interaction (conversations) ─────────────────────────────────────────
export { Interaction } from "./interaction/core/interaction.js";

// Domain types (Source Session, Exploration, Saved Exploration)
export type {
	SourceSessionKind,
	SourceSession,
	SourceSessionMetrics,
	ExplorationKind,
	ExplorationMemberKind,
	ExplorationMember,
	Exploration,
	SavedExploration,
	ExplorationDiscoveryOptions,
	DefaultExplorationResult,
} from "./interaction/types/domain-types.js";
export {
	createDefaultExploration,
	createVirtualExploration,
} from "./interaction/types/domain-types.js";

// Knowledge file writers
export {
	writeAgentReflection,
	readAgentReflections,
	writeProjectFact,
	readProjectFacts,
	writeSavedReflection,
	listSavedReflections,
	slugify,
	writeArtifact,
	listArtifacts,
	writeUserModelEntry,
	readUserModel,
} from "./interaction/knowledge/index.js";
export type {
	AgentReflectionOptions,
	ProjectFactOptions,
	SavedReflectionOptions,
	ArtifactOptions,
	ArtifactFormat,
	UserModelEntryOptions,
} from "./interaction/knowledge/index.js";

// Interaction persistence (functions, not classes)
export {
	getProjectSessions,
	getSession,
	getRecentSessions,
	filterSessions,
	getSessionStats,
	getProjectSessionsIncludingFromDirectory,
} from "./interaction/persistence/session-store.js";
export {
	parseSessionFile,
	extractConversation,
	extractToolCalls,
	summarizeSession,
	sessionMessagesToNormalized,
	getBeatsForSession,
	parseSessionFileMetadata,
	isSessionJsonlFilename,
} from "./interaction/persistence/session-parser.js";
export { InteractionStore } from "./interaction/persistence/interaction-store.js";

// Interaction analysis (functions, not classes)
export {
	digestSession,
	digestProject,
	askAboutSession,
} from "./interaction/analysis/session-digester.js";
export type { ConversationBeat } from "./interaction/analysis/conversation-beats.js";
export {
	messagesToBeats,
	formatBeatToolSummary,
} from "./interaction/analysis/conversation-beats.js";
export {
	analyzeSession,
	analyzeSessionWithRetry,
	normalizedSessionToMarkdown,
} from "./interaction/analysis/session-analyzer.js";
export {
	searchSessions,
	formatSearchResults,
	getTopTopics,
	getTopTools,
} from "./interaction/analysis/session-search.js";

// ── Providers ───────────────────────────────────────────────────────────
export {
	getModel,
	getModelDetails,
	getModelProvider,
	getModelUrl,
	validateModel,
	registerProvider,
	getRegisteredProvider,
	listRegisteredProviders,
} from "./providers/index.js";
export { BaseProvider } from "./providers/base.js";

// ── Context (compaction) ────────────────────────────────────────────────
export {
	estimateContextSize,
	getCompactionSegment,
	registerCompactionStrategy,
	getCompactionStrategy,
	listCompactionStrategies,
	serializeSegment,
} from "./context/index.js";
export type {
	CompactionInput,
	CompactionResult,
	CompactionStrategy,
	ContextSizeEstimate,
	CompactionSegment,
} from "./context/index.js";

// ── Costs ───────────────────────────────────────────────────────────────
export {
	calculateCost,
	estimateCost,
	formatCostBreakdown,
} from "./costs/costs.js";
export type { TokenUsage, CostBreakdown } from "./costs/costs.js";

// ── Schema ──────────────────────────────────────────────────────────────
export {
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
} from "./schema/index.js";

// ── Markdown / URL utilities ────────────────────────────────────────────
export { fetchUrl } from "./markdown/fetch_url.js";
export { urlToMarkdown } from "./markdown/url_to_markdown.js";
export { parseFeed } from "./markdown/feed_parser.js";

// ── Session record ──────────────────────────────────────────────────────
export {
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
} from "./session-record/index.js";
export type {
	SessionRecordSource,
	LearningKind,
	LearningProvenance,
	LearningRecord,
	SessionHandle,
	CompactionEventV1,
} from "./session-record/index.js";

// ── Stimulus tools & skills ─────────────────────────────────────────────
export { loadToolsFromDirectory } from "./stimulus/tools/loader.js";
export {
	loadSkillsFromDirectory,
	loadSkillsFromGit,
} from "./stimulus/skills/loader.js";
export { createSkillTool } from "./stimulus/skills/skill-tool.js";
export { SkillsRegistry } from "./stimulus/skills/registry.js";

// ── Env loading ─────────────────────────────────────────────────────────
export { loadEnv, findNearestEnvFile } from "./env/load.js";
