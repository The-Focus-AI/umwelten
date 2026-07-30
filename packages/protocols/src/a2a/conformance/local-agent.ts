/**
 * A restartable A2A agent on loopback, for running the conformance suite
 * without Docker, a model, or the network.
 *
 * This is a real HTTP server speaking real JSON-RPC over a real socket with a
 * real `FileTaskStore` on disk — the only thing faked is the agent's judgement
 * (see `scripted-agent.ts`). That matters: the cases this exists to run are
 * about durability and recovery, and an in-process transport with an in-memory
 * store cannot fail the way a stopped container fails.
 *
 * {@link ConformanceAgentHandle.restart} models the container being *stopped*,
 * not asked politely to finish: in-flight runs are dropped without terminal
 * events, the process's memory goes with it, and the next generation reads the
 * volume back off disk and sweeps what the last one abandoned (ADR 0007).
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCard } from "@a2a-js/sdk";
import { FileTaskStore } from "../file-task-store.js";
import { createA2AServer, type A2AServer } from "../server.js";
import { sweepAbandonedTasks, type SweepResult } from "../task-recovery.js";
import { ScriptedConformanceAgent } from "./scripted-agent.js";

export interface StartConformanceAgentOptions {
	/**
	 * Where Tasks are kept. A fresh temp directory by default; pass one to
	 * inspect what survives a restart, or to share a volume between runs.
	 */
	dir?: string;
	/** Require this bearer token, so the auth path is exercised too. */
	apiKey?: string;
	/** Bind port. Defaults to an ephemeral one, reused across restarts. */
	port?: number;
}

export interface ConformanceAgentHandle {
	/** Base URL — `${url}/a2a` is the JSON-RPC endpoint. */
	readonly url: string;
	/** Directory the Tasks are persisted in; survives restarts. */
	readonly tasksDir: string;
	/** Result of the recovery sweep the most recent start ran. */
	readonly lastSweep: SweepResult | undefined;
	/** Stop abruptly, then start a new generation on the same volume. */
	restart(): Promise<void>;
	stop(): Promise<void>;
}

/**
 * The v1 (protobuf-shaped) card `createA2AServer` needs. Declares both
 * protocol versions on the same URL so the SDK's version validation accepts
 * v1.0 requests and defaulted 0.3 requests alike — the dual-dialect transport
 * serves both. Exported so the test file can derive intentionally broken
 * variants (the forgetful agent) without restating the shape.
 */
export function conformanceAgentCard(baseUrl: string): AgentCard {
	return {
		name: "Conformance Agent",
		description: "Scripted A2A agent used by the conformance suite.",
		version: "1.0.0",
		supportedInterfaces: ["1.0", "0.3"].map((protocolVersion) => ({
			url: `${baseUrl}/a2a`,
			protocolBinding: "JSONRPC",
			tenant: "",
			protocolVersion,
		})),
		provider: undefined,
		documentationUrl: undefined,
		capabilities: {
			streaming: true,
			pushNotifications: false,
			extensions: [],
			extendedAgentCard: false,
		},
		securitySchemes: {},
		securityRequirements: [],
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
		skills: [
			{
				id: "conformance",
				name: "Conformance",
				description: "Drives a Task to a requested lifecycle state.",
				tags: ["test"],
				examples: [],
				inputModes: [],
				outputModes: [],
				securityRequirements: [],
			},
		],
		signatures: [],
		iconUrl: undefined,
	};
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf-8");
}

export async function startConformanceAgent(
	options: StartConformanceAgentOptions = {},
): Promise<ConformanceAgentHandle> {
	const dir =
		options.dir ?? (await mkdtemp(join(tmpdir(), "a2a-conformance-")));
	const tasksDir = join(dir, "tasks");

	let executor = new ScriptedConformanceAgent();
	let a2a: A2AServer;
	let httpServer: Server;
	let port = options.port ?? 0;
	let lastSweep: SweepResult | undefined;

	const baseUrl = () => `http://127.0.0.1:${port}`;

	function build(): A2AServer {
		return createA2AServer({
			agentCard: conformanceAgentCard(baseUrl()),
			executor,
			taskStore: new FileTaskStore({ dir: tasksDir }),
		});
	}

	function listen(): Promise<void> {
		httpServer = createServer((req, res) => {
			void (async () => {
				const url = new URL(req.url ?? "/", baseUrl());

				if (
					options.apiKey &&
					req.headers.authorization !== `Bearer ${options.apiKey}`
				) {
					res.writeHead(401, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: "Unauthorized" }));
					return;
				}

				if (
					req.method === "GET" &&
					url.pathname === "/.well-known/agent-card.json"
				) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(a2a.agentCard));
					return;
				}

				if (req.method !== "POST" || url.pathname !== "/a2a") {
					res.writeHead(404, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: "Not found" }));
					return;
				}

				let body: Record<string, unknown> | undefined;
				try {
					const raw = await readBody(req);
					body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
				} catch {
					res.writeHead(400, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							jsonrpc: "2.0",
							id: null,
							error: { code: -32700, message: "Parse error" },
						}),
					);
					return;
				}

				try {
					// An empty POST body becomes an empty envelope; the v1 handler
					// answers it with a JSON-RPC invalid-request error.
					const result = await a2a.transportHandler.handle(body ?? {});
					if (
						result &&
						typeof (result as AsyncGenerator<unknown>)[Symbol.asyncIterator] ===
							"function"
					) {
						res.writeHead(200, {
							"content-type": "text/event-stream",
							"cache-control": "no-cache",
							connection: "keep-alive",
						});
						for await (const event of result as AsyncGenerator<unknown>) {
							res.write(`data: ${JSON.stringify(event)}\n\n`);
						}
						res.end();
						return;
					}
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(result));
				} catch (err) {
					if (!res.headersSent) {
						res.writeHead(500, { "content-type": "application/json" });
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								id: null,
								error: {
									code: -32603,
									message: err instanceof Error ? err.message : String(err),
								},
							}),
						);
					}
				}
			})();
		});

		return new Promise<void>((resolve, reject) => {
			httpServer.once("error", reject);
			httpServer.listen(port, "127.0.0.1", () => {
				const address = httpServer.address();
				if (address && typeof address === "object") port = address.port;
				a2a = build();
				resolve();
			});
		});
	}

	async function close(): Promise<void> {
		// Kill first: a run still holding the bus would keep the request open and
		// close() would wait for work that a stopped container never waits for.
		executor.kill();
		await new Promise<void>((resolve) => {
			httpServer.closeAllConnections?.();
			httpServer.close(() => resolve());
		});
	}

	async function sweep(): Promise<void> {
		lastSweep = await sweepAbandonedTasks(new FileTaskStore({ dir: tasksDir }));
	}

	// A cold start sweeps too — a container that was killed before it ever
	// served a request left the same mess as one killed later.
	await sweep();
	await listen();

	return {
		get url() {
			return baseUrl();
		},
		tasksDir,
		get lastSweep() {
			return lastSweep;
		},
		async restart() {
			await close();
			// A new generation shares nothing with the last one but the volume —
			// new executor, new store, so nothing is remembered that a restarted
			// container would not have had to read back off disk.
			executor = new ScriptedConformanceAgent();
			await sweep();
			await listen();
		},
		async stop() {
			await close();
		},
	};
}
