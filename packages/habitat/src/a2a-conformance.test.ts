/**
 * The A2A conformance suite (#274), run against a real habitat A2A surface.
 *
 * This is the second target of the one fixture set: the same cases that run
 * against the reference agent in `@umwelten/protocols`, pointed at
 * `createA2AHandler` — the real `HabitatAgentExecutor`, the real
 * `FileTaskStore` on a work directory, and the real boot sweep — mounted on a
 * loopback HTTP server and driven over JSON-RPC.
 *
 * The bridge is the seam, exactly as it is in `a2a-handler.test.ts`: it is
 * scripted rather than model-backed, so a run can be made to answer at once,
 * hang until it is aborted, or fail. Nothing here needs Docker, a model, or
 * the network.
 *
 * What a habitat cannot be driven to — `rejected`, `input-required` — the
 * suite reports as skipped rather than pretending to cover.
 */

import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createHttpConformanceSubject,
	formatConformanceReport,
	runA2AConformance,
} from "@umwelten/protocols/a2a/conformance/index.js";
import { createA2AHandler, type A2AHandler } from "./a2a-handler.js";
import type { AgentHost } from "./types.js";
import type { ChannelBridge } from "./bridge/channel-bridge.js";
import type { BridgeEventHandlers, ChannelMessage } from "./bridge/types.js";

/** Directives the scripted bridge understands, mirroring the reference agent. */
const QUICK = "conformance:quick";
const SLOW = "conformance:slow";
const FAIL = "conformance:fail";

/**
 * A bridge that answers, hangs, or fails on request. Everything that would
 * reach a model stops here.
 */
function scriptedBridge(): ChannelBridge {
	return {
		handleMessage: async (
			msg: ChannelMessage,
			events: BridgeEventHandlers,
			signal?: AbortSignal,
		) => {
			if (msg.text.includes(FAIL)) {
				events.onError?.("failed on request");
				return;
			}

			if (msg.text.includes(SLOW)) {
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

			// Anything else — including QUICK — answers immediately.
			await events.onDone({
				content: "ok",
				sessionId: "conformance",
				channelKey: msg.channelKey,
			});
		},
	} as unknown as ChannelBridge;
}

/**
 * A habitat A2A surface on loopback, restartable the way a container is:
 * abruptly, with a new handler reading the same work directory back off disk.
 */
async function startHabitatAgent() {
	const workDir = await mkdtemp(join(tmpdir(), "a2a-conformance-habitat-"));
	const host = {
		getConfig: () => ({ name: "Conformance Habitat", agents: [] }),
		getStimulus: async () => ({ options: { role: "conformance target" } }),
		getWorkDir: () => workDir,
	} as unknown as AgentHost;

	let port = 0;
	let handler: A2AHandler;
	let server: Server;

	async function listen(): Promise<void> {
		// A fresh handler each generation: new FileTaskStore over the same
		// directory, and the boot recovery sweep runs before the first request.
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
		// Nothing tells the in-flight runs to stop, and nothing should: a
		// container that is killed does not get to publish a terminal event, and
		// the Task it leaves mid-flight is precisely what the next generation's
		// boot sweep has to find.
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

describe("A2A conformance — habitat surface", () => {
	it("conforms on every case a habitat can be driven through", async () => {
		const agent = await startHabitatAgent();
		try {
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					name: "habitat A2A surface",
					restart: () => agent.restart(),
					prompts: {
						quick: QUICK,
						slow: SLOW,
						fail: FAIL,
						// A habitat run either answers or fails; there is no way to ask
						// it for a rejection, and nothing yet parks a run on
						// `input-required`. Skipped, not faked.
						reject: null,
						"input-required": null,
					},
					pollIntervalMs: 10,
					settleTimeoutMs: 5_000,
				}),
			);

			expect(report.ok, formatConformanceReport(report)).toBe(true);
			// Everything except the two intents a habitat cannot produce.
			expect(report.passed).toBe(6);
			expect(report.skipped).toBe(3);
		} finally {
			await agent.stop();
		}
	}, 40_000);
});
