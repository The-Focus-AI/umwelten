/**
 * Unit tests for remote-agent tools (kind: "remote-habitat" → ask_remote_agent).
 *
 * Covers: registration gating (no remote peers → no tool), endpoint/token
 * resolution from entry vs secrets, lookup by id and name, and the structured
 * error shapes the model is expected to relay.
 */

import { describe, it, expect, vi } from "vitest";
import { createRemoteAgentTools } from "./remote-agent-tools.js";
import type { HabitatConfig } from "../types.js";

const gaiaEntry = {
	id: "gaia",
	name: "Gaia",
	projectPath: "agents/gaia",
	kind: "remote-habitat" as const,
	a2aUrlSecret: "GAIA_A2A_URL",
	a2aTokenSecret: "GAIA_A2A_TOKEN",
};

function makeCtx(opts: {
	agents?: HabitatConfig["agents"];
	secrets?: Record<string, string>;
	send?: any;
	resolvePeer?: any;
	listPeers?: any;
}) {
	return {
		getConfig: () => ({ agents: opts.agents ?? [] }) as HabitatConfig,
		getSecret: (name: string) => opts.secrets?.[name],
		send: opts.send,
		...(opts.resolvePeer ? { resolvePeer: opts.resolvePeer } : {}),
		...(opts.listPeers ? { listPeers: opts.listPeers } : {}),
	};
}

async function callAsk(tools: Record<string, any>, input: unknown) {
	return tools.ask_remote_agent.execute(input, {} as any);
}

describe("createRemoteAgentTools", () => {
	it("registers no tools when the config declares no remote-habitat agents", () => {
		expect(createRemoteAgentTools(makeCtx({}))).toEqual({});
		// repo-kind agents don't count
		expect(
			createRemoteAgentTools(
				makeCtx({
					agents: [{ id: "proj", name: "Proj", projectPath: "agents/proj" }],
				}),
			),
		).toEqual({});
	});

	it("mentions declared remote agents in the tool description", () => {
		const tools = createRemoteAgentTools(makeCtx({ agents: [gaiaEntry] }));
		expect(tools.ask_remote_agent).toBeDefined();
		expect((tools.ask_remote_agent as any).description).toContain("gaia");
	});

	it("sends via the resolved secret URL + token and returns the reply", async () => {
		const send = vi.fn().mockResolvedValue({ text: "3 habitats running" });
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [gaiaEntry],
				secrets: {
					GAIA_A2A_URL: "https://gaia.example.com",
					GAIA_A2A_TOKEN: "tok-123",
				},
				send,
			}),
		);
		const out = await callAsk(tools, {
			agentId: "gaia",
			message: "what's running?",
		});
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
			endpoint: "https://gaia.example.com",
			text: "what's running?",
			apiKey: "tok-123",}),
		);
		expect(out).toEqual({ agentId: "gaia", response: "3 habitats running" });
	});

	it("resolves by display name (case-insensitive) and inline a2aUrl", async () => {
		const send = vi.fn().mockResolvedValue({ text: "ok" });
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [{ ...gaiaEntry, a2aUrlSecret: undefined, a2aUrl: "http://172.17.0.1:7420" }],
				send,
			}),
		);
		const out = await callAsk(tools, { agentId: "GAIA", message: "hi" });
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "http://172.17.0.1:7420",
				text: "hi",
				apiKey: undefined,
			}),
		);
		// The call now carries the agent-call chain so the receiving habitat
		// extends it instead of starting fresh (ADR 0008).
		expect(send.mock.calls[0][0].metadata).toEqual({
			"umwelten.agentChain": ["gaia"],
		});
		expect(out.agentId).toBe("gaia");
	});

	it("returns REMOTE_AGENT_NOT_FOUND with the declared list", async () => {
		const tools = createRemoteAgentTools(makeCtx({ agents: [gaiaEntry] }));
		const out = await callAsk(tools, { agentId: "nope", message: "hi" });
		expect(out.error).toBe("REMOTE_AGENT_NOT_FOUND");
		expect(out.message).toContain("gaia");
	});

	it("returns REMOTE_AGENT_NOT_CONFIGURED when the URL secret is unset", async () => {
		const send = vi.fn();
		const tools = createRemoteAgentTools(
			makeCtx({ agents: [gaiaEntry], send }),
		);
		const out = await callAsk(tools, { agentId: "gaia", message: "hi" });
		expect(out.error).toBe("REMOTE_AGENT_NOT_CONFIGURED");
		expect(out.message).toContain("GAIA_A2A_URL");
		expect(send).not.toHaveBeenCalled();
	});

	it("wraps transport failures as REMOTE_AGENT_ASK_FAILED", async () => {
		const send = vi.fn().mockRejectedValue(new Error("HTTP 401"));
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [{ ...gaiaEntry, a2aUrl: "https://gaia.example.com" }],
				send,
			}),
		);
		const out = await callAsk(tools, { agentId: "gaia", message: "hi" });
		expect(out).toEqual({
			error: "REMOTE_AGENT_ASK_FAILED",
			message: "HTTP 401",
		});
	});

	it("passes artifacts through when the remote reply includes them", async () => {
		const send = vi.fn().mockResolvedValue({
			text: "report ready",
			artifacts: [{ name: "report.html", uri: "https://gaia.example.com/files/r.html" }],
		});
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [{ ...gaiaEntry, a2aUrl: "https://gaia.example.com" }],
				send,
			}),
		);
		const out = await callAsk(tools, { agentId: "gaia", message: "report" });
		expect(out.artifacts).toHaveLength(1);
	});
});

/**
 * Call-time resolution (#280). Peers used to be frozen at container start, so
 * onboarding a client habitat meant restarting the operations habitat — which
 * defeats giving a prospect a habitat on first contact.
 */
describe("createRemoteAgentTools — directory resolution", () => {
	const peer = {
		id: "upperhand",
		endpoint: "https://upperhand.habitats.example.com",
		apiKey: "peer-tok",
	};

	it("registers the tool even when no peers were declared at start", () => {
		const tools = createRemoteAgentTools(
			makeCtx({ agents: [], resolvePeer: async () => peer } as never),
		);
		expect(Object.keys(tools)).toContain("ask_remote_agent");
	});

	it("still registers nothing when there is no directory and no declared peers", () => {
		expect(createRemoteAgentTools(makeCtx({ agents: [] }))).toEqual({});
	});

	it("reaches a habitat created after this one booted", async () => {
		const send = vi.fn().mockResolvedValue({ text: "on track" });
		const tools = createRemoteAgentTools(
			makeCtx({ agents: [], send, resolvePeer: async () => peer } as never),
		);
		const out = await callAsk(tools, { agentId: "upperhand", message: "status?" });

		expect(out.agentId).toBe("upperhand");
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				endpoint: "https://upperhand.habitats.example.com",
				apiKey: "peer-tok",
			}),
		);
	});

	it("prefers a declared peer over the directory", async () => {
		const send = vi.fn().mockResolvedValue({ text: "ok" });
		const resolvePeer = vi.fn().mockResolvedValue(peer);
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [{ ...gaiaEntry, a2aUrlSecret: undefined, a2aUrl: "http://declared:7420" }],
				send,
				resolvePeer,
			} as never),
		);
		await callAsk(tools, { agentId: "gaia", message: "hi" });

		expect(resolvePeer).not.toHaveBeenCalled();
		expect(send.mock.calls[0][0].endpoint).toBe("http://declared:7420");
	});

	it("names what it knows when the directory has no such peer", async () => {
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [],
				resolvePeer: async () => undefined,
				listPeers: async () => ["alpha", "beta"],
			} as never),
		);
		const out = await callAsk(tools, { agentId: "nope", message: "hi" });

		expect(out.error).toBe("REMOTE_AGENT_NOT_FOUND");
		expect(out.message).toContain("alpha");
		expect(out.message).toContain("beta");
	});

	it("does not crash the caller when the directory is unreachable", async () => {
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [],
				resolvePeer: async () => {
					throw new Error("ECONNREFUSED");
				},
			} as never),
		);
		const out = await callAsk(tools, { agentId: "upperhand", message: "hi" });

		expect(out.error).toBe("REMOTE_AGENT_DIRECTORY_UNAVAILABLE");
		expect(out.message).toContain("ECONNREFUSED");
	});

	it("still reports declared peers when the directory cannot list", async () => {
		const tools = createRemoteAgentTools(
			makeCtx({
				agents: [gaiaEntry],
				resolvePeer: async () => undefined,
				listPeers: async () => {
					throw new Error("directory down");
				},
			} as never),
		);
		const out = await callAsk(tools, { agentId: "nope", message: "hi" });
		expect(out.message).toContain("gaia");
	});

	it("carries the resolved peer id into the call chain", async () => {
		const send = vi.fn().mockResolvedValue({ text: "ok" });
		const tools = createRemoteAgentTools(
			makeCtx({ agents: [], send, resolvePeer: async () => peer } as never),
		);
		await callAsk(tools, { agentId: "upperhand", message: "hi" });

		expect(send.mock.calls[0][0].metadata).toEqual({
			"umwelten.agentChain": ["upperhand"],
		});
	});
});
