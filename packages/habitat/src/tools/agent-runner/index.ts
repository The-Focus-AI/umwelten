/**
 * Agent runner tools — let the main habitat agent manage sub-agents
 * (HabitatAgents). Each tool lives in its own file; this index composes
 * them into the record `createAgentRunnerTools` returns.
 *
 * Public surface (preserved from the pre-split agent-runner-tools.ts):
 * - `createAgentRunnerTools(ctx)` — composes all the tool factories
 * - `AgentRunnerToolsContext` — the habitat shape they close over
 * - `registerManagedAgentDirectory` — also called directly by the
 *   `umwelten habitat local` / `here` CLI subcommands
 * - `configureManagedAgent` — same as above
 */

import type { Tool } from "ai";
import type { AgentRunnerToolsContext } from "./context.js";
import { createAgentRegisterDirectoryTool } from "./register-directory.js";
import { createAgentCloneTool } from "./clone.js";
import { createAgentLogsTool } from "./logs.js";
import { createAgentStatusTool } from "./status.js";
import { createAgentAskTool } from "./ask.js";
import { createAgentAskClaudeTool } from "./ask-claude.js";
import { createAgentConverseTool } from "./converse.js";
import { createAgentConfigureTool } from "./configure.js";

export type { AgentRunnerToolsContext } from "./context.js";
export { registerManagedAgentDirectory } from "./register-directory.js";
export { configureManagedAgent } from "./configure.js";

export function createAgentRunnerTools(
	ctx: AgentRunnerToolsContext,
): Record<string, Tool> {
	return {
		agent_register_directory: createAgentRegisterDirectoryTool(ctx),
		agent_clone: createAgentCloneTool(ctx),
		agent_logs: createAgentLogsTool(ctx),
		agent_status: createAgentStatusTool(ctx),
		agent_ask: createAgentAskTool(ctx),
		agent_ask_claude: createAgentAskClaudeTool(ctx),
		agent_converse: createAgentConverseTool(ctx),
		agent_configure: createAgentConfigureTool(ctx),
	};
}
