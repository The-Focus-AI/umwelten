/**
 * agent-surface — the /agents/<id>/... public surface of the container server.
 *
 * Serves, per mcp-agent:
 *   /agents/<id>/manifest.json   → the validated agent-manifest.json
 *   /agents/<id>/mcp             → mcp-serve OAuth 2.1 MCP endpoint (when publicMcp)
 *   /agents/<id>/oauth/*         → the mount's OAuth endpoints
 *   /agents/<id>/.well-known/*   → suffix-style OAuth metadata
 *   /agents/<id>/<file>          → static files under manifest.publicUiDir
 *
 * Plus the RFC 8414 path-inserted discovery URLs at the host root, which
 * MCP SDK clients require for a path-bearing issuer (they never try the
 * suffix form for authorization-server metadata):
 *   /.well-known/oauth-authorization-server/agents/<id>
 *   /.well-known/oauth-protected-resource/agents/<id>[/mcp]
 *
 * This surface is intentionally NOT gated by HABITAT_API_KEY: the mount's
 * own OAuth layer authenticates /mcp, and the UI, manifest, and OAuth
 * endpoints must be publicly reachable for the connector flow to work.
 * The habitat's own bearer-only /mcp endpoint is unaffected.
 *
 * Extracted from startContainerServer so the routing is unit-testable
 * against a minimal host stub.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import {
	getPublicBaseUrl,
	isMcpServeMountPath,
	type McpServeMount,
} from "@umwelten/protocols";
import type { AgentManifest } from "./identity/agent-manifest.js";
import type { AgentEntry } from "./types.js";
import {
	resolveAgentMcpMount,
	type AgentMcpMountDeps,
} from "./agent-mcp-mount.js";

/** The slice of Habitat the agent surface needs. */
export interface AgentSurfaceHost {
	getAgent(idOrName: string): AgentEntry | undefined;
	getMcpAgents(): Promise<{
		mcpAgents: { agent: AgentEntry; manifest: AgentManifest; path: string }[];
		unmanifested: AgentEntry[];
		errors: { agent: AgentEntry; error: string }[];
	}>;
}

export interface AgentSurface {
	/**
	 * Handle a request if it belongs to the agent surface.
	 * @param path - URL pathname (query already stripped)
	 * @returns true if the request was handled (response sent)
	 */
	handle(
		req: IncomingMessage,
		res: ServerResponse,
		path: string,
	): Promise<boolean>;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-cache",
	});
	res.end(JSON.stringify(data));
}

const PATH_INSERTED_WELL_KNOWN =
	/^\/\.well-known\/(oauth-protected-resource|oauth-authorization-server)\/agents\/([^/]+)(\/mcp)?$/;
const AGENT_PATH = /^\/agents\/([^/]+)(?:\/(.*))?$/;

export function createAgentSurface(
	host: AgentSurfaceHost,
	mountDeps: AgentMcpMountDeps = {},
): AgentSurface {
	// Resolved mounts are cached per agent id (module import + store
	// construction happen once). Resolution errors are NOT cached so a
	// fixed manifest or env var heals on the next request.
	const mounts = new Map<string, McpServeMount>();

	async function dispatchToMount(
		req: IncomingMessage,
		res: ServerResponse,
		agentId: string,
		agent: AgentEntry,
		manifest: AgentManifest,
		subPath: string,
	): Promise<void> {
		let mount = mounts.get(agentId);
		if (!mount) {
			const result = await resolveAgentMcpMount(
				agentId,
				agent.projectPath,
				manifest,
				mountDeps,
			);
			if (!result.ok) {
				sendJson(
					res,
					{ error: result.error.error, agentId, message: result.error.message },
					result.error.status,
				);
				return;
			}
			mount = result.mount;
			mounts.set(agentId, mount);
		}

		const baseUrl = `${getPublicBaseUrl(req)}/agents/${agentId}`;
		const handled = await mount.handle(req, res, subPath, baseUrl);
		if (!handled) {
			sendJson(res, { error: "NOT_FOUND", agentId, subPath }, 404);
		}
	}

	return {
		async handle(req, res, path) {
			// RFC 8414 path-inserted discovery at the host root.
			let agentId: string;
			let subPath: string;
			const wellKnown = path.match(PATH_INSERTED_WELL_KNOWN);
			if (wellKnown) {
				agentId = wellKnown[2];
				subPath = `.well-known/${wellKnown[1]}`;
			} else {
				const m = path.match(AGENT_PATH);
				if (!m) return false;
				agentId = m[1];
				subPath = m[2] ?? "";
			}

			const agent = host.getAgent(agentId);
			if (!agent || agent.kind !== "mcp-agent") {
				// Path-inserted well-known URLs belong to this surface even when
				// the agent is unknown; /agents/<id> falls through as before.
				if (wellKnown) {
					sendJson(res, { error: "UNKNOWN_AGENT", agentId }, 404);
					return true;
				}
				return false;
			}

			const all = await host.getMcpAgents();
			const found = all.mcpAgents.find((x) => x.agent.id === agentId);
			const manifestErr = all.errors.find((e) => e.agent.id === agentId);

			if (!found) {
				sendJson(
					res,
					{
						error: manifestErr ? "MANIFEST_INVALID" : "MANIFEST_NOT_FOUND",
						agentId,
						message:
							manifestErr?.error ??
							"agent has no agent-manifest.json (cannot mount)",
					},
					manifestErr ? 422 : 503,
				);
				return true;
			}

			// MCP / OAuth surface — reserved subpaths go to the mcp-serve mount.
			if (isMcpServeMountPath(subPath)) {
				if (!found.manifest.publicMcp) {
					if (subPath === "mcp") {
						sendJson(
							res,
							{
								error: "MCP_NOT_ENABLED",
								agentId,
								message: `agent "${agentId}" does not expose an MCP endpoint — its manifest has publicMcp: false (or unset).`,
							},
							404,
						);
						return true;
					}
					// Not an MCP agent surface — let oauth/.well-known names fall
					// through to the static UI below.
				} else {
					await dispatchToMount(req, res, agentId, agent, found.manifest, subPath);
					return true;
				}
			}

			if (subPath === "manifest.json") {
				sendJson(res, found.manifest);
				return true;
			}

			// Static UI passthrough — serve files under publicUiDir.
			if (req.method === "GET" && found.manifest.publicUiDir) {
				const uiRoot = resolve(agent.projectPath, found.manifest.publicUiDir);
				const fileName = subPath === "" ? "index.html" : subPath;
				if (fileName.includes("..")) {
					sendJson(res, { error: "Invalid path" }, 400);
					return true;
				}
				const absPath = resolve(uiRoot, fileName);
				if (!absPath.startsWith(uiRoot + "/") && absPath !== uiRoot) {
					sendJson(res, { error: "Path outside ui root" }, 403);
					return true;
				}
				try {
					const fileStat = await stat(absPath);
					if (fileStat.isDirectory()) {
						sendJson(res, { error: "Cannot serve directories" }, 400);
						return true;
					}
					const ext = extname(absPath).toLowerCase();
					const types: Record<string, string> = {
						".html": "text/html; charset=utf-8",
						".css": "text/css; charset=utf-8",
						".js": "application/javascript; charset=utf-8",
						".json": "application/json; charset=utf-8",
						".png": "image/png",
						".jpg": "image/jpeg",
						".svg": "image/svg+xml",
					};
					const body = await readFile(absPath);
					res.writeHead(200, {
						"Content-Type": types[ext] ?? "application/octet-stream",
						"Content-Length": body.length,
						"Cache-Control": "no-cache",
					});
					res.end(body);
				} catch (err) {
					const e = err as NodeJS.ErrnoException;
					if (e.code === "ENOENT")
						sendJson(res, { error: "File not found" }, 404);
					else sendJson(res, { error: e.message }, 500);
				}
				return true;
			}

			sendJson(res, { error: "NOT_FOUND", agentId, subPath }, 404);
			return true;
		},
	};
}
