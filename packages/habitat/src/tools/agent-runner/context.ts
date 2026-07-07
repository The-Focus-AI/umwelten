/**
 * Shared context interface + derivation helpers for the agent-runner tools.
 *
 * Each tool in `./*.ts` closes over an `AgentRunnerToolsContext` — the
 * habitat surface they need to register, look up, and clone agents.
 * The factory in `./index.ts` calls them all with one shared `ctx`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentEntry } from "../../types.js";

export const execFileAsync = promisify(execFile);

/** Interface for the habitat context that agent runner tools need. */
export interface AgentRunnerToolsContext {
	getWorkDir(): string;
	getAgent(idOrName: string): AgentEntry | undefined;
	getAgents(): AgentEntry[];
	addAgent(agent: AgentEntry): Promise<void>;
	updateAgent(idOrName: string, updates: Partial<AgentEntry>): Promise<void>;
	getOrCreateHabitatAgent(
		agentId: string,
	): Promise<import("../../habitat-agent.js").HabitatAgent>;
	// Agent directory management
	getAgentDir(agentId: string): string;
	ensureAgentDir(agentId: string): Promise<void>;
}

export function deriveAgentId(seed: string): string {
	return seed
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

export function deriveAgentName(projectPath: string): string {
	const leaf = projectPath
		.split(/[\\/]/)
		.filter(Boolean)
		.pop();
	return leaf || "Local Agent";
}

export function getUniqueAgentId(
	ctx: AgentRunnerToolsContext,
	baseId: string,
): string {
	if (!ctx.getAgent(baseId)) {
		return baseId;
	}

	let suffix = 2;
	while (ctx.getAgent(`${baseId}-${suffix}`)) {
		suffix += 1;
	}
	return `${baseId}-${suffix}`;
}

export async function inferGitRemote(
	projectPath: string,
): Promise<string | undefined> {
	try {
		// Read the raw configured URL, not `remote get-url` — the latter applies
		// url.insteadOf rewrites (SSH shims, proxies), which are local fetch
		// policy and must not leak into the stored gitRemote.
		const { stdout } = await execFileAsync(
			"git",
			["-C", projectPath, "config", "--get", "remote.origin.url"],
			{
				timeout: 5000,
				maxBuffer: 1024 * 1024,
			},
		);
		const gitRemote = stdout.trim();
		return gitRemote || undefined;
	} catch {
		return undefined;
	}
}
