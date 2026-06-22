/**
 * A2A surface completion (issue #117):
 *  1. the agent card declares bearer auth iff the API key is enforced
 *  2. tasks/cancel aborts an in-flight run; canceling an unknown task
 *     returns a proper JSON-RPC error (via the real SDK transport)
 *  3. the final A2A message carries token usage + model identity metadata
 *
 * The bridge is stubbed — no models, no network.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BridgeResponseMetadata } from "./bridge/types.js";
import type {
	RequestContext,
	ExecutionEventBus,
} from "@umwelten/protocols";
import {
	buildAgentCard,
	createA2AHandler,
	HabitatAgentExecutor,
} from "./a2a-handler.js";
import type { AgentHost } from "./types.js";
import type { ChannelBridge } from "./bridge/channel-bridge.js";
import type { BridgeEventHandlers, ChannelMessage } from "./bridge/types.js";

async function makeHost(): Promise<AgentHost> {
	const workDir = await mkdtemp(join(tmpdir(), "a2a-handler-test-"));
	return {
		getConfig: () => ({ name: "Test Agent", agents: [] }),
		getStimulus: async () => ({ options: { role: "test assistant" } }),
		getWorkDir: () => workDir,
	} as unknown as AgentHost;
}

function fakeEventBus() {
	const events: unknown[] = [];
	const bus = {
		publish: vi.fn((e: unknown) => {
			events.push(e);
		}),
		finished: vi.fn(),
	} as unknown as ExecutionEventBus;
	return { bus, events: events as Array<Record<string, any>> };
}

function requestContext(taskId = "task-1", contextId = "ctx-1", text = "hello"): RequestContext {
	return {
		taskId,
		contextId,
		userMessage: {
			kind: "message",
			messageId: "msg-user-1",
			role: "user",
			parts: [{ kind: "text", text }],
		},
	} as unknown as RequestContext;
}

const SAMPLE_METADATA = {
	startTime: new Date(),
	endTime: new Date(),
	tokenUsage: { promptTokens: 42, completionTokens: 7, total: 49 },
	provider: "google",
	model: "gemini-3-flash-preview",
	cost: { promptCost: 0, completionCost: 0, totalCost: 0 },
} as unknown as BridgeResponseMetadata;

/** A bridge whose handleMessage resolves immediately with a canned result. */
function instantBridge(content = "hi there"): ChannelBridge {
	return {
		handleMessage: async (
			msg: ChannelMessage,
			events: BridgeEventHandlers,
			_signal?: AbortSignal,
		) => {
			events.onText?.(content);
			await events.onDone({
				content,
				sessionId: "sess-1",
				channelKey: msg.channelKey,
				metadata: SAMPLE_METADATA,
			});
		},
	} as unknown as ChannelBridge;
}

// ── 1. securitySchemes ───────────────────────────────────────────

describe("buildAgentCard — securitySchemes", () => {
	it("omits security declarations when no API key is enforced", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
		});
		expect(card.securitySchemes).toBeUndefined();
		expect(card.security).toBeUndefined();
	});

	it("declares HTTP bearer auth iff the API key is set", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
			requiresApiKey: true,
		});
		expect(card.securitySchemes).toEqual({
			bearer: expect.objectContaining({ type: "http", scheme: "bearer" }),
		});
		expect(card.security).toEqual([{ bearer: [] }]);
	});

	it("advertises bearerFormat JWT in jwt mode (per-user grants, ADR 0003)", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
			requiresApiKey: true,
			jwtMode: true,
		});
		expect(
			(card.securitySchemes as Record<string, { bearerFormat?: string }>).bearer
				.bearerFormat,
		).toBe("JWT");
	});

	it("omits bearerFormat for a plain shared bearer (no jwt mode)", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
			requiresApiKey: true,
		});
		expect(
			(card.securitySchemes as Record<string, { bearerFormat?: string }>).bearer
				.bearerFormat,
		).toBeUndefined();
	});
});

// ── 2 + 3. executor: task tracking, usage metadata, cancel ──────

describe("HabitatAgentExecutor — execute", () => {
	it("publishes an initial Task so the store can track (and cancel) the run", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.execute(requestContext(), bus);

		const task = events.find((e) => e.kind === "task");
		expect(task).toBeDefined();
		expect(task!.id).toBe("task-1");
		expect(task!.contextId).toBe("ctx-1");
		expect(task!.status.state).toBe("submitted");
		expect(task!.history?.[0]?.messageId).toBe("msg-user-1");
	});

	it("attaches token usage and model identity to the final message metadata", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.execute(requestContext(), bus);

		const final = events.find((e) => e.kind === "message");
		expect(final).toBeDefined();
		expect(final!.metadata).toEqual({
			usage: { promptTokens: 42, completionTokens: 7, totalTokens: 49 },
			provider: "google",
			model: "gemini-3-flash-preview",
		});
	});

	it("omits metadata when the bridge result has none (non-default runtimes)", async () => {
		const bridge = {
			handleMessage: async (msg: ChannelMessage, events: BridgeEventHandlers) => {
				await events.onDone({
					content: "done",
					sessionId: "s",
					channelKey: msg.channelKey,
				});
			},
		} as unknown as ChannelBridge;
		const executor = new HabitatAgentExecutor(await makeHost(), bridge);
		const { bus, events } = fakeEventBus();

		await executor.execute(requestContext(), bus);

		const final = events.find((e) => e.kind === "message");
		expect(final!.metadata).toBeUndefined();
	});
});

describe("HabitatAgentExecutor — cancelTask", () => {
	it("aborts the in-flight run and emits a final canceled status", async () => {
		// A bridge that only settles when the abort signal fires.
		let sawAbort = false;
		const bridge = {
			handleMessage: (
				_msg: ChannelMessage,
				events: BridgeEventHandlers,
				signal?: AbortSignal,
			) =>
				new Promise<void>((resolvePromise) => {
					signal?.addEventListener("abort", () => {
						sawAbort = true;
						events.onError?.("aborted");
						resolvePromise();
					});
				}),
		} as unknown as ChannelBridge;

		const executor = new HabitatAgentExecutor(await makeHost(), bridge);
		const { bus, events } = fakeEventBus();

		const running = executor.execute(requestContext("task-9", "ctx-9"), bus);
		// Let execute() register the active task before canceling.
		await new Promise((r) => setTimeout(r, 0));

		await executor.cancelTask("task-9", bus);
		await running;

		expect(sawAbort).toBe(true);
		const canceled = events.find(
			(e) => e.kind === "status-update" && e.status?.state === "canceled",
		);
		expect(canceled).toBeDefined();
		expect(canceled!.final).toBe(true);
		expect(canceled!.contextId).toBe("ctx-9");
		// The abort-driven onError must not publish an error message on top
		// of the canceled status.
		const errorMsg = events.find(
			(e) =>
				e.kind === "message" &&
				e.parts?.[0]?.text?.startsWith("Error:"),
		);
		expect(errorMsg).toBeUndefined();
	});

	it("still emits a canceled status when no run is active", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.cancelTask("ghost-task", bus);

		const canceled = events.find((e) => e.kind === "status-update");
		expect(canceled!.status.state).toBe("canceled");
	});
});

// ── Protocol-level: tasks/cancel routed through the real SDK ────

describe("tasks/cancel via the JSON-RPC transport", () => {
	it("returns a proper JSON-RPC error for an unknown task", async () => {
		const handler = await createA2AHandler({
			habitat: await makeHost(),
			bridge: instantBridge(),
			baseUrl: "http://localhost:7430",
		});

		const response = (await handler.transportHandler.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "tasks/cancel",
			params: { id: "no-such-task" },
		})) as Record<string, any>;

		expect(response.jsonrpc).toBe("2.0");
		expect(response.error).toBeDefined();
		expect(response.error.code).toBe(-32001); // TaskNotFound
		expect(response.result).toBeUndefined();
	});

	it("cancels a task created by message/send", async () => {
		// Bridge that stays in-flight until aborted, so the task is active
		// in the store when the cancel RPC arrives.
		const bridge = {
			handleMessage: (
				_msg: ChannelMessage,
				events: BridgeEventHandlers,
				signal?: AbortSignal,
			) =>
				new Promise<void>((resolvePromise) => {
					signal?.addEventListener("abort", () => {
						events.onError?.("aborted");
						resolvePromise();
					});
				}),
		} as unknown as ChannelBridge;

		const handler = await createA2AHandler({
			habitat: await makeHost(),
			bridge,
			baseUrl: "http://localhost:7430",
		});

		// Fire a streaming send (don't await — it stays in-flight).
		const stream = (await handler.transportHandler.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "message/stream",
			params: {
				message: {
					kind: "message",
					messageId: "m-1",
					role: "user",
					parts: [{ kind: "text", text: "long running job" }],
				},
			},
		})) as AsyncGenerator<Record<string, any>>;

		// Read events until the Task record exists (first event carries it).
		const first = await stream.next();
		const taskId = first.value?.result?.id;
		expect(taskId).toBeDefined();

		const cancelResponse = (await handler.transportHandler.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "tasks/cancel",
			params: { id: taskId },
		})) as Record<string, any>;

		expect(cancelResponse.error).toBeUndefined();
		expect(cancelResponse.result?.status?.state).toBe("canceled");
	});
});
