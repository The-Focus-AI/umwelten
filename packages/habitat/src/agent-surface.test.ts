/**
 * createAgentSurface — the /agents/<id>/... routing of the container server.
 *
 * Covers the issue-#121 acceptance criteria:
 *  - the per-agent MCP path serves a real mcp-serve handler (no more 501)
 *  - manifest.json and static UI serving keep working as before
 *  - an agent without MCP configuration yields a clear error, not a crash
 *  - the RFC 8414 path-inserted discovery URLs route into the right mount
 *
 * Uses a minimal host stub (getAgent/getMcpAgents) and stubbed manifest
 * modules — no container server, no network, no real OAuth provider.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSurface, type AgentSurfaceHost } from "./agent-surface.js";
import type { AgentManifest } from "./identity/agent-manifest.js";
import type { AgentEntry } from "./types.js";

function fakeReq(method: string, url: string): IncomingMessage {
	// x-forwarded-proto pins getPublicBaseUrl to the host header — the test
	// runner's ambient BASE_URL (vite injects "/") must not leak into URLs.
	return {
		method,
		url,
		headers: { host: "localhost:7430", "x-forwarded-proto": "http" },
	} as unknown as IncomingMessage;
}

function fakeRes() {
	let statusCode = 0;
	const headers: Record<string, string> = {};
	let body = "";
	let headersSent = false;
	const res = {
		get headersSent() {
			return headersSent;
		},
		writeHead(code: number, h?: Record<string, string | number>) {
			statusCode = code;
			if (h) for (const [k, v] of Object.entries(h)) headers[k] = String(v);
			headersSent = true;
			return res;
		},
		setHeader(k: string, v: string) {
			headers[k] = v;
		},
		end(chunk?: string | Buffer) {
			if (chunk) body += chunk.toString();
		},
	};
	return {
		res: res as unknown as ServerResponse,
		status: () => statusCode,
		header: (k: string) => headers[k],
		body: () => body,
		json: () => JSON.parse(body),
	};
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

const stubImportModule = vi.fn(async (absPath: string) => {
	if (absPath.endsWith("dist/upstream.js")) return { default: validProvider };
	if (absPath.endsWith("dist/tools.js")) return { default: async () => {} };
	throw new Error(`no stub module for ${absPath}`);
});

let uiDir: string;
let projectDir: string;

beforeAll(async () => {
	projectDir = await mkdtemp(join(tmpdir(), "agent-surface-test-"));
	uiDir = join(projectDir, "public");
	await mkdir(uiDir, { recursive: true });
	await writeFile(join(uiDir, "index.html"), "<h1>demo ui</h1>");
	await writeFile(join(uiDir, "app.css"), "body{}");
});

afterAll(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

function makeHost(): AgentSurfaceHost {
	const mcpAgent: AgentEntry = {
		id: "demo",
		name: "Demo",
		projectPath: projectDir,
		kind: "mcp-agent",
	} as AgentEntry;
	const uiOnlyAgent: AgentEntry = {
		id: "ui-only",
		name: "UI Only",
		projectPath: projectDir,
		kind: "mcp-agent",
	} as AgentEntry;
	const brokenAgent: AgentEntry = {
		id: "broken",
		name: "Broken",
		projectPath: projectDir,
		kind: "mcp-agent",
	} as AgentEntry;
	const bareAgent: AgentEntry = {
		id: "bare",
		name: "Bare",
		projectPath: projectDir,
		kind: "mcp-agent",
	} as AgentEntry;
	const normalAgent: AgentEntry = {
		id: "normal",
		name: "Normal",
		projectPath: projectDir,
	} as AgentEntry;

	const demoManifest = {
		name: "demo-agent",
		publicMcp: true,
		publicRoutes: [],
		publicUiDir: "public",
		publicAuth: {
			kind: "oauth-server",
			upstreamProvider: "dist/upstream.js",
			registerTools: "dist/tools.js",
		},
	} as AgentManifest;

	const uiOnlyManifest = {
		name: "ui-only-agent",
		publicMcp: false,
		publicRoutes: [],
		publicUiDir: "public",
	} as AgentManifest;

	const agents: Record<string, AgentEntry> = {
		demo: mcpAgent,
		"ui-only": uiOnlyAgent,
		broken: brokenAgent,
		bare: bareAgent,
		normal: normalAgent,
	};

	return {
		getAgent: (id) => agents[id],
		getMcpAgents: async () => ({
			mcpAgents: [
				{ agent: mcpAgent, manifest: demoManifest, path: join(projectDir, "agent-manifest.json") },
				{ agent: uiOnlyAgent, manifest: uiOnlyManifest, path: join(projectDir, "agent-manifest.json") },
			],
			unmanifested: [bareAgent],
			errors: [{ agent: brokenAgent, error: "publicMcp is true but publicAuth is missing" }],
		}),
	};
}

function makeSurface() {
	return createAgentSurface(makeHost(), {
		importModule: stubImportModule,
		warn: () => {},
	});
}

describe("createAgentSurface — MCP mount (un-501)", () => {
	it("serves a real mcp-serve handler on /agents/<id>/mcp (401 challenge, not 501)", async () => {
		const surface = makeSurface();
		const { res, status, header } = fakeRes();

		const handled = await surface.handle(fakeReq("GET", "/agents/demo/mcp"), res, "/agents/demo/mcp");

		expect(handled).toBe(true);
		expect(status()).toBe(401);
		expect(header("WWW-Authenticate")).toContain(
			"http://localhost:7430/agents/demo/.well-known/oauth-protected-resource",
		);
	});

	it("serves suffix-style AS metadata under the agent prefix", async () => {
		const surface = makeSurface();
		const { res, status, json } = fakeRes();

		await surface.handle(
			fakeReq("GET", "/agents/demo/.well-known/oauth-authorization-server"),
			res,
			"/agents/demo/.well-known/oauth-authorization-server",
		);

		expect(status()).toBe(200);
		expect(json().authorization_endpoint).toBe(
			"http://localhost:7430/agents/demo/oauth/authorize",
		);
	});

	it("routes RFC 8414 path-inserted discovery URLs into the agent's mount", async () => {
		const surface = makeSurface();

		const asMeta = fakeRes();
		await surface.handle(
			fakeReq("GET", "/.well-known/oauth-authorization-server/agents/demo"),
			asMeta.res,
			"/.well-known/oauth-authorization-server/agents/demo",
		);
		expect(asMeta.status()).toBe(200);
		expect(asMeta.json().issuer).toBe("http://localhost:7430/agents/demo");

		const prMeta = fakeRes();
		await surface.handle(
			fakeReq("GET", "/.well-known/oauth-protected-resource/agents/demo/mcp"),
			prMeta.res,
			"/.well-known/oauth-protected-resource/agents/demo/mcp",
		);
		expect(prMeta.status()).toBe(200);
		expect(prMeta.json().authorization_servers).toEqual([
			"http://localhost:7430/agents/demo",
		]);
	});

	it("returns 404 for path-inserted discovery of an unknown agent", async () => {
		const surface = makeSurface();
		const { res, status, json } = fakeRes();

		const handled = await surface.handle(
			fakeReq("GET", "/.well-known/oauth-authorization-server/agents/nope"),
			res,
			"/.well-known/oauth-authorization-server/agents/nope",
		);

		expect(handled).toBe(true);
		expect(status()).toBe(404);
		expect(json().error).toBe("UNKNOWN_AGENT");
	});

	it("caches the resolved mount per agent (modules import once)", async () => {
		stubImportModule.mockClear();
		const surface = makeSurface();

		const r1 = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/demo/mcp"), r1.res, "/agents/demo/mcp");
		const r2 = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/demo/mcp"), r2.res, "/agents/demo/mcp");

		const upstreamLoads = stubImportModule.mock.calls.filter(([p]) =>
			p.endsWith("dist/upstream.js"),
		);
		expect(upstreamLoads).toHaveLength(1);
	});
});

describe("createAgentSurface — agents without MCP configuration", () => {
	it("answers /mcp with a clear MCP_NOT_ENABLED error when publicMcp is false", async () => {
		const surface = makeSurface();
		const { res, status, json } = fakeRes();

		const handled = await surface.handle(
			fakeReq("GET", "/agents/ui-only/mcp"),
			res,
			"/agents/ui-only/mcp",
		);

		expect(handled).toBe(true);
		expect(status()).toBe(404);
		expect(json().error).toBe("MCP_NOT_ENABLED");
		expect(json().message).toContain("publicMcp");
	});

	it("keeps the existing manifest errors: invalid manifest → 422, missing → 503", async () => {
		const surface = makeSurface();

		const invalid = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/broken/mcp"), invalid.res, "/agents/broken/mcp");
		expect(invalid.status()).toBe(422);
		expect(invalid.json().error).toBe("MANIFEST_INVALID");

		const missing = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/bare/mcp"), missing.res, "/agents/bare/mcp");
		expect(missing.status()).toBe(503);
		expect(missing.json().error).toBe("MANIFEST_NOT_FOUND");
	});
});

describe("createAgentSurface — manifest + static UI (unchanged behavior)", () => {
	it("serves manifest.json", async () => {
		const surface = makeSurface();
		const { res, status, json } = fakeRes();

		await surface.handle(fakeReq("GET", "/agents/demo/manifest.json"), res, "/agents/demo/manifest.json");

		expect(status()).toBe(200);
		expect(json().name).toBe("demo-agent");
	});

	it("serves index.html at the agent root and assets by path", async () => {
		const surface = makeSurface();

		const root = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/demo"), root.res, "/agents/demo");
		expect(root.status()).toBe(200);
		expect(root.header("Content-Type")).toContain("text/html");
		expect(root.body()).toContain("demo ui");

		const css = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/demo/app.css"), css.res, "/agents/demo/app.css");
		expect(css.status()).toBe(200);
		expect(css.header("Content-Type")).toContain("text/css");
	});

	it("still rejects path traversal and missing files", async () => {
		const surface = makeSurface();

		const traversal = fakeRes();
		await surface.handle(
			fakeReq("GET", "/agents/demo/..%2Fsecret"),
			traversal.res,
			"/agents/demo/../secret",
		);
		expect(traversal.status()).toBe(400);

		const missing = fakeRes();
		await surface.handle(fakeReq("GET", "/agents/demo/nope.png"), missing.res, "/agents/demo/nope.png");
		expect(missing.status()).toBe(404);
	});

	it("falls through (returns false) for non-mcp agents and non-agent paths", async () => {
		const surface = makeSurface();
		const { res } = fakeRes();

		expect(await surface.handle(fakeReq("GET", "/agents/normal/mcp"), res, "/agents/normal/mcp")).toBe(false);
		expect(await surface.handle(fakeReq("GET", "/agents/missing"), res, "/agents/missing")).toBe(false);
		expect(await surface.handle(fakeReq("GET", "/api/health"), res, "/api/health")).toBe(false);
	});
});
