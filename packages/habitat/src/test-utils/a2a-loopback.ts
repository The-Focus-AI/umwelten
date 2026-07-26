/**
 * A habitat A2A surface on loopback, for tests.
 *
 * Real `createA2AHandler` — the real executor, the real `FileTaskStore` and
 * `FilePushNotificationStore` on a work directory, the real boot sweep —
 * mounted on a real HTTP server and driven over JSON-RPC. Only two things are
 * faked: the bridge (so no model is called) and the container (so a "restart"
 * is a process-local rebuild).
 *
 * `restart()` is abrupt on purpose. Nothing tells in-flight runs to stop and
 * nothing publishes a terminal event for them, because a killed container does
 * neither — and the Task left mid-flight is exactly what the next generation's
 * sweep has to find.
 */

import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createA2AHandler, type A2AHandler } from "../a2a-handler.js";
import type { AgentHost } from "../types.js";
import type { ChannelBridge } from "../bridge/channel-bridge.js";
import type { BridgeEventHandlers, ChannelMessage } from "../bridge/types.js";

/** Directives the scripted bridge understands. */
export const SCRIPT_QUICK = "conformance:quick";
export const SCRIPT_SLOW = "conformance:slow";
export const SCRIPT_FAIL = "conformance:fail";

/**
 * A bridge that answers, hangs, or fails on request. Everything that would
 * reach a model stops here.
 */
export function scriptedBridge(): ChannelBridge {
	return {
		handleMessage: async (
			msg: ChannelMessage,
			events: BridgeEventHandlers,
			signal?: AbortSignal,
		) => {
			if (msg.text.includes(SCRIPT_FAIL)) {
				events.onError?.("failed on request");
				return;
			}

			if (msg.text.includes(SCRIPT_SLOW)) {
				// Stay in flight until the run is aborted — by tasks/cancel, or by
				// the server going away underneath it.
				await new Promise<void>((resolve) => {
					if (signal?.aborted) return resolve();
					signal?.addEventListener("abort", () => {
						events.onError?.("aborted");
						resolve();
					});
				});
				return;
			}

			await events.onDone({
				content: "ok",
				sessionId: "test",
				channelKey: msg.channelKey,
			});
		},
	} as unknown as ChannelBridge;
}

export interface LoopbackHabitat {
	/** Base URL; `${url}/a2a` is the JSON-RPC endpoint. */
	readonly url: string;
	/** The work directory, which survives restarts. */
	readonly workDir: string;
	/** Stop abruptly and start a new generation on the same work directory. */
	restart(): Promise<void>;
	stop(): Promise<void>;
}

export async function startLoopbackHabitat(): Promise<LoopbackHabitat> {
	const workDir = await mkdtemp(join(tmpdir(), "habitat-a2a-loopback-"));
	const host = {
		getConfig: () => ({ name: "Loopback Habitat", agents: [] }),
		getStimulus: async () => ({ options: { role: "test target" } }),
		getWorkDir: () => workDir,
	} as unknown as AgentHost;

	let port = 0;
	let handler: A2AHandler;
	let server: Server;

	async function listen(): Promise<void> {
		// A fresh handler per generation: new stores over the same directory, and
		// the boot recovery sweep runs before the first request is served.
		handler = await createA2AHandler({
			habitat: host,
			bridge: scriptedBridge(),
			baseUrl: `http://127.0.0.1:${port}`,
		});

		server = createServer((req, res) => {
			void (async () => {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(chunk as Buffer);
				const raw = Buffer.concat(chunks).toString("utf-8");
				const result = await handler.transportHandler.handle(
					raw ? JSON.parse(raw) : undefined,
				);
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(result));
			})();
		});

		await new Promise<void>((resolve) => {
			server.listen(port, "127.0.0.1", () => {
				const address = server.address();
				if (address && typeof address === "object") port = address.port;
				resolve();
			});
		});
	}

	async function close(): Promise<void> {
		await new Promise<void>((resolve) => {
			server.closeAllConnections?.();
			server.close(() => resolve());
		});
	}

	await listen();

	return {
		get url() {
			return `http://127.0.0.1:${port}`;
		},
		workDir,
		async restart() {
			await close();
			await listen();
		},
		async stop() {
			await close();
		},
	};
}
