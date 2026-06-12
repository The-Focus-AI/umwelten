/**
 * resolveAgentMcpMount — manifest → mcp-serve handler wiring.
 *
 * The framework store and module loading are stubbed via deps, so these
 * tests exercise exactly the resolution logic: export shapes, store
 * driver selection, and the structured errors the container server turns
 * into JSON responses.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MemoryStore } from "@umwelten/protocols";
import { resolveAgentMcpMount } from "./agent-mcp-mount.js";
import type { AgentManifest } from "./identity/agent-manifest.js";

const PROJECT = "/data/agents/demo/repo";

function manifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
	return {
		name: "demo-agent",
		publicMcp: true,
		publicRoutes: [],
		publicAuth: {
			kind: "oauth-server",
			upstreamProvider: "dist/upstream.js",
			registerTools: "dist/tools.js",
		},
		...overrides,
	} as AgentManifest;
}

const validProvider = {
	name: "stub",
	buildAuthorizeUrl: () => "https://upstream.example/authorize",
	exchangeCode: async () => ({
		tokens: { access_token: "a", refresh_token: "r", expires_at: null },
		userId: "u1",
	}),
	refreshToken: async () => ({
		access_token: "a",
		refresh_token: "r",
		expires_at: null,
	}),
};

function stubModules(modules: Record<string, Record<string, unknown>>) {
	return vi.fn(async (absPath: string) => {
		for (const [suffix, mod] of Object.entries(modules)) {
			if (absPath.endsWith(suffix)) return mod;
		}
		throw new Error(`no stub module for ${absPath}`);
	});
}

const silentWarn = () => {};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveAgentMcpMount", () => {
	it("wires manifest modules into a working mount (default export + in-memory store)", async () => {
		const importModule = stubModules({
			"dist/upstream.js": { default: validProvider },
			"dist/tools.js": { default: async () => {} },
		});
		const warn = vi.fn();

		const result = await resolveAgentMcpMount("demo", PROJECT, manifest(), {
			importModule,
			warn,
		});

		expect(result.ok).toBe(true);
		// Modules resolve against the agent repo root.
		expect(importModule).toHaveBeenCalledWith(`${PROJECT}/dist/upstream.js`);
		expect(importModule).toHaveBeenCalledWith(`${PROJECT}/dist/tools.js`);
		// No store configured → in-memory fallback is announced, not silent.
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("in-memory"));

		// The mount actually serves: AS metadata under the prefix.
		if (!result.ok) throw new Error("unreachable");
		let body = "";
		const res = {
			writeHead: vi.fn(),
			end: (c?: string) => {
				if (c) body += c;
			},
		} as unknown as ServerResponse;
		const handled = await result.mount.handle(
			{ method: "GET", url: "/x", headers: {} } as unknown as IncomingMessage,
			res,
			".well-known/oauth-authorization-server",
			"http://h/agents/demo",
		);
		expect(handled).toBe(true);
		expect(JSON.parse(body).authorization_endpoint).toBe(
			"http://h/agents/demo/oauth/authorize",
		);
	});

	it("accepts named exports (provider / registerTools)", async () => {
		const result = await resolveAgentMcpMount("demo", PROJECT, manifest(), {
			importModule: stubModules({
				"dist/upstream.js": { provider: validProvider },
				"dist/tools.js": { registerTools: async () => {} },
			}),
			warn: silentWarn,
		});
		expect(result.ok).toBe(true);
	});

	it("rejects an agent whose manifest has publicMcp false", async () => {
		const result = await resolveAgentMcpMount(
			"demo",
			PROJECT,
			manifest({ publicMcp: false }),
			{ importModule: stubModules({}), warn: silentWarn },
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("MCP_NOT_ENABLED");
		expect(result.error.status).toBe(404);
	});

	it("reports a clear error when the provider module fails to load", async () => {
		const result = await resolveAgentMcpMount("demo", PROJECT, manifest(), {
			importModule: vi.fn(async () => {
				throw new Error("Cannot find module");
			}),
			warn: silentWarn,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("UPSTREAM_PROVIDER_LOAD_FAILED");
		expect(result.error.message).toContain("dist/upstream.js");
		expect(result.error.message).toContain("Cannot find module");
	});

	it("rejects a provider module with the wrong export shape", async () => {
		const result = await resolveAgentMcpMount("demo", PROJECT, manifest(), {
			importModule: stubModules({
				"dist/upstream.js": { default: { notAProvider: true } },
				"dist/tools.js": { default: async () => {} },
			}),
			warn: silentWarn,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("UPSTREAM_PROVIDER_INVALID");
	});

	it("rejects a registrar module without a function export", async () => {
		const result = await resolveAgentMcpMount("demo", PROJECT, manifest(), {
			importModule: stubModules({
				"dist/upstream.js": { default: validProvider },
				"dist/tools.js": { default: "not a function" },
			}),
			warn: silentWarn,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("REGISTER_TOOLS_INVALID");
	});

	it("builds the neon store from the envRef connection string", async () => {
		vi.stubEnv("DEMO_DATABASE_URL", "postgres://example");
		const createNeonStore = vi.fn(() => new MemoryStore());

		const result = await resolveAgentMcpMount(
			"demo",
			PROJECT,
			manifest({
				publicAuth: {
					kind: "oauth-server",
					upstreamProvider: "dist/upstream.js",
					registerTools: "dist/tools.js",
					store: { driver: "neon", envRef: "DEMO_DATABASE_URL" },
				},
			} as Partial<AgentManifest>),
			{
				importModule: stubModules({
					"dist/upstream.js": { default: validProvider },
					"dist/tools.js": { default: async () => {} },
				}),
				createNeonStore,
				warn: silentWarn,
			},
		);

		expect(result.ok).toBe(true);
		expect(createNeonStore).toHaveBeenCalledWith("postgres://example");
	});

	it("errors clearly when the neon envRef is unset", async () => {
		const result = await resolveAgentMcpMount(
			"demo",
			PROJECT,
			manifest({
				publicAuth: {
					kind: "oauth-server",
					upstreamProvider: "dist/upstream.js",
					registerTools: "dist/tools.js",
					store: { driver: "neon", envRef: "DEFINITELY_NOT_SET_12345" },
				},
			} as Partial<AgentManifest>),
			{
				importModule: stubModules({
					"dist/upstream.js": { default: validProvider },
					"dist/tools.js": { default: async () => {} },
				}),
				warn: silentWarn,
			},
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("STORE_ENV_MISSING");
		expect(result.error.message).toContain("DEFINITELY_NOT_SET_12345");
	});

	it("errors clearly on the not-yet-implemented sqlite driver", async () => {
		const result = await resolveAgentMcpMount(
			"demo",
			PROJECT,
			manifest({
				publicAuth: {
					kind: "oauth-server",
					upstreamProvider: "dist/upstream.js",
					registerTools: "dist/tools.js",
					store: { driver: "sqlite", path: "./oauth.db" },
				},
			} as Partial<AgentManifest>),
			{
				importModule: stubModules({
					"dist/upstream.js": { default: validProvider },
					"dist/tools.js": { default: async () => {} },
				}),
				warn: silentWarn,
			},
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.error).toBe("STORE_DRIVER_UNSUPPORTED");
		expect(result.error.message).toContain("sqlite");
	});
});
