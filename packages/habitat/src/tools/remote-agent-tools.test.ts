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
}) {
	return {
		getConfig: () => ({ agents: opts.agents ?? [] }) as HabitatConfig,
		getSecret: (name: string) => opts.secrets?.[name],
		send: opts.send,
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
		expect(send).toHaveBeenCalledWith({
			endpoint: "https://gaia.example.com",
			text: "what's running?",
			apiKey: "tok-123",
		});
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
		expect(send).toHaveBeenCalledWith({
			endpoint: "http://172.17.0.1:7420",
			text: "hi",
			apiKey: undefined,
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
