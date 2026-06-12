/**
 * Gaia API route handlers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GaiaRegistryManager } from "./registry.js";
import type { GaiaSecretVault } from "./secrets.js";
import type { DockerManager } from "./docker.js";
import type { CredentialCatalog } from "./credential-catalog.js";
import type { CredentialAuditLogger } from "./credential-audit.js";
import { proxyRequest, fetchFromContainer } from "./proxy.js";
import { buildSeedFiles, runStandardsAudit } from "./gaia-tools.js";
import { CapabilityResolver } from "./capability-resolver.js";
import type { AuditSummary } from "./gaia-tools.js";

/** In-memory store for the most recent audit results (ephemeral). */
let latestAudit: AuditSummary | null = null;

// ── Capability gap state ─────────────────────────────────────────

type GapStatus = "pending" | "dismissed" | "ignored";

interface GaiaCapabilityGap {
	habitatId: string;
	habitatName: string;
	capability: string;
	source: "skill" | "runtime";
	severity: "critical" | "optional";
	context: string;
	timestamp: string;
	status: GapStatus;
	dismissalReason?: string;
}

/** Dismissed/ignored gaps keyed by `habitatId:capability`. */
const gapDecisions = new Map<
	string,
	{ status: "dismissed" | "ignored"; reason?: string }
>();

export interface GaiaRouteContext {
	registry: GaiaRegistryManager;
	vault: GaiaSecretVault;
	docker: DockerManager;
	catalog: CredentialCatalog;
	audit: CredentialAuditLogger;
}

function parseUrl(url: string): {
	path: string;
	query: Record<string, string>;
} {
	const [path, qs] = url.split("?", 2);
	const query: Record<string, string> = {};
	if (qs) {
		for (const pair of qs.split("&")) {
			const [k, v] = pair.split("=", 2);
			if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
		}
	}
	return { path: path ?? "/", query };
}

function matchRoute(
	pattern: string,
	path: string,
): Record<string, string> | null {
	// Handle wildcard patterns like /api/habitats/:id/files/*
	const hasWildcard = pattern.endsWith("/*");
	const cleanPattern = hasWildcard ? pattern.slice(0, -2) : pattern;

	const patternParts = cleanPattern.split("/").filter(Boolean);
	const pathParts = path.split("/").filter(Boolean);

	if (!hasWildcard && patternParts.length !== pathParts.length) return null;
	if (hasWildcard && pathParts.length < patternParts.length) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < patternParts.length; i++) {
		const p = patternParts[i];
		if (p.startsWith(":")) {
			params[p.slice(1)] = decodeURIComponent(pathParts[i]);
		} else if (p !== pathParts[i]) {
			return null;
		}
	}

	if (hasWildcard) {
		params["*"] = pathParts.slice(patternParts.length).join("/");
	}

	return params;
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-cache",
	});
	res.end(JSON.stringify(data));
}

/**
 * Proxy allowlist: /api/habitats/:id/<route> → path on the container.
 * Wildcard patterns (`/*`) append the remainder to the target.
 */
const PROXY_ROUTES: Array<{ pattern: string; target: string }> = [
	{ pattern: "/api/habitats/:id/health", target: "/health" },
	{ pattern: "/api/habitats/:id/chat", target: "/api/chat" },
	{ pattern: "/api/habitats/:id/mcp", target: "/mcp" },
	{ pattern: "/api/habitats/:id/a2a", target: "/a2a" },
	{
		pattern: "/api/habitats/:id/agent-card",
		target: "/.well-known/agent-card.json",
	},
	{ pattern: "/api/habitats/:id/status", target: "/api/status" },
	{ pattern: "/api/habitats/:id/sessions", target: "/api/sessions" },
	{ pattern: "/api/habitats/:id/sessions/*", target: "/api/sessions/" },
	{ pattern: "/api/habitats/:id/artifacts", target: "/api/artifacts" },
	{ pattern: "/api/habitats/:id/contexts/*", target: "/api/contexts/" },
	{ pattern: "/api/habitats/:id/files/*", target: "/files/" },
];

/**
 * Pure mapping from an incoming Gaia path to the habitat entry id and the
 * container-side target path, or null when the path is not proxied.
 */
export function resolveProxyTarget(
	path: string,
): { id: string; targetPath: string } | null {
	for (const route of PROXY_ROUTES) {
		const params = matchRoute(route.pattern, path);
		if (!params) continue;
		const targetPath = route.pattern.endsWith("/*")
			? `${route.target}${params["*"] ?? ""}`
			: route.target;
		return { id: params.id, targetPath };
	}
	return null;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

/**
 * Handle Gaia API routes. Returns true if the route was handled.
 */
export async function handleGaiaRoute(
	ctx: GaiaRouteContext,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const { path, query } = parseUrl(req.url ?? "/");
	const method = req.method ?? "GET";

	// ── Registry routes ──────────────────────────────────────────

	// GET /api/habitats — list all habitats with status
	if (path === "/api/habitats" && method === "GET") {
		const entries = ctx.registry.list();
		const results = await Promise.all(
			entries.map(async (entry) => {
				const status = await ctx.docker.getStatus(entry.id);
				// Attach credential metadata for UI rendering
				const caps = entry.config?.capabilities || [];
				const _credMeta: Record<string, { provider: string; status: string }> =
					{};
				if (ctx.catalog) {
					for (const b of caps) {
						const cred = ctx.catalog.get(b.credential);
						_credMeta[b.credential] = {
							provider: cred?.provider ?? "unknown",
							status: cred?.status ?? "not-in-catalog",
						};
					}
				}
				return {
					...entry,
					apiKey: undefined,
					containerStatus: status,
					_credMeta,
				};
			}),
		);
		sendJson(res, { habitats: results });
		return true;
	}

	// POST /api/habitats — create new habitat
	if (path === "/api/habitats" && method === "POST") {
		const body = JSON.parse(await readBody(req));
		try {
			const entry = await ctx.registry.create(body);
			// Seed the Docker volume with config + secrets
			await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
			sendJson(res, entry, 201);
		} catch (err: any) {
			sendJson(res, { error: err.message }, 400);
		}
		return true;
	}

	// GET /api/habitats/:id
	let params = matchRoute("/api/habitats/:id", path);
	if (params && method === "GET") {
		const entry = ctx.registry.get(params.id);
		if (!entry) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		const status = await ctx.docker.getStatus(entry.id);
		sendJson(res, { ...entry, apiKey: undefined, containerStatus: status });
		return true;
	}

	// PUT /api/habitats/:id
	params = matchRoute("/api/habitats/:id", path);
	if (params && method === "PUT") {
		const body = JSON.parse(await readBody(req));
		try {
			const entry = await ctx.registry.update(params.id, body);
			sendJson(res, entry);
		} catch (err: any) {
			sendJson(res, { error: err.message }, 400);
		}
		return true;
	}

	// DELETE /api/habitats/:id
	params = matchRoute("/api/habitats/:id", path);
	if (params && method === "DELETE") {
		await ctx.docker.stopContainer(params.id).catch(() => {});
		const removed = await ctx.registry.remove(params.id);
		if (!removed) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		sendJson(res, { removed: true, id: params.id });
		return true;
	}

	// ── Docker lifecycle ─────────────────────────────────────────

	// POST /api/habitats/:id/start
	params = matchRoute("/api/habitats/:id/start", path);
	if (params && method === "POST") {
		const entry = ctx.registry.get(params.id);
		if (!entry) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		try {
			await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
			const port = await ctx.docker.startContainer(
				entry,
				"",
				ctx.registry.list(),
			);
			await ctx.registry.update(params.id, { containerPort: port });
			sendJson(res, { started: true, port });
		} catch (err: any) {
			sendJson(res, { error: err.message }, 500);
		}
		return true;
	}

	// POST /api/habitats/:id/stop
	params = matchRoute("/api/habitats/:id/stop", path);
	if (params && method === "POST") {
		const entry = ctx.registry.get(params.id);
		if (!entry) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		await ctx.docker.stopContainer(params.id);
		await ctx.registry.update(params.id, { containerPort: undefined });
		sendJson(res, { stopped: true });
		return true;
	}

	// POST /api/habitats/:id/rebuild
	params = matchRoute("/api/habitats/:id/rebuild", path);
	if (params && method === "POST") {
		const entry = ctx.registry.get(params.id);
		if (!entry) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		await ctx.docker.stopContainer(params.id).catch(() => {});
		await ctx.docker.seedVolume(entry.id, buildSeedFiles(entry, ctx.vault));
		const port = await ctx.docker.startContainer(
			entry,
			"",
			ctx.registry.list(),
		);
		await ctx.registry.update(params.id, { containerPort: port });
		sendJson(res, { rebuilt: true, port });
		return true;
	}

	// GET /api/habitats/:id/logs
	params = matchRoute("/api/habitats/:id/logs", path);
	if (params && method === "GET") {
		const tail = parseInt(query.tail ?? "100", 10);
		const logs = await ctx.docker.getLogs(params.id, tail);
		sendJson(res, { logs });
		return true;
	}

	// ── Proxy to running containers ──────────────────────────────

	// Map /api/habitats/:id/<target> → /<targetPath> on container
	const proxied = resolveProxyTarget(path);
	if (proxied) {
		const entry = ctx.registry.get(proxied.id);
		if (!entry) {
			sendJson(res, { error: "Not found" }, 404);
			return true;
		}
		await proxyRequest(entry, proxied.targetPath, req, res);
		return true;
	}

	// ── Master secrets ───────────────────────────────────────────

	// GET /api/secrets
	if (path === "/api/secrets" && method === "GET") {
		const names = ctx.vault.listNames();
		const entries = ctx.registry.list();
		const secretUsage = names.map((name) => ({
			name,
			usedBy: entries
				.filter((e) => e.secretBindings.includes(name))
				.map((e) => e.id),
		}));
		sendJson(res, { secrets: secretUsage });
		return true;
	}

	// POST /api/secrets
	if (path === "/api/secrets" && method === "POST") {
		const body = JSON.parse(await readBody(req));
		if (!body.name || !body.value) {
			sendJson(res, { error: "name and value required" }, 400);
			return true;
		}
		await ctx.vault.set(body.name, body.value);
		sendJson(res, { set: true, name: body.name });
		return true;
	}

	// DELETE /api/secrets/:name
	params = matchRoute("/api/secrets/:name", path);
	if (params && method === "DELETE") {
		const removed = await ctx.vault.remove(params.name);
		sendJson(res, { removed, name: params.name });
		return true;
	}

	// ── Credential audit log ─────────────────────────────────────

	// GET /api/audit — read the credential audit log
	if (path === "/api/audit" && method === "GET") {
		const n = parseInt(query.n ?? "50", 10);
		const entries = await ctx.audit.read(n);
		sendJson(res, { entries, count: entries.length });
		return true;
	}

	// ── Docker image ─────────────────────────────────────────────

	// POST /api/docker/build
	if (path === "/api/docker/build" && method === "POST") {
		try {
			const output = await ctx.docker.buildImage();
			sendJson(res, { success: true, output: output.slice(-2000) });
		} catch (err: any) {
			sendJson(res, { error: err.message }, 500);
		}
		return true;
	}

	// GET /api/docker/status
	if (path === "/api/docker/status" && method === "GET") {
		const available = await ctx.docker.isDockerAvailable();
		const imageExists = available ? await ctx.docker.imageExists() : false;
		sendJson(res, { dockerAvailable: available, imageExists });
		return true;
	}

	// ── Standards audit ─────────────────────────────────────────

	// GET /api/standards-audit/latest — get most recent audit results
	if (path === "/api/standards-audit/latest" && method === "GET") {
		if (!latestAudit) {
			sendJson(res, {
				audit: null,
				message: "No audits yet. Run one to check compliance.",
			});
			return true;
		}
		sendJson(res, { audit: latestAudit });
		return true;
	}

	// POST /api/standards-audit — trigger a new audit
	if (path === "/api/standards-audit" && method === "POST") {
		const body = JSON.parse(await readBody(req));
		const habitatId =
			typeof body.habitatId === "string" ? body.habitatId : undefined;

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		try {
			const summary = await runStandardsAudit(
				{ registry: ctx.registry, docker: ctx.docker },
				{ habitatId },
			);
			latestAudit = summary;
			res.write(`data: ${JSON.stringify({ type: "done", summary })}\n\n`);
		} catch (err: any) {
			res.write(
				`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`,
			);
		}
		res.end();
		return true;
	}

	// ── Capability Gaps ────────────────────────────────────────────

	// GET /api/capability-gaps — aggregate gaps from all habitats
	if (path === "/api/capability-gaps" && method === "GET") {
		const entries = ctx.registry.list();
		const gaps: GaiaCapabilityGap[] = [];

		for (const entry of entries) {
			// Runtime gaps: poll running habitat's GET /api/capability-gaps
			if (entry.containerPort) {
				const status = await ctx.docker.getStatus(entry.id);
				if (status === "running") {
					try {
						const res = await fetchFromContainer<{
							gaps: Array<{
								capability: string;
								context: string;
								timestamp: string;
							}>;
						}>(entry, "/api/capability-gaps");
						for (const g of res.gaps ?? []) {
							const key = `${entry.id}:${g.capability}`;
							const decision = gapDecisions.get(key);
							gaps.push({
								habitatId: entry.id,
								habitatName: entry.name,
								capability: g.capability,
								source: "runtime",
								severity: "optional",
								context: g.context || "reported by habitat at runtime",
								timestamp: g.timestamp,
								status: decision?.status ?? "pending",
								dismissalReason: decision?.reason,
							});
						}
					} catch {
						// container unreachable — skip
					}
				}
			}
		}

		sendJson(res, { gaps });
		return true;
	}

	// GET /api/credentials/:capability — list credentials that satisfy a capability
	{
		const m = path.match(/^\/api\/credentials\/([^/]+)$/);
		if (m && method === "GET") {
			const entries = ctx.catalog.listByCapability(m[1]);
			sendJson(res, {
				capability: m[1],
				credentials: entries.map((e) => ({
					name: e.name,
					label: e.label,
					provider: e.provider,
					capabilities: e.capabilities,
					status: e.status,
					hasSecret: !!ctx.vault.get(e.name),
				})),
			});
			return true;
		}
	}

	// POST /api/capability-gaps/:habitatId/grant — grant a capability
	{
		const m = path.match(/^\/api\/capability-gaps\/([^/]+)\/grant$/);
		if (m && method === "POST") {
			const body = JSON.parse(await readBody(req));
			const capability: string = body.capability ?? "";
			const credential: string = body.credential ?? "";
			const habitatId = m[1];

			if (!capability || !credential) {
				sendJson(res, { error: "capability and credential required" }, 400);
				return true;
			}

			const entry = ctx.registry.get(habitatId);
			if (!entry) {
				sendJson(res, { error: "Habitat not found" }, 404);
				return true;
			}

			// Validate the credential grants the capability
			const resolver = new CapabilityResolver();
			try {
				resolver.validate({ capability, credential }, ctx.catalog);
			} catch (err: any) {
				sendJson(res, { error: `Validation failed: ${err.message}` }, 400);
				return true;
			}

			// Check for duplicate binding
			if (!entry.config.capabilities) entry.config.capabilities = [];
			const exists = entry.config.capabilities.find(
				(b) => b.capability === capability && b.credential === credential,
			);
			if (exists) {
				// Already bound — just dismiss the gap
				const key = `${habitatId}:${capability}`;
				gapDecisions.set(key, { status: "dismissed", reason: "granted" });
				sendJson(res, {
					granted: true,
					alreadyBound: true,
					habitatId,
					capability,
				});
				return true;
			}

			// Add the binding
			entry.config.capabilities.push({ capability, credential });
			await ctx.registry.update(habitatId, { config: entry.config });
			// Re-seed volume
			await ctx.docker.seedVolume(
				habitatId,
				buildSeedFiles(entry, ctx.vault, ctx.catalog),
			);

			// Mark gap as dismissed
			const key = `${habitatId}:${capability}`;
			gapDecisions.set(key, { status: "dismissed", reason: "granted" });

			const status = await ctx.docker.getStatus(habitatId);
			sendJson(res, {
				granted: true,
				habitatId,
				capability,
				credential,
				needsRebuild: status === "running",
			});
			return true;
		}
	}

	// POST /api/capability-gaps/:habitatId/deny — dismiss a gap
	{
		const m = path.match(/^\/api\/capability-gaps\/([^/]+)\/deny$/);
		if (m && method === "POST") {
			const body = JSON.parse(await readBody(req));
			const capability: string = body.capability ?? "";
			const reason: string = body.reason ?? "";
			const habitatId = m[1];

			if (!capability) {
				sendJson(res, { error: "capability required" }, 400);
				return true;
			}

			const key = `${habitatId}:${capability}`;
			gapDecisions.set(key, {
				status: "dismissed",
				reason: reason || undefined,
			});
			sendJson(res, { denied: true, habitatId, capability });
			return true;
		}
	}

	// POST /api/capability-gaps/:habitatId/ignore — ignore a gap
	{
		const m = path.match(/^\/api\/capability-gaps\/([^/]+)\/ignore$/);
		if (m && method === "POST") {
			const body = JSON.parse(await readBody(req));
			const capability: string = body.capability ?? "";
			const habitatId = m[1];

			if (!capability) {
				sendJson(res, { error: "capability required" }, 400);
				return true;
			}

			const key = `${habitatId}:${capability}`;
			gapDecisions.set(key, { status: "ignored" });
			sendJson(res, { ignored: true, habitatId, capability });
			return true;
		}
	}

	return false;
}
