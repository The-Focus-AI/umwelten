/**
 * Knowledge file writers
 *
 * Project knowledge file writers for the Exploration-centered workflow.
 * Each writer targets a specific promotion destination as defined in the PRD.
 */

// Agent instruction writer — AGENTS.md / CLAUDE.md Reflections sections
export {
	writeAgentReflection,
	readAgentReflections,
} from "./agent-instruction-writer.js";
export type { AgentReflectionOptions } from "./agent-instruction-writer.js";

// FACTS.md writer
export { writeProjectFact, readProjectFacts } from "./facts-writer.js";
export type { ProjectFactOptions } from "./facts-writer.js";

// Saved Reflection writer — .umwelten/reflections/
export {
	writeSavedReflection,
	listSavedReflections,
	slugify,
} from "./saved-reflection-writer.js";
export type { SavedReflectionOptions } from "./saved-reflection-writer.js";

// Artifact writer — .umwelten/artifacts/
export { writeArtifact, listArtifacts } from "./artifact-writer.js";
export type { ArtifactOptions, ArtifactFormat } from "./artifact-writer.js";

// User model writer — .umwelten/user-model.md
export {
	writeUserModelEntry,
	readUserModel,
} from "./user-model-writer.js";
export type { UserModelEntryOptions } from "./user-model-writer.js";
