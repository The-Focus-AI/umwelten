export {
  DurableHabitat,
  HabitatHost,
  type DurableHabitatOptions,
  type HabitatHostOptions,
} from "./durable-habitat.js";

export {
  bridgeMcpClientToExtension,
  bridgeUmweltenToolsToExtension,
  mcpToolPrefix,
  type McpToolSource,
  ConversationAnnotationsDoc,
  ConversationUIResourcesDoc,
  createCronScheduleExtension,
  createRepoScopeExtension,
  createTurnFanoutExtension,
  createUiResourcesExtension,
  HabitatCronTask,
  HabitatSchedulesDoc,
  type AnnotationRecord,
  type DurableScheduleSpec,
  type RepoScopeExtensionOptions,
  type ScheduleDocState,
  type TurnAnnotationProbe,
  type TurnFanoutExtensionOptions,
} from "./extensions.js";

export {
  assertValidHabitatId,
  createGaiaAuthenticator,
  GaiaHost,
  parseBearerKeys,
  type AuthenticatedCaller,
  type GaiaAuthenticator,
  type GaiaAuthOptions,
  type GaiaHostOptions,
  type StoredHabitatDeclaration,
} from "./gaia-host.js";

export {
  ActiveMcpSkillsDoc,
  answerMcpSkillApproval,
  createMcpSkillsExtension,
  deactivateMcpSkill,
  getActiveMcpSkills,
  McpSkillApprovalSignal,
  renderMcpSkillsSection,
  type ActiveMcpSkill,
  type McpSkillsExtensionOptions,
  type PendingMcpSkillApproval,
} from "./mcp-skills.js";
