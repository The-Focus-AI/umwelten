/**
 * GaiaSessionAdapter (issue #120) — proxy-backed remote habitat sessions.
 *
 * All HTTP is mocked via the injectable fetchImpl: listing across
 * habitats, loading full messages, habitat attribution, and the error
 * paths (unreachable host, bad token, one habitat down).
 */

import { describe, it, expect, vi } from "vitest";
import { GaiaSessionAdapter } from "./gaia-session-adapter.js";
import { AdapterRegistry } from "./adapter.js";
import { projectSessions } from "../projection/projector.js";

const HOST = "http://gaia.example:7420";

type RouteMap = Record<string, unknown | (() => unknown)>;

/** fetch stub: path → JSON body, or a thrower for network errors. */
function fetchFor(routes: RouteMap, status = 200) {
	return vi.fn(async (url: RequestInfo | URL) => {
		const path = String(url).replace(HOST, "");
		const hit = routes[path];
		if (hit === undefined) {
			return { ok: false, status: 404, json: async () => ({}) } as Response;
		}
		const body = typeof hit === "function" ? (hit as () => unknown)() : hit;
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		} as Response;
	});
}

const HABITATS = [
	{ id: "jeeves", name: "Jeeves Bot", status: "running" },
	{ id: "scout", name: "Scout", status: "running" },
];

const JEEVES_SESSIONS = {
	sessions: [
		{
			sessionId: "s-100",
			type: "chat",
			created: "2026-06-01T10:00:00.000Z",
			lastUsed: "2026-06-02T10:00:00.000Z",
			firstPrompt: "deploy the newsletter",
			messageCount: 8,
		},
	],
	total: 1,
};

const SCOUT_SESSIONS = {
	sessions: [
		{
			sessionId: "s-200",
			type: "chat",
			created: "2026-06-03T10:00:00.000Z",
			lastUsed: "2026-06-03T11:00:00.000Z",
			firstPrompt: "scan the feeds",
			messageCount: 3,
		},
	],
	total: 1,
};

const MESSAGES = {
	sessionId: "s-100",
	messages: [
		{ index: 0, role: "user", content: "deploy the newsletter", timestamp: "2026-06-01T10:00:00.000Z" },
		{
			index: 1,
			role: "assistant",
			content: "On it.",
			model: "gemini-3-flash-preview",
			toolCalls: [{ id: "t1", name: "deploy", input: { target: "prod" } }],
			toolResults: [{ tool_use_id: "t1", content: "deployed ok", is_error: false }],
		},
	],
};

function adapter(routes: RouteMap, opts: { token?: string; warn?: (m: string) => void } = {}) {
	return new GaiaSessionAdapter({
		host: HOST,
		token: opts.token ?? "secret-token",
		fetchImpl: fetchFor(routes) as unknown as typeof fetch,
		warn: opts.warn ?? (() => {}),
	});
}

describe("GaiaSessionAdapter — listing", () => {
	it("lists sessions across all registered habitats with bearer auth", async () => {
		const fetchImpl = fetchFor({
			"/api/habitats": HABITATS,
			"/api/habitats/jeeves/sessions": JEEVES_SESSIONS,
			"/api/habitats/scout/sessions": SCOUT_SESSIONS,
		});
		const a = new GaiaSessionAdapter({
			host: HOST,
			token: "secret-token",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			warn: () => {},
		});

		const result = await a.discoverSessions();

		expect(result.source).toBe("gaia");
		expect(result.totalCount).toBe(2);
		expect(result.sessions.map((s) => s.id).sort()).toEqual([
			"gaia:jeeves:s-100",
			"gaia:scout:s-200",
		]);
		// Bearer auth on every request
		for (const call of fetchImpl.mock.calls) {
			expect((call[1] as RequestInit).headers).toMatchObject({
				authorization: "Bearer secret-token",
			});
		}
	});

	it("attributes each session to its habitat entry", async () => {
		const a = adapter({
			"/api/habitats": HABITATS,
			"/api/habitats/jeeves/sessions": JEEVES_SESSIONS,
			"/api/habitats/scout/sessions": SCOUT_SESSIONS,
		});

		const { sessions } = await a.discoverSessions();
		const jeeves = sessions.find((s) => s.id === "gaia:jeeves:s-100")!;

		expect(jeeves.sourceData).toMatchObject({
			habitatId: "jeeves",
			habitatName: "Jeeves Bot",
			gaiaHost: HOST,
		});
		expect(jeeves.firstPrompt).toBe("deploy the newsletter");
		expect(jeeves.messageCount).toBe(8);
	});

	it("is inert (empty, no warnings) when no host is configured", async () => {
		const warn = vi.fn();
		const a = new GaiaSessionAdapter({
			host: undefined,
			fetchImpl: fetchFor({}) as unknown as typeof fetch,
			warn,
		});
		// Belt and braces: GAIA_HOST may leak from the environment.
		if (!process.env.GAIA_HOST) {
			const result = await a.discoverSessions();
			expect(result.sessions).toEqual([]);
			expect(warn).not.toHaveBeenCalled();
		}
	});
});

describe("GaiaSessionAdapter — loading", () => {
	it("loads a full session with normalized messages and tool activity", async () => {
		const a = adapter({
			"/api/habitats/jeeves/sessions": JEEVES_SESSIONS,
			"/api/habitats/jeeves/sessions/s-100/messages": MESSAGES,
		});

		const session = await a.getSession("gaia:jeeves:s-100");

		expect(session).not.toBeNull();
		expect(session!.source).toBe("gaia");
		expect(session!.sourceData).toMatchObject({ habitatId: "jeeves" });
		const roles = session!.messages.map((m) => m.role);
		expect(roles).toEqual(["user", "assistant", "tool"]);
		const tool = session!.messages[2];
		expect(tool.tool).toMatchObject({
			name: "deploy",
			output: "deployed ok",
			isError: false,
		});
		expect(session!.messages[1].model).toBe("gemini-3-flash-preview");
	});

	it("accepts unprefixed habitat:session ids too", async () => {
		const a = adapter({
			"/api/habitats/jeeves/sessions": JEEVES_SESSIONS,
			"/api/habitats/jeeves/sessions/s-100/messages": MESSAGES,
		});
		expect(await a.getMessages("jeeves:s-100")).toHaveLength(3);
	});
});

describe("GaiaSessionAdapter — degradation", () => {
	it("warns and returns an empty result when the host is unreachable", async () => {
		const warn = vi.fn();
		const a = new GaiaSessionAdapter({
			host: HOST,
			fetchImpl: vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			}) as unknown as typeof fetch,
			warn,
		});

		const result = await a.discoverSessions();

		expect(result.sessions).toEqual([]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unreachable"));
	});

	it("warns and returns an empty result on a bad token (401)", async () => {
		const warn = vi.fn();
		const a = new GaiaSessionAdapter({
			host: HOST,
			token: "wrong",
			fetchImpl: vi.fn(async () => ({
				ok: false,
				status: 401,
				json: async () => ({ error: "Unauthorized" }),
			})) as unknown as typeof fetch,
			warn,
		});

		const result = await a.discoverSessions();

		expect(result.sessions).toEqual([]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("401"));
	});

	it("skips a failing habitat but keeps listing the others", async () => {
		const warn = vi.fn();
		const a = adapter(
			{
				"/api/habitats": HABITATS,
				// jeeves missing → 404 from the stub
				"/api/habitats/scout/sessions": SCOUT_SESSIONS,
			},
			{ warn },
		);

		const { sessions } = await a.discoverSessions();

		expect(sessions.map((s) => s.id)).toEqual(["gaia:scout:s-200"]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('habitat "jeeves"'));
	});
});

describe("GaiaSessionAdapter — projection integration", () => {
	it("projects remote sessions into Explorations like any other adapter", async () => {
		const registry = new AdapterRegistry();
		registry.register(
			adapter({
				"/api/habitats": HABITATS,
				"/api/habitats/jeeves/sessions": JEEVES_SESSIONS,
				"/api/habitats/scout/sessions": SCOUT_SESSIONS,
			}),
		);

		const projection = await projectSessions("/some/project", { registry });

		expect(projection.sourceSessions).toHaveLength(2);
		const jeeves = projection.sourceSessions.find(
			(s) => s.id === "gaia:jeeves:s-100",
		)!;
		expect(jeeves.source).toBe("gaia");
		expect(jeeves.sourceData).toMatchObject({
			habitatId: "jeeves",
			habitatName: "Jeeves Bot",
		});
		expect(projection.explorations).toHaveLength(2);
	});
});
