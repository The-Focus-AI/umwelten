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
import {
	checkAgentCall,
	getAgentCallContext,
	withAgentCall,
} from "../identity/agent-call-context.js";
import { encodeAgentChain } from "../identity/agent-call-wire.js";

/**
 * A peer resolved from the Directory rather than from frozen config.
 *
 * Gaia is the Directory, not the router (ADR 0008): it answers *who exists
 * and where*, and the caller then talks to the peer directly.
 */
export interface ResolvedPeer {
	id: string;
	/** Base URL or full /a2a endpoint. */
	endpoint: string;
	/** Bearer token for that peer, when the Directory holds one. */
	apiKey?: string;
}

/** Narrow habitat surface so tests don't need a full Habitat. */
export interface RemoteAgentToolsContext {
	getConfig(): HabitatConfig;
	getSecret(name: string): string | undefined;
	/** Injectable A2A sender (tests). Defaults to sendA2AMessageToUrl. */
	send?: typeof sendA2AMessageToUrl;
	/**
	 * Look a peer up in the Directory at call time.
	 *
	 * Without this, peers are whatever was declared before the container
	 * started — so onboarding a client habitat would mean restarting the
	 * operations habitat, which defeats giving a prospect a habitat on first
	 * contact. Returns undefined when the Directory has no such peer.
	 */
	resolvePeer?: (agentId: string) => Promise<ResolvedPeer | undefined>;
	/** Names the Directory can offer, for the tool description and errors. */
	listPeers?: () => Promise<string[]>;
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

/** Declared peers plus whatever the Directory can offer, deduped. */
async function listKnownPeers(
	ctx: RemoteAgentToolsContext,
	declaredIds: string[],
): Promise<string[]> {
	const names = [...declaredIds];
	try {
		for (const id of (await ctx.listPeers?.()) ?? []) {
			if (!names.includes(id)) names.push(id);
		}
	} catch {
		// A directory that cannot list is still worth reporting the local half of.
	}
	return names;
}

export function createRemoteAgentTools(
	ctx: RemoteAgentToolsContext,
): Record<string, Tool> {
	const send = ctx.send ?? sendA2AMessageToUrl;
	const declaredIds = remoteEntries(ctx.getConfig()).map((a) => a.id);
	const declared = declaredIds.join(", ");

	// With a Directory, register the tool even when nothing was declared at
	// start: a habitat created after this one booted is still reachable, which
	// is the whole point of resolving at call time (#280). Without one, fall
	// back to the old rule — no declared peers means no tool.
	if (!declared && !ctx.resolvePeer) return {};

	const peerSummary = declared
		? `Declared peers: ${declared}.` +
			(ctx.resolvePeer
				? " Other habitats in the fleet resolve through the directory at call time."
				: "")
		: "Peers resolve through the fleet directory at call time; ask for one by id.";

	const ask_remote_agent = tool({
		description:
			"Send a message to a remote agent (another habitat reachable over A2A) and return its reply. " +
			"Use this to delegate questions the remote agent can answer better — e.g. ask an orchestrator " +
			"about the live status of managed agents. " +
			peerSummary,
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

			let peerId: string;
			let endpoint: string | undefined;
			let apiKey: string | undefined;

			if (entry) {
				// A declared peer wins: an explicit local declaration is a
				// deliberate override of whatever the Directory would say.
				peerId = entry.id;
				endpoint = resolveEndpoint(entry, (n) => ctx.getSecret(n));
				apiKey = entry.a2aTokenSecret
					? ctx.getSecret(entry.a2aTokenSecret)
					: undefined;

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
			} else if (ctx.resolvePeer) {
				let resolved: ResolvedPeer | undefined;
				try {
					resolved = await ctx.resolvePeer(agentId);
				} catch (err) {
					// A Directory outage must not take the caller down with it.
					return {
						error: "REMOTE_AGENT_DIRECTORY_UNAVAILABLE",
						message: `Could not reach the fleet directory to resolve "${agentId}": ${err instanceof Error ? err.message : String(err)}`,
					};
				}

				if (!resolved) {
					const known = await listKnownPeers(ctx, declaredIds);
					return {
						error: "REMOTE_AGENT_NOT_FOUND",
						message: known.length
							? `No remote agent "${agentId}". Known agents: ${known.join(", ")}`
							: `No remote agent "${agentId}" — neither this habitat's config nor the fleet directory knows it.`,
					};
				}

				peerId = resolved.id;
				endpoint = resolved.endpoint;
				apiKey = resolved.apiKey;
			} else {
				const available = remoteEntries(config).map((a) => a.id);
				return {
					error: "REMOTE_AGENT_NOT_FOUND",
					message: available.length
						? `No remote agent "${agentId}". Declared remote agents: ${available.join(", ")}`
						: `No remote agent "${agentId}" — this habitat declares no remote-habitat agents.`,
				};
			}


			// Depth and cycle guard, now that it survives the hop (ADR 0008).
			// Refuse before spending anything: with LLM agents on both ends and
			// output caps forbidden, an unbounded cycle is unbounded spend.
			const check = checkAgentCall(peerId);
			if (!check.ok) {
				return {
					error: check.reason === "CYCLE" ? "AGENT_CYCLE" : "AGENT_MAX_DEPTH",
					message: check.message,
					chain: check.chain,
				};
			}

			try {
				const response: A2AMessageResponse = await withAgentCall(
					peerId,
					async () =>
						send({
							endpoint,
							text: message,
							apiKey,
							// Carry the chain so the receiving habitat can extend it
							// rather than starting fresh.
							metadata: encodeAgentChain(
								getAgentCallContext()?.chain ?? [peerId],
							),
						}),
				);
				return {
					agentId: peerId,
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
