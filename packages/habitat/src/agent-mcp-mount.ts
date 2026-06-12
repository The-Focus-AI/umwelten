/**
 * agent-mcp-mount — resolve an mcp-agent's manifest into a live mcp-serve mount.
 *
 * The manifest (identity/agent-manifest.ts) declares the mcp-serve
 * configuration declaratively:
 *   publicAuth.upstreamProvider — JS module exporting an UpstreamOAuthProvider
 *                                 (`default` or `provider`)
 *   publicAuth.registerTools    — JS module exporting an McpToolRegistrar
 *                                 (`default` or `registerTools`)
 *   publicAuth.store            — neon | sqlite | omitted (in-memory)
 *
 * This module turns that into a McpServeMount the container server can
 * dispatch requests to. Failures are returned as structured errors (never
 * thrown) so the host can answer with a clear JSON response instead of
 * crashing the request loop.
 *
 * Deps (module import, Neon store construction) are injectable so unit
 * tests can stub the framework store and avoid touching the filesystem.
 */

import { pathToFileURL } from "node:url";
import {
	createMcpServeMount,
	MemoryStore,
	NeonStore,
	type McpServeMount,
	type McpServeStore,
	type McpToolRegistrar,
	type UpstreamOAuthProvider,
} from "@umwelten/protocols";
import {
	resolveManifestPath,
	type AgentManifest,
} from "./identity/agent-manifest.js";

export interface AgentMcpMountError {
	/** Stable machine-readable code, e.g. "MCP_NOT_ENABLED". */
	error: string;
	/** Human-readable explanation with enough detail to fix the manifest. */
	message: string;
	/** Suggested HTTP status for the host to respond with. */
	status: number;
}

export type AgentMcpMountResult =
	| { ok: true; mount: McpServeMount }
	| { ok: false; error: AgentMcpMountError };

export interface AgentMcpMountDeps {
	/** Import a JS module by absolute path. Default: dynamic import(). */
	importModule?: (absPath: string) => Promise<Record<string, unknown>>;
	/** Construct the Neon-backed store. Default: new NeonStore(conn). */
	createNeonStore?: (connectionString: string) => McpServeStore;
	/** Construct the fallback in-memory store. Default: new MemoryStore(). */
	createMemoryStore?: () => McpServeStore;
	/** Warning sink. Default: console.warn. */
	warn?: (message: string) => void;
}

function err(error: string, message: string, status: number): AgentMcpMountResult {
	return { ok: false, error: { error, message, status } };
}

async function defaultImportModule(absPath: string): Promise<Record<string, unknown>> {
	return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;
}

function looksLikeUpstreamProvider(value: unknown): value is UpstreamOAuthProvider {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.name === "string" &&
		typeof v.buildAuthorizeUrl === "function" &&
		typeof v.exchangeCode === "function" &&
		typeof v.refreshToken === "function"
	);
}

/**
 * Resolve a manifest into a ready-to-serve McpServeMount.
 *
 * @param agentId     - the agent's id (used in error messages / server name)
 * @param projectPath - the agent's repo root; manifest paths resolve against it
 * @param manifest    - the already-validated agent manifest
 */
export async function resolveAgentMcpMount(
	agentId: string,
	projectPath: string,
	manifest: AgentManifest,
	deps: AgentMcpMountDeps = {},
): Promise<AgentMcpMountResult> {
	const importModule = deps.importModule ?? defaultImportModule;
	const warn = deps.warn ?? ((m: string) => console.warn(m));

	if (!manifest.publicMcp) {
		return err(
			"MCP_NOT_ENABLED",
			`agent "${agentId}" does not expose an MCP endpoint — its manifest has publicMcp: false (or unset).`,
			404,
		);
	}

	const auth = manifest.publicAuth;
	if (!auth) {
		// parseAgentManifest enforces this; guard anyway for manifests built in code.
		return err(
			"MCP_AUTH_MISSING",
			`agent "${agentId}" has publicMcp: true but no publicAuth oauth-server configuration.`,
			422,
		);
	}

	// ── Upstream OAuth provider module ────────────────────────────
	const providerPath = resolveManifestPath(projectPath, auth.upstreamProvider);
	let providerModule: Record<string, unknown>;
	try {
		providerModule = await importModule(providerPath);
	} catch (e) {
		return err(
			"UPSTREAM_PROVIDER_LOAD_FAILED",
			`agent "${agentId}": failed to load upstreamProvider module ${auth.upstreamProvider} (${providerPath}): ${e instanceof Error ? e.message : String(e)}`,
			422,
		);
	}
	const upstream = providerModule.default ?? providerModule.provider;
	if (!looksLikeUpstreamProvider(upstream)) {
		return err(
			"UPSTREAM_PROVIDER_INVALID",
			`agent "${agentId}": ${auth.upstreamProvider} must export an UpstreamOAuthProvider (name, buildAuthorizeUrl, exchangeCode, refreshToken) as \`default\` or \`provider\`.`,
			422,
		);
	}

	// ── Tool registrar module ─────────────────────────────────────
	const registrarPath = resolveManifestPath(projectPath, auth.registerTools);
	let registrarModule: Record<string, unknown>;
	try {
		registrarModule = await importModule(registrarPath);
	} catch (e) {
		return err(
			"REGISTER_TOOLS_LOAD_FAILED",
			`agent "${agentId}": failed to load registerTools module ${auth.registerTools} (${registrarPath}): ${e instanceof Error ? e.message : String(e)}`,
			422,
		);
	}
	const registerTools = registrarModule.default ?? registrarModule.registerTools;
	if (typeof registerTools !== "function") {
		return err(
			"REGISTER_TOOLS_INVALID",
			`agent "${agentId}": ${auth.registerTools} must export an McpToolRegistrar function as \`default\` or \`registerTools\`.`,
			422,
		);
	}

	// ── Store ─────────────────────────────────────────────────────
	let store: McpServeStore;
	if (!auth.store) {
		store = deps.createMemoryStore ? deps.createMemoryStore() : new MemoryStore();
		warn(
			`[agent-mcp-mount] agent "${agentId}": no store configured — using in-memory OAuth state (lost on restart). Configure publicAuth.store for persistence.`,
		);
	} else if (auth.store.driver === "neon") {
		const conn = process.env[auth.store.envRef];
		if (!conn) {
			return err(
				"STORE_ENV_MISSING",
				`agent "${agentId}": store driver "neon" reads the connection string from env var ${auth.store.envRef}, which is not set.`,
				422,
			);
		}
		store = deps.createNeonStore
			? deps.createNeonStore(conn)
			: new NeonStore(conn);
	} else {
		return err(
			"STORE_DRIVER_UNSUPPORTED",
			`agent "${agentId}": store driver "${auth.store.driver}" is not implemented yet — use driver "neon" or omit store for in-memory state.`,
			422,
		);
	}

	const mount = createMcpServeMount({
		name: manifest.name,
		version: manifest.version,
		upstream,
		registerTools: registerTools as McpToolRegistrar,
		store,
	});

	return { ok: true, mount };
}
