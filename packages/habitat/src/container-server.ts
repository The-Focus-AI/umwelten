/**
 * Unified Container Server
 *
 * Single HTTP server exposing multiple protocols on one port:
 *   /mcp           → MCP (Streamable HTTP) — raw tool access, no LLM
 *   /api/chat      → AI SDK UI Message Stream — web chat with LLM
 *   /api/habitat   → Habitat info
 *   /api/sessions  → Session CRUD
 *   /files/*       → Serve files from work dir (sandboxed)
 *   /health        → Health check
 *   /              → Built-in chat UI (static)
 *
 * Auth: per-user JWT grants (HABITAT_AUTH_* — verified, sub = user id) when
 *       configured; legacy shared HABITAT_API_KEY otherwise; open in dev.
 *       /health and static UI are always open. See ADR 0003.
 */

import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAiTool } from "./mcp-tool-bridge.js";
import type { Habitat } from "./habitat.js";
import type { AgentHost } from "./types.js";
import { resolveProjectDir, saveConfig, fileExists } from "./config.js";
import { listArtifacts, toAbsoluteArtifactUrl } from "./tools/artifact-tools.js";
import { createA2AHandler, type A2AHandler } from "./a2a-handler.js";
import { runWithSpeaker } from "./identity/agent-speaker-context.js";
import { getPublicBaseUrl } from "@umwelten/protocols";
import { createAgentSurface } from "./agent-surface.js";
import { buildAgentStimulus } from "./habitat-agent.js";
import { createClaudeSdkRuntimeRunner } from "./claude-sdk-runner.js";
import { createPiRuntimeRunner } from "./pi-runner.js";
import { ChannelBridge } from "./bridge/channel-bridge.js";
import { WebAdapter } from "./web/WebAdapter.js";
import { devAuth } from "./web/auth/dev-auth.js";
import { bearerAuth } from "./web/auth/bearer-auth.js";
import { jwtAuth } from "./web/auth/jwt-auth.js";
import { compositeAuth } from "./web/auth/composite-auth.js";
import {
	parseSecretWritePrefixes,
	isSecretWriteAllowed,
} from "./web/secret-write.js";
import { buildDefaultConnectors } from "./connectors/registry.js";
import {
	startConnect,
	completeConnect,
	renderConnectLanding,
	connectExtension,
} from "./web/connect.js";
import { defaultRoutes } from "./web/routes/index.js";
import type {
	AuthProvider,
	UserContext,
	RouteContext,
	RouteHandler,
} from "./web/types.js";

export interface ContainerServerOptions {
	habitat: Habitat;
	port?: number;
	host?: string;
	name?: string;
	/** Optional raw request handler that runs before standard routing. Return true if handled. */
	extraRawHandler?: (
		req: IncomingMessage,
		res: ServerResponse,
	) => Promise<boolean>;
	/** Override the static UI directory (default: public/) */
	uiDir?: string;
}

export interface StartedContainerServer {
	port: number;
	close: () => void;
}

type AuthMode = "jwt" | "jwt+bearer" | "bearer" | "open";

/**
 * Select the request AuthProvider from the environment. See the precedence note
 * at the call site and docs/adr/0003-per-user-a2a-identity.md.
 *
 * - `HABITAT_AUTH_AUDIENCE` + (`HABITAT_AUTH_JWKS_URL` | `HABITAT_AUTH_PUBLIC_KEY`)
 *   → per-user JWT verification (production). If `HABITAT_API_KEY` is ALSO set,
 *   the habitat accepts a valid per-user JWT (identity) OR the shared bearer
 *   (service trust, e.g. Gaia's relay) — the additive ADR-0003 transition.
 * - `HABITAT_API_KEY` alone → legacy shared bearer (retiring).
 * - nothing → open dev auth (local only).
 */
function resolveAuthProvider(): { auth: AuthProvider; authMode: AuthMode } {
	const audience = process.env.HABITAT_AUTH_AUDIENCE;
	const jwksUrl = process.env.HABITAT_AUTH_JWKS_URL;
	const publicKeyPem = process.env.HABITAT_AUTH_PUBLIC_KEY;
	const apiKey = process.env.HABITAT_API_KEY;
	if (audience && (jwksUrl || publicKeyPem)) {
		const jwt = jwtAuth({
			audience,
			issuer: process.env.HABITAT_AUTH_ISSUER,
			jwksUrl,
			publicKeyPem,
		});
		// Dual-auth during the transition: JWT (identity) OR shared bearer
		// (service trust) so enabling JWT doesn't lock out Gaia's relay.
		if (apiKey) {
			return {
				auth: compositeAuth("jwt+bearer", [jwt, bearerAuth(apiKey)]),
				authMode: "jwt+bearer",
			};
		}
		return { auth: jwt, authMode: "jwt" };
	}
	// Misconfiguration guard: a key without an audience (or vice-versa) almost
	// certainly means the operator intended JWT auth — fail loud rather than
	// silently falling back to the shared key or open access.
	if (audience || jwksUrl || publicKeyPem) {
		throw new Error(
			"Incomplete JWT auth config: set HABITAT_AUTH_AUDIENCE together with " +
				"HABITAT_AUTH_JWKS_URL or HABITAT_AUTH_PUBLIC_KEY (see ADR 0003).",
		);
	}
	if (apiKey) return { auth: bearerAuth(apiKey), authMode: "bearer" };
	return { auth: devAuth(), authMode: "open" };
}

// ── Static file serving ───────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

async function serveStatic(
	staticRoot: string,
	urlPath: string,
	res: ServerResponse,
): Promise<boolean> {
	const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
	if (rel.includes("..")) return false;
	const abs = resolve(staticRoot, rel);
	try {
		const s = await stat(abs);
		if (s.isDirectory()) {
			const indexAbs = resolve(abs, "index.html");
			const idx = await stat(indexAbs).catch(() => null);
			if (!idx) return false;
			const body = await readFile(indexAbs);
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			});
			res.end(body);
			return true;
		}
		const body = await readFile(abs);
		const ext = extname(abs).toLowerCase();
		res.writeHead(200, {
			"Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
			"Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
		});
		res.end(body);
		return true;
	} catch {
		return false;
	}
}

// ── Route matching ────────────────────────────────────────────────

function parseRoute(url: string): {
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
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = path.split("/").filter(Boolean);
	if (patternParts.length !== pathParts.length) return null;
	const params: Record<string, string> = {};
	for (let i = 0; i < patternParts.length; i++) {
		const p = patternParts[i];
		if (p.startsWith(":")) {
			params[p.slice(1)] = decodeURIComponent(pathParts[i]);
		} else if (p !== pathParts[i]) {
			return null;
		}
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

/** Escape text for safe interpolation into the small connect result pages. */
function escapeHtmlText(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// ── Main server ───────────────────────────────────────────────────

export async function startContainerServer(
	options: ContainerServerOptions,
): Promise<StartedContainerServer> {
	const { habitat, port = 7430, host = "0.0.0.0", extraRawHandler } = options;
	const serverName = options.name ?? habitat.getConfig().name ?? "habitat";

	// Tools for MCP
	const tools = habitat.getTools();
	const toolNames = Object.keys(tools);

	// Auth provider precedence (see docs/adr/0003-per-user-a2a-identity.md):
	//   1. jwtAuth — per-user signed grants (HABITAT_AUTH_JWKS_URL / _PUBLIC_KEY + _AUDIENCE).
	//      The verified `sub` is the speaking user; this is the production path.
	//   2. bearerAuth — legacy single shared HABITAT_API_KEY. Kept for back-compat
	//      during rollout; every caller collapses to one identity, so it is being retired.
	//   3. devAuth — open, single fixed user. Local dev only (nothing configured).
	const { auth, authMode } = resolveAuthProvider();
	// Enforce auth on protected routes whenever we're not in open dev mode — this
	// covers both the JWT path and the legacy shared-key path. (Previously the
	// gates keyed off HABITAT_API_KEY directly, which would skip enforcement under
	// JWT auth.)
	const authRequired = authMode !== "open";

	// Upstream connectors (ADR 0004 §7): per-user "connect your X / …" flows the
	// habitat owns. Inert unless a provider's creds are configured. The signed
	// state secret rides HABITAT_API_KEY when present (stable across restarts),
	// else a per-process random (fine — a connect round-trip is short-lived).
	const connectors = buildDefaultConnectors();
	const connectSecret =
		process.env.HABITAT_API_KEY?.trim() || randomBytes(32).toString("hex");

	// Chat bridge + adapter, with logging wrapper
	const bridge = new ChannelBridge(habitat, {
		platformInstruction: [
			"You are responding via a web interface. Markdown is rendered natively.",
			"Files in the work directory (/data) are served at /files/* URLs. For example, /data/project/output/image.png is viewable at /files/project/output/image.png.",
			"When you produce output files (images, reports, data), use the `publish_artifact` tool to publish them. This copies the file to /data/artifacts/ with metadata and returns the public URL.",
			"After publishing, include the artifact URL in your response using markdown: ![name](/files/artifacts/filename.png) or [name](/files/artifacts/filename.ext)",
			"Do NOT copy files to /files/ — that path is a virtual mount, not a real directory. Files are served directly from /data/.",
		].join("\n"),
		buildAgentStimulus,
		runtimeRunners: {
			'claude-sdk': createClaudeSdkRuntimeRunner(),
			pi: createPiRuntimeRunner(),
		},
	});

	// Wrap bridge.handleMessage to log chat activity and track session
	const originalHandleMessage = bridge.handleMessage.bind(bridge);
	bridge.handleMessage = async (msg, events, signal) => {
		const ts = () => new Date().toISOString();
		console.log(
			`[${ts()}] 💬 chat: "${msg.text.slice(0, 80)}${msg.text.length > 80 ? "..." : ""}"`,
		);
		return originalHandleMessage(
			msg,
			{
				...events,
				onReasoning: (delta) => {
					events.onReasoning?.(delta);
				},
				onToolCall: (name, input) => {
					// Update session ID for artifact tools (session exists by the time tools run)
					const sid = bridge.getChannelSessionId(msg.channelKey);
					if (sid) (habitat as any)._currentSessionId = sid;
					console.log(`[${ts()}] ⚡ ${name}`);
					events.onToolCall?.(name, input);
				},
				onToolResult: (name, output, isError) => {
					const marker = isError ? "✗" : "✓";
					console.log(`[${ts()}] ${marker} ${name}`);
					events.onToolResult?.(name, output, isError);
				},
				onDone: (result) => {
					const len = result.content?.length ?? 0;
					console.log(`[${ts()}] ✅ chat done (${len} chars)`);
					return events.onDone(result);
				},
				onError: (err) => {
					console.error(`[${ts()}] ❌ chat error: ${err}`);
					events.onError?.(err);
				},
			},
			signal,
		);
	};

	const webAdapter = new WebAdapter(bridge);

	// Per-agent public surface (/agents/<id>/... + path-inserted well-known).
	const agentSurface = createAgentSurface(habitat);

	// A2A handler — initialized lazily on first request (needs port for baseUrl)
	let a2aHandler: A2AHandler | null = null;
	// Most-recent request's resolved public origin (#194). The A2A artifact-emit
	// path runs mid-stream with no request in hand, so it reads this holder,
	// which every request refreshes via getPublicBaseUrl(req). The public origin
	// is a deployment property (BASE_URL / Fly edge headers), so concurrent
	// requests resolve the same value — the shared holder is race-tolerant.
	let lastPublicOrigin: string | undefined;
	async function getA2AHandler(actualPort: number): Promise<A2AHandler> {
		if (!a2aHandler) {
			const baseUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`;
			a2aHandler = await createA2AHandler({
				habitat,
				bridge,
				baseUrl,
				name: serverName,
				requiresApiKey: authRequired,
				jwtMode: authMode === "jwt" || authMode === "jwt+bearer",
				resolvePublicOrigin: () => lastPublicOrigin,
			});
		}
		return a2aHandler;
	}

	// API routes
	const routes: RouteHandler[] = defaultRoutes();

	// Static UI directory — served from the package's public/ directory.
	const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
	let uiDir: string;
	if (options.uiDir) {
		uiDir = options.uiDir;
	} else {
		uiDir = resolve(pkgRoot, "public");
	}

	const httpServer = createServer(
		async (req: IncomingMessage, res: ServerResponse) => {
			// CORS
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader(
				"Access-Control-Allow-Methods",
				"GET, POST, DELETE, PUT, OPTIONS",
			);
			res.setHeader(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization",
			);

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			const { path, query } = parseRoute(req.url ?? "/");
			const reqStart = Date.now();

			// Refresh the resolved public origin for this request (#194), so the
			// A2A artifact-emit path (which has no req) mints absolute FilePart
			// URIs. Mirrors the agent-card self-describe at the /.well-known route.
			lastPublicOrigin = getPublicBaseUrl(req);

			// Log non-static requests
			const shouldLog =
				path.startsWith("/api/") ||
				path.startsWith("/agents/") ||
				path === "/mcp" ||
				path === "/a2a" ||
				path === "/health";
			if (shouldLog) {
				console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);
			}

			try {
				// ── Health (always open) ──────────────────────────────
				if (path === "/health") {
					const modelDetails = habitat.getDefaultModelDetails();
					sendJson(res, {
						status: "ok",
						name: serverName,
						tools: toolNames.length,
						auth: authMode,
						model: modelDetails
							? `${modelDetails.provider}/${modelDetails.name}`
							: null,
					});
					return;
				}

				// ── Extra raw handler (e.g. Gaia orchestrator routes) ──
				// This runs BEFORE the per-route auth checks below, so any control
				// plane it serves under /api/* would otherwise bypass auth entirely
				// (Gaia's create/start/stop + secret-vault routes). Gate /api/* here.
				// Static UI + /health stay open (health handled above; UI is served
				// after this block), matching bearer-auth's "exclude static/health".
				if (extraRawHandler) {
					if (authRequired && path.startsWith("/api/")) {
						const user = await auth.authenticate(req);
						if (!user) {
							sendJson(res, { error: "Unauthorized" }, 401);
							return;
						}
					}
					const handled = await extraRawHandler(req, res);
					if (handled) return;
				}

				// ── A2A agent card (always open) ────────────────────
				if (path === "/.well-known/agent-card.json" && req.method === "GET") {
					const addr = httpServer.address();
					const actualPort =
						typeof addr === "object" && addr ? addr.port : port;
					const handler = await getA2AHandler(actualPort);
					// Self-describe with the PUBLIC url, not the cached host:port one
					// (#170): behind a reverse proxy (Caddy/Gaia) the card must point
					// callers at the externally reachable origin via X-Forwarded-*.
					// Mirrors the MCP/OAuth surface (agent-surface.ts). Falls back to
					// the Host header / BASE_URL when no forwarding headers are present.
					const publicBase = getPublicBaseUrl(req);
					const card: Record<string, unknown> = {
						...handler.agentCard,
						url: `${publicBase}/a2a`,
					};
					// provider.url = the agent's own human-facing surface (web UI root)
					// so the SaaS renders a per-agent link from the card, not an env var.
					card.provider =
						(handler.agentCard as { provider?: unknown }).provider ?? {
							organization: serverName,
							url: publicBase,
						};
					// Advertise the per-user connect surface as an A2A extension when a
					// connector is registered (self-describing for the SaaS).
					if (connectors.size > 0) {
						const caps =
							(handler.agentCard.capabilities as
								| { extensions?: unknown[] }
								| undefined) ?? {};
						card.capabilities = {
							...caps,
							extensions: [
								...((caps.extensions as unknown[]) ?? []),
								connectExtension(publicBase),
							],
						};
					}
					sendJson(res, card);
					return;
				}

				// ── A2A endpoint ─────────────────────────────────────
				// Upstream connect (ADR 0004 section 7):
				// GET /connect/:provider          -> start (redirect to provider)
				// GET /connect/:provider/callback -> finish (exchange + store)
				// Inert (404) unless a connector for :provider is registered.
				// Generic connect landing (ADR 0004 section 7): the agent's own surface.
				if (path === "/connect" && req.method === "GET") {
					const tok = query.jwt || query.token;
					const authReq = tok
						? ({ headers: { authorization: `Bearer ${tok}` } } as unknown as IncomingMessage)
						: req;
					const user = await auth.authenticate(authReq);
					if (!user) {
						sendJson(res, { error: "Unauthorized — the connect link needs a valid per-user token" }, 401);
						return;
					}
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(
						renderConnectLanding(
							[...connectors.values()].map((c) => ({ name: c.name, label: c.label })),
							tok ?? "",
						),
					);
					return;
				}

				if (path.startsWith("/connect/") && req.method === "GET") {
					const parts = path.split("/").filter(Boolean);
					const provider = parts[1];
					const isCallback = parts.length === 3 && parts[2] === "callback";
					const connector = provider ? connectors.get(provider) : undefined;
					if (!connector || (parts.length === 3 && !isCallback) || parts.length > 3) {
						sendJson(res, { error: "Unknown connector" }, 404);
						return;
					}
					const publicBaseUrl = getPublicBaseUrl(req);
					const nowSeconds = Math.floor(Date.now() / 1000);
					if (!isCallback) {
						// A browser GET can't send an Authorization header, so the SaaS
						// passes a per-user JWT as ?jwt= (or ?token=); fall back to the
						// request's own auth otherwise.
						const tok = query.jwt || query.token;
						const authReq = tok
							? ({ headers: { authorization: `Bearer ${tok}` } } as unknown as IncomingMessage)
							: req;
						const user = await auth.authenticate(authReq);
						if (!user) {
							sendJson(
								res,
								{ error: "Unauthorized — the connect link needs a valid per-user token" },
								401,
							);
							return;
						}
						const { authorizeUrl } = startConnect({
							connector,
							sub: user.userId,
							publicBaseUrl,
							secret: connectSecret,
							nowSeconds,
						});
						res.writeHead(302, { Location: authorizeUrl });
						res.end();
						return;
					}
					// Callback: identity rides the signed state, not auth headers.
					const result = await completeConnect({
						connector,
						provider,
						query,
						publicBaseUrl,
						secret: connectSecret,
						nowSeconds,
						setSecret: (name, value) => habitat.setSecret(name, value),
					});
					const page = (title: string, body: string) =>
						`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p></body>`;
					if (!result.ok) {
						res.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
						res.end(page("Connection failed", escapeHtmlText(result.message)));
						return;
					}
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(
						page(
							`Connected ${escapeHtmlText(connector.label)}`,
							"You can close this window and return to your chat.",
						),
					);
					return;
				}

				if (path === "/a2a" && req.method === "POST") {
					let user: UserContext | null = null;
					if (authRequired) {
						user = await auth.authenticate(req);
						if (!user) {
							sendJson(res, { error: "Unauthorized" }, 401);
							return;
						}
					}
					// Per-user identity (ADR 0003 step 2): bind the verified end-user
					// `sub` as the speaker so the executor uses it as
					// interaction.userId. This must fire in BOTH "jwt" and
					// "jwt+bearer" modes — a JWT-capable habitat that also accepts the
					// shared HABITAT_API_KEY during transition still carries a real
					// per-user sub on the JWT path. The shared key resolves to the
					// `bearer-user` sentinel (operator, no per-user identity) and
					// dev/open leave `user` null; in those cases leave the speaker
					// unbound so the executor keeps its thread-scoped
					// `a2a:${contextId}` fallback. Never discard a verified per-user
					// identity by silently falling back to anonymous.
					const speaker =
						user && user.userId !== "bearer-user"
							? {
									userId: user.userId,
									displayName: user.displayName,
									email: user.email,
								}
							: undefined;
					const addr = httpServer.address();
					const actualPort =
						typeof addr === "object" && addr ? addr.port : port;
					const handler = await getA2AHandler(actualPort);
					const rawBody = await readBodyRaw(req);
					let parsedBody: unknown;
					try {
						parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								error: { code: -32700, message: "Parse error" },
								id: null,
							}),
						);
						return;
					}

					try {
						const result = await runWithSpeaker(speaker, () =>
							handler.transportHandler.handle(parsedBody),
						);
						if (
							result &&
							typeof (result as any)[Symbol.asyncIterator] === "function"
						) {
							// Streaming response — SSE
							res.writeHead(200, {
								"Content-Type": "text/event-stream",
								"Cache-Control": "no-cache",
								Connection: "keep-alive",
							});
							const generator = result as AsyncGenerator<any>;
							for await (const event of generator) {
								res.write(`data: ${JSON.stringify(event)}\n\n`);
							}
							res.end();
						} else {
							// Single JSON-RPC response
							sendJson(res, result);
						}
					} catch (error) {
						console.error(
							`[container] A2A error: ${error instanceof Error ? error.message : String(error)}`,
						);
						if (!res.headersSent) {
							sendJson(
								res,
								{
									jsonrpc: "2.0",
									error: { code: -32603, message: "Internal error" },
									id: null,
								},
								500,
							);
						}
					}
					return;
				}

				// ── Secret write (per-user token delivery, #56) ───────
				// Narrow, opt-in receiver: the habitats SaaS pushes a user's
				// upstream token (e.g. their X refresh token) here as
				// TWITTER_REFRESH_TOKEN:<sub>. Disabled unless
				// HABITAT_SECRET_WRITE_PREFIXES is set; restricted to those
				// prefixes; auth-gated like every /api route.
				if (path === "/api/secrets" && req.method === "POST") {
					const prefixes = parseSecretWritePrefixes(
						process.env.HABITAT_SECRET_WRITE_PREFIXES,
					);
					// Operators may also set credentials the habitat declared it
					// needs (config.requiredSecrets) — the SaaS attach form (ADR 0004).
					const declaredNames = (habitat.getConfig().requiredSecrets ?? []).map(
						(s) => s.name,
					);
					if (prefixes.length === 0 && declaredNames.length === 0) {
						sendJson(res, { error: "Not found" }, 404);
						return;
					}
					let isOperator = false;
					if (authRequired) {
						const user = await auth.authenticate(req);
						if (!user) {
							sendJson(res, { error: "Unauthorized" }, 401);
							return;
						}
						// Operator = the shared HABITAT_API_KEY (fixed 'bearer-user'
						// sentinel) OR a JWT the SaaS minted with the `operator` claim
						// for a habitat admin (ADR 0004). Only operators may set the
						// credentials the habitat declares it needs.
						isOperator =
							user.userId === "bearer-user" || user.operator === true;
					}
					let body: { name?: unknown; value?: unknown };
					try {
						body = JSON.parse((await readBodyRaw(req)) || "{}");
					} catch {
						sendJson(res, { error: "Parse error" }, 400);
						return;
					}
					const { name, value } = body;
					if (
						typeof name !== "string" ||
						typeof value !== "string" ||
						value.length === 0
					) {
						sendJson(res, { error: "name and non-empty value required" }, 400);
						return;
					}
					if (
						!isSecretWriteAllowed(name, prefixes, { declaredNames, isOperator })
					) {
						sendJson(res, { error: "secret name not allowed" }, 403);
						return;
					}
					await habitat.setSecret(name, value);
					sendJson(res, { ok: true, name });
					return;
				}

				// ── MCP endpoint ──────────────────────────────────────
				if (path === "/mcp") {
					// Auth check for MCP
					if (authRequired) {
						const user = await auth.authenticate(req);
						if (!user) {
							sendJson(res, { error: "Unauthorized" }, 401);
							return;
						}
					}

					if (req.method === "DELETE") {
						res.writeHead(200);
						res.end("Session terminated");
						return;
					}

					if (req.method !== "POST" && req.method !== "GET") {
						res.writeHead(405);
						res.end("Method not allowed");
						return;
					}

					let transport: StreamableHTTPServerTransport | null = null;
					try {
						const rawBody = await readBodyRaw(req);
						let parsedBody: unknown;
						try {
							parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
						} catch {
							res.writeHead(400, { "Content-Type": "application/json" });
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									error: { code: -32700, message: "Parse error" },
									id: null,
								}),
							);
							return;
						}

						const mcpServer = new McpServer({
							name: serverName,
							version: "1.0.0",
						});
						for (const [name, tool] of Object.entries(tools)) {
							registerAiTool(mcpServer, name, tool);
						}

						transport = new StreamableHTTPServerTransport({
							sessionIdGenerator: undefined,
						});
						await mcpServer.connect(transport);
						await transport.handleRequest(req, res, parsedBody);
					} catch (error) {
						console.error(
							`[container] MCP error: ${error instanceof Error ? error.message : String(error)}`,
						);
						if (!res.headersSent) {
							res.writeHead(500);
							res.end("Internal server error");
						}
					} finally {
						if (transport) {
							try {
								await transport.close();
							} catch {
								/* ignore */
							}
						}
					}
					return;
				}

				// ── mcp-agent public surface (/agents/<id>/...) ───────
				// Static UI, manifest, and the mcp-serve OAuth MCP mount,
				// plus the root-level path-inserted OAuth discovery URLs.
				// See agent-surface.ts. Not gated by HABITAT_API_KEY — the
				// mount's own OAuth layer authenticates /mcp.
				if (await agentSurface.handle(req, res, path)) return;

				// ── File serving (sandboxed to work dir) ───────────────
				if (path.startsWith("/files/") && req.method === "GET") {
					if (authRequired) {
						const user = await auth.authenticate(req);
						if (!user) {
							sendJson(res, { error: "Unauthorized" }, 401);
							return;
						}
					}
					const relPath = decodeURIComponent(path.slice("/files/".length));
					if (relPath.includes("..") || relPath.startsWith("/")) {
						sendJson(res, { error: "Invalid path" }, 400);
						return;
					}
					const workDir = habitat.getWorkDir();
					const absPath = resolve(workDir, relPath);
					// Ensure the resolved path is within allowed roots
					const allowedRoots = habitat.getAllowedRoots();
					const inBounds = allowedRoots.some((root) =>
						absPath.startsWith(root),
					);
					if (!inBounds) {
						sendJson(res, { error: "Path outside allowed roots" }, 403);
						return;
					}
					try {
						const fileStat = await stat(absPath);
						if (fileStat.isDirectory()) {
							sendJson(res, { error: "Cannot serve directories" }, 400);
							return;
						}
						const ext = extname(absPath).toLowerCase();
						const imgTypes: Record<string, string> = {
							".png": "image/png",
							".jpg": "image/jpeg",
							".jpeg": "image/jpeg",
							".gif": "image/gif",
							".webp": "image/webp",
							".svg": "image/svg+xml",
							".bmp": "image/bmp",
							".ico": "image/x-icon",
						};
						const textTypes: Record<string, string> = {
							".html": "text/html; charset=utf-8",
							".css": "text/css; charset=utf-8",
							".js": "application/javascript; charset=utf-8",
							".json": "application/json; charset=utf-8",
							".md": "text/markdown; charset=utf-8",
							".txt": "text/plain; charset=utf-8",
							".csv": "text/csv; charset=utf-8",
							".xml": "text/xml; charset=utf-8",
							".yaml": "text/yaml; charset=utf-8",
							".yml": "text/yaml; charset=utf-8",
							".toml": "text/plain; charset=utf-8",
							".log": "text/plain; charset=utf-8",
							".ts": "text/plain; charset=utf-8",
							".py": "text/plain; charset=utf-8",
						};
						const contentType =
							imgTypes[ext] ?? textTypes[ext] ?? "application/octet-stream";
						const body = await readFile(absPath);
						res.writeHead(200, {
							"Content-Type": contentType,
							"Content-Length": body.length,
							"Cache-Control": "no-cache",
						});
						res.end(body);
					} catch (err: any) {
						if (err.code === "ENOENT")
							sendJson(res, { error: "File not found" }, 404);
						else sendJson(res, { error: err.message }, 500);
					}
					return;
				}

				// ── API routes (auth required if key set) ─────────────
				if (path.startsWith("/api/")) {
					let user: UserContext | null = null;

					// GET /api/status — full container status (model, provisioning, secrets)
					if (path === "/api/status" && req.method === "GET") {
						const config = habitat.getConfig();
						const modelDetails = habitat.getDefaultModelDetails();
						const projectDir = resolveProjectDir(habitat.getWorkDir(), config);
						const projectCloned = await fileExists(join(projectDir, ".git"));
						sendJson(res, {
							name: config.name ?? "Unnamed Habitat",
							model: modelDetails
								? { provider: modelDetails.provider, name: modelDetails.name }
								: null,
							provisioning: {
								gitUrl: config.gitUrl ?? null,
								projectCloned,
								projectDir: config.projectDir ?? "project",
							},
							tools: toolNames.length,
							requiredSecrets: (config.requiredSecrets ?? []).map((s) => ({
								name: s.name,
								description: s.description,
								required: s.required,
								set: !!habitat.getSecret(s.name),
							})),
						});
						return;
					}

					// GET /api/settings — full config, dependencies, env vars
					if (path === "/api/settings" && req.method === "GET") {
						const config = habitat.getConfig();
						const workDir = habitat.getWorkDir();
						const projectDir = resolveProjectDir(workDir, config);

						// Read mise.toml from project dir
						let deps = "";
						try {
							deps = await readFile(join(projectDir, "mise.toml"), "utf-8");
						} catch {
							try {
								deps = await readFile(join(workDir, "mise.toml"), "utf-8");
							} catch {
								// no mise.toml
							}
						}

						// Known env var names for providers + common services
						const knownEnvVars = [
							"GOOGLE_GENERATIVE_AI_API_KEY",
							"OPENROUTER_API_KEY",
							"ANTHROPIC_API_KEY",
							"DEEPINFRA_API_KEY",
							"TOGETHER_API_KEY",
							"GITHUB_TOKEN",
							"TAVILY_API_KEY",
							"MARKIFY_URL",
							"OLLAMA_HOST",
							"HABITAT_API_KEY",
							"HABITAT_PROVIDER",
							"HABITAT_MODEL",
						];
						// Also include any required secrets from config
						for (const s of config.requiredSecrets ?? []) {
							if (!knownEnvVars.includes(s.name)) knownEnvVars.push(s.name);
						}

						const envVars = knownEnvVars.map((name) => ({
							name,
							set: !!(process.env[name] || habitat.getSecret(name)),
						}));

						sendJson(res, { config, deps, envVars });
						return;
					}

					// GET /api/artifacts — list published artifacts
					if (path === "/api/artifacts" && req.method === "GET") {
						const origin = getPublicBaseUrl(req);
						const metas = (await listArtifacts(habitat.getWorkDir())).map(
							(m) => ({ ...m, url: toAbsoluteArtifactUrl(m.url, origin) }),
						);
						sendJson(res, { artifacts: metas, count: metas.length });
						return;
					}

					// GET /api/manifest — provisioning manifest (skills + agents + aggregate requirements)
					if (path === "/api/manifest" && req.method === "GET") {
						const config = habitat.getConfig();
						const requirements = await habitat.computeRequirements();
						sendJson(res, {
							name: config.name ?? "Unnamed Habitat",
							defaultProvider: config.defaultProvider ?? null,
							defaultModel: config.defaultModel ?? null,
							gitUrl: config.gitUrl ?? null,
							gitBranch: config.gitBranch ?? null,
							skillsDirs: config.skillsDirs ?? [],
							skillsFromGit: config.skillsFromGit ?? [],
							scopeTemplates: config.scopeTemplates ?? {},
							agents: (config.agents ?? []).map((a) => ({
								id: a.id,
								name: a.name,
								kind: a.kind ?? "repo",
								mode: a.mode ?? "write",
								gitRemote: a.gitRemote ?? null,
								identity: a.identity
									? {
											principal: a.identity.principal,
											vault: a.identity.vault ?? { backend: "habitat" },
											scopes: a.identity.scopes,
										}
									: null,
								scopes: a.identity?.scopes ?? [],
								surface: a.surface ?? null,
							})),
							skills: requirements.skills,
							agentRequirements: requirements.agents,
							aggregate: requirements.aggregate,
							requiredSecrets: (config.requiredSecrets ?? []).map((s) => ({
								name: s.name,
								description: s.description,
								required: s.required,
								set: !!habitat.getSecret(s.name),
							})),
						});
						return;
					}

					// POST /api/capability-gaps — record a runtime gap report
					if (path === "/api/capability-gaps" && req.method === "POST") {
						if (authRequired) {
							user = await auth.authenticate(req);
							if (!user) {
								sendJson(res, { error: "Unauthorized" }, 401);
								return;
							}
						}
						const body = JSON.parse(await readBodyRaw(req));
						const capability =
							typeof body.capability === "string" ? body.capability.trim() : "";
						const context =
							typeof body.context === "string" ? body.context.trim() : "";
						if (!capability) {
							sendJson(res, { error: "capability is required" }, 400);
							return;
						}
						habitat.recordCapabilityGap({
							capability,
							context: context || "unknown",
							timestamp: new Date().toISOString(),
						});
						sendJson(res, { recorded: true, capability });
						return;
					}

					// GET /api/capability-gaps — list all recorded gaps
					if (path === "/api/capability-gaps" && req.method === "GET") {
						if (authRequired) {
							user = await auth.authenticate(req);
							if (!user) {
								sendJson(res, { error: "Unauthorized" }, 401);
								return;
							}
						}
						sendJson(res, { gaps: habitat.getCapabilityGaps() });
						return;
					}

					// GET /api/agents — list of agents with status (no secret values).
					if (path === "/api/agents" && req.method === "GET") {
						const config = habitat.getConfig();
						sendJson(res, {
							agents: (config.agents ?? []).map((a) => ({
								id: a.id,
								name: a.name,
								kind: a.kind ?? "repo",
								mode: a.mode ?? "write",
								projectPath: a.projectPath,
								gitRemote: a.gitRemote ?? null,
								identity: a.identity
									? {
											principal: a.identity.principal,
											vault: a.identity.vault ?? { backend: "habitat" },
											scopes: a.identity.scopes,
										}
									: null,
								surface: a.surface ?? null,
							})),
							scopeTemplates: config.scopeTemplates ?? {},
						});
						return;
					}

					// GET /api/agents/:id/requirements — discovered requirements for a single agent.
					{
						const m = path.match(/^\/api\/agents\/([^/]+)\/requirements$/);
						if (m && req.method === "GET") {
							const agent = habitat.getAgent(m[1]);
							if (!agent) {
								sendJson(res, { error: "AGENT_NOT_FOUND", id: m[1] }, 404);
								return;
							}
							sendJson(res, {
								agentId: agent.id,
								requirements: agent.requirements ?? {
									envVars: [],
									cliTools: [],
								},
							});
							return;
						}
					}

					// GET /api/agents/:id/manifest — mcp-agent manifest (loaded from repo).
					{
						const m = path.match(/^\/api\/agents\/([^/]+)\/manifest$/);
						if (m && req.method === "GET") {
							const agent = habitat.getAgent(m[1]);
							if (!agent) {
								sendJson(res, { error: "AGENT_NOT_FOUND", id: m[1] }, 404);
								return;
							}
							if (agent.kind !== "mcp-agent") {
								sendJson(
									res,
									{
										error: "AGENT_KIND_MISMATCH",
										message: `Agent "${agent.id}" is kind:${agent.kind ?? "repo"}, not mcp-agent.`,
									},
									400,
								);
								return;
							}
							const all = await habitat.getMcpAgents();
							const found = all.mcpAgents.find((x) => x.agent.id === agent.id);
							if (!found) {
								const err = all.errors.find((e) => e.agent.id === agent.id);
								sendJson(
									res,
									{
										error: err ? "MANIFEST_INVALID" : "MANIFEST_NOT_FOUND",
										message:
											err?.error ??
											"agent-manifest.json not found in agent repo",
									},
									err ? 422 : 404,
								);
								return;
							}
							sendJson(res, {
								agentId: agent.id,
								manifestPath: found.path,
								manifest: found.manifest,
							});
							return;
						}
					}

					// POST /api/inference — attach an inference engine
					if (path === "/api/inference" && req.method === "POST") {
						if (authRequired) {
							user = await auth.authenticate(req);
							if (!user) {
								sendJson(res, { error: "Unauthorized" }, 401);
								return;
							}
						}
						const body = JSON.parse(await readBodyRaw(req));
						const provider =
							typeof body.provider === "string" ? body.provider.trim() : "";
						const model =
							typeof body.model === "string" ? body.model.trim() : "";
						if (!provider || !model) {
							sendJson(res, { error: "provider and model are required" }, 400);
							return;
						}
						// Save to config
						const config = habitat.getConfig();
						config.defaultProvider = provider;
						config.defaultModel = model;
						await saveConfig(habitat.configPath, config);
						await habitat.reloadConfig();
						habitat.setRuntimeModelDetails({ provider, name: model });
						// If an API key was provided, save it as a secret
						const apiKeyValue =
							typeof body.apiKey === "string" ? body.apiKey.trim() : "";
						if (apiKeyValue) {
							// Determine the env var name for this provider
							const keyNames: Record<string, string> = {
								google: "GOOGLE_GENERATIVE_AI_API_KEY",
								openrouter: "OPENROUTER_API_KEY",
								anthropic: "ANTHROPIC_API_KEY",
								deepinfra: "DEEPINFRA_API_KEY",
								togetherai: "TOGETHER_API_KEY",
								github: "GITHUB_TOKEN",
							};
							const envName =
								keyNames[provider] ?? `${provider.toUpperCase()}_API_KEY`;
							await habitat.setSecret(envName, apiKeyValue);
						}
						sendJson(res, {
							success: true,
							provider,
							model,
							message: `Inference attached: ${provider}/${model}`,
						});
						return;
					}

					// POST /api/chat
					if (path === "/api/chat" && req.method === "POST") {
						if (authRequired) {
							user = await auth.authenticate(req);
							if (!user) {
								sendJson(res, { error: "Unauthorized" }, 401);
								return;
							}
						}
						// Guard: no model configured
						if (!habitat.getDefaultModelDetails()) {
							sendJson(
								res,
								{
									error:
										"No inference engine configured. Use the dashboard to attach a provider and model.",
								},
								503,
							);
							return;
						}
						return await webAdapter.handleChat(
							req,
							res,
							user ?? { userId: "container", provider: "dev" },
						);
					}

					// Registered routes
					for (const route of routes) {
						if (route.method !== req.method) continue;
						const params = matchRoute(route.path, path);
						if (!params) continue;

						if (!route.skipAuth && authRequired) {
							user = await auth.authenticate(req);
							if (!user) {
								sendJson(res, { error: "Unauthorized" }, 401);
								return;
							}
						}

						const ctx: RouteContext = {
							habitat,
							bridge,
							user: user ?? { userId: "container", provider: "dev" },
							req,
							res,
							path,
							query,
						};
						return await route.handle(ctx, params);
					}

					sendJson(res, { error: "Not found", path }, 404);
					return;
				}

				// ── Static UI (always open) ───────────────────────────
				if (req.method === "GET") {
					const served = await serveStatic(uiDir, path, res);
					if (served) return;

					// SPA fallback
					if (!extname(path)) {
						const fell = await serveStatic(uiDir, "/", res);
						if (fell) return;
					}
				}

				sendJson(res, { error: "Not found", path }, 404);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[container]", message);
				if (!res.headersSent) {
					sendJson(res, { error: message }, 500);
				} else {
					res.end();
				}
			}
		},
	);

	return new Promise((resolvePromise) => {
		httpServer.listen(port, host, () => {
			const addr = httpServer.address();
			const assignedPort = typeof addr === "object" && addr ? addr.port : port;

			console.log(
				`[container] ${serverName} at http://${host}:${assignedPort}`,
			);
			console.log(
				`[container]   /mcp         — MCP tools (${toolNames.length})`,
			);
			console.log(`[container]   /a2a         — A2A agent endpoint`);
			console.log(`[container]   /api/chat    — LLM chat`);
			console.log(`[container]   /            — Web UI`);
			console.log(`[container]   /health      — Health check`);
			if (authMode === "jwt") {
				console.log(
					`[container]   Auth: per-user JWT grants required (verified, sub = user id)`,
				);
			} else if (authMode === "jwt+bearer") {
				console.log(
					`[container]   Auth: per-user JWT (verified, sub = user id) OR shared HABITAT_API_KEY — dual-auth transition (ADR 0003)`,
				);
			} else if (authMode === "bearer") {
				console.log(
					`[container]   Auth: legacy shared HABITAT_API_KEY (no per-user identity — see ADR 0003)`,
				);
			} else {
				console.log(
					`[container]   Auth: open dev mode (configure HABITAT_AUTH_* for per-user JWT)`,
				);
			}

			resolvePromise({
				port: assignedPort,
				close: () => httpServer.close(),
			});
		});
	});
}

function readBodyRaw(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}
