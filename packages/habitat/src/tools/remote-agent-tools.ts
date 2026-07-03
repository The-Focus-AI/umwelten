/**
 * Remote-habitat tools: talk to other habitats over A2A.
 *
 * Implements the tool side of the `remote-habitat` agent kind (see
 * `types.ts` — "a pointer to another habitat reachable via A2A"). A habitat
 * declares remote peers in `config.agents[]`:
 *
 *   {
 *     "id": "gaia",
 *     "name": "Gaia",
 *     "kind": "remote-habitat",
 *     "projectPath": "agents/gaia",
 *     "a2aUrlSecret": "GAIA_A2A_URL",
 *     "a2aTokenSecret": "GAIA_A2A_TOKEN"
 *   }
 *
 * and the `ask_remote_agent` tool sends one-shot A2A `message/send` calls to
 * them. Endpoint + token resolve from the entry itself (`a2aUrl`) or from
 * habitat secrets/env (`a2aUrlSecret` / `a2aTokenSecret`), so example configs
 * stay deployment-agnostic. Entries without a resolvable URL surface a
 * structured error instead of failing silently.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { sendA2AMessageToUrl } from "@umwelten/protocols";
import type { A2AMessageResponse } from "@umwelten/protocols";
import type { AgentEntry, HabitatConfig } from "../types.js";

/** Narrow habitat surface so tests don't need a full Habitat. */
export interface RemoteAgentToolsContext {
	getConfig(): HabitatConfig;
	getSecret(name: string): string | undefined;
	/** Injectable A2A sender (tests). Defaults to sendA2AMessageToUrl. */
	send?: typeof sendA2AMessageToUrl;
}

function remoteEntries(config: HabitatConfig): AgentEntry[] {
	return (config.agents ?? []).filter((a) => a.kind === "remote-habitat");
}

function findRemoteEntry(
	config: HabitatConfig,
	agentId: string,
): AgentEntry | undefined {
	const needle = agentId.trim().toLowerCase();
	return remoteEntries(config).find(
		(a) =>
			a.id.toLowerCase() === needle || a.name?.toLowerCase() === needle,
	);
}

function resolveEndpoint(
	entry: AgentEntry,
	getSecret: (name: string) => string | undefined,
): string | undefined {
	const url =
		entry.a2aUrl?.trim() ||
		(entry.a2aUrlSecret ? getSecret(entry.a2aUrlSecret)?.trim() : undefined);
	return url || undefined;
}

export function createRemoteAgentTools(
	ctx: RemoteAgentToolsContext,
): Record<string, Tool> {
	const send = ctx.send ?? sendA2AMessageToUrl;
	const declared = remoteEntries(ctx.getConfig())
		.map((a) => a.id)
		.join(", ");

	// No remote peers declared → no tool. Config changes that add one land via
	// re-seed + restart, so a creation-time decision is safe.
	if (!declared) return {};

	const ask_remote_agent = tool({
		description:
			"Send a message to a remote agent (another habitat reachable over A2A) and return its reply. " +
			"Use this to delegate questions the remote agent can answer better — e.g. ask an orchestrator " +
			"about the live status of managed agents. " +
			`Remote agents declared for this habitat: ${declared}.`,
		inputSchema: z.object({
			agentId: z
				.string()
				.describe("ID or name of the remote agent (from this habitat's config)"),
			message: z
				.string()
				.describe("Message to send to the remote agent (question, task, etc.)"),
		}),
		execute: async ({ agentId, message }) => {
			const config = ctx.getConfig();
			const entry = findRemoteEntry(config, agentId);
			if (!entry) {
				const available = remoteEntries(config).map((a) => a.id);
				return {
					error: "REMOTE_AGENT_NOT_FOUND",
					message: available.length
						? `No remote agent "${agentId}". Declared remote agents: ${available.join(", ")}`
						: `No remote agent "${agentId}" — this habitat declares no remote-habitat agents.`,
				};
			}

			const endpoint = resolveEndpoint(entry, (n) => ctx.getSecret(n));
			if (!endpoint) {
				return {
					error: "REMOTE_AGENT_NOT_CONFIGURED",
					message:
						`Remote agent "${entry.id}" has no reachable URL. ` +
						(entry.a2aUrlSecret
							? `Set the "${entry.a2aUrlSecret}" secret to its base URL.`
							: `Set "a2aUrl" (or "a2aUrlSecret") on its config entry.`),
				};
			}

			const apiKey = entry.a2aTokenSecret
				? ctx.getSecret(entry.a2aTokenSecret)
				: undefined;

			try {
				const response: A2AMessageResponse = await send({
					endpoint,
					text: message,
					apiKey,
				});
				return {
					agentId: entry.id,
					response: response.text,
					...(response.artifacts ? { artifacts: response.artifacts } : {}),
				};
			} catch (err) {
				return {
					error: "REMOTE_AGENT_ASK_FAILED",
					message: err instanceof Error ? err.message : String(err),
				};
			}
		},
	});

	return { ask_remote_agent };
}
