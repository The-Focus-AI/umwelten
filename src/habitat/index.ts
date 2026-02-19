/**
 * Habitat module: the central system for an agent.
 */

export { Habitat } from "./habitat.js";

export type {
  HabitatConfig,
  HabitatOptions,
  AgentEntry,
  HabitatCommands,
  HabitatSessionMetadata,
  HabitatSessionType,
  OnboardingResult,
} from "./types.js";

export { HabitatAgent, buildAgentStimulus } from "./habitat-agent.js";

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

export { coreMessagesToJSONL, writeSessionTranscript } from "./transcript.js";

export { loadStimulusOptionsFromWorkDir } from "./load-prompts.js";
