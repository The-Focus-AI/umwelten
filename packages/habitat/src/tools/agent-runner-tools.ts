/**
 * Re-export shim. The implementation moved to ./agent-runner/ (one file
 * per tool) in Wave G. This file exists so the established import path
 * (`@umwelten/habitat/tools/agent-runner-tools.js`) keeps working.
 */

export type { AgentRunnerToolsContext } from "./agent-runner/index.js";
export {
	createAgentRunnerTools,
	registerManagedAgentDirectory,
	configureManagedAgent,
} from "./agent-runner/index.js";
