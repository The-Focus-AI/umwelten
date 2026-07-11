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
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

	it("advertises the text/html+mcp output mode for UI resources (#195)", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
		});
		expect(card.defaultOutputModes).toContain("text/html+mcp");
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

// ── 3b. UI resources over A2A (#195 / ADR 0005 slice B) ────────────
describe("HabitatAgentExecutor — UI resources", () => {
	it("carries a published UI resource as a DataPart and drains the buffer", async () => {
		const host = await makeHost();
		const dir = join(host.getWorkDir(), "ui-resources");
		await mkdir(dir, { recursive: true });
		await writeFile(
			`${dir}/2026-x-ui.json`,
			JSON.stringify({
				uri: "ui://habitat/widget",
				mimeType: "text/html;profile=mcp-app",
				text: "<h1>hi</h1>",
			}),
		);

		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);

		const msg = events.find((e) => e.kind === "message");
		const dataPart = msg?.parts?.find((p: any) => p.kind === "data");
		expect(dataPart?.data?.uri).toBe("ui://habitat/widget");
		expect(dataPart?.metadata).toMatchObject({
			mcpUi: true,
			outputMode: "text/html+mcp",
		});
		expect(msg?.parts?.some((p: any) => p.kind === "text")).toBe(true);

		// Ephemeral: the buffer is cleared after the turn.
		const { readdir } = await import("node:fs/promises");
		expect(await readdir(dir)).toEqual([]);
	});

	it("emits no data part when no UI resource was published", async () => {
		const host = await makeHost();
		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		const msg = events.find((e) => e.kind === "message");
		expect(msg?.parts?.some((p: any) => p.kind === "data")).toBe(false);
	});
});

// ── 4. artifact URL absolutization (#194 / ADR 0005) ───────────────
describe("HabitatAgentExecutor — artifact URLs", () => {
	async function seedArtifact(
		host: AgentHost,
		url: string,
	): Promise<void> {
		const dir = join(host.getWorkDir(), "artifacts");
		await mkdir(dir, { recursive: true });
		const meta = {
			sourcePath: "/data/out.png",
			artifactPath: `${dir}/2026-x-foo.png`,
			name: "Foo",
			mimeType: "image/png",
			timestamp: "2026-06-23T00:00:00.000Z",
			url,
		};
		await writeFile(`${dir}/2026-x-foo.meta.json`, JSON.stringify(meta));
	}

	function artifactUri(events: Array<Record<string, any>>): string | undefined {
		const ev = events.find((e) => e.kind === "artifact-update");
		return ev?.artifact?.parts?.[0]?.file?.uri;
	}

	it("emits absolute-public FilePart URIs when an origin resolves", async () => {
		const host = await makeHost();
		await seedArtifact(host, "/files/artifacts/2026-x-foo.png");
		const executor = new HabitatAgentExecutor(
			host,
			instantBridge(),
			() => "https://agent.example.com",
		);
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		expect(artifactUri(events)).toBe(
			"https://agent.example.com/files/artifacts/2026-x-foo.png",
		);
	});

	it("publishes artifact-updates BEFORE the final message (terminal-event order)", async () => {
		// The A2A transport ends the stream at the agent message — anything
		// published after it never reaches the wire. Verified against live SSE
		// 2026-07-11: artifacts emitted post-message were silently dropped.
		const host = await makeHost();
		await seedArtifact(host, "/files/artifacts/2026-x-foo.png");
		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		const artifactIdx = events.findIndex((e) => e.kind === "artifact-update");
		const messageIdx = events.findIndex((e) => e.kind === "message");
		expect(artifactIdx).toBeGreaterThan(-1);
		expect(messageIdx).toBeGreaterThan(-1);
		expect(artifactIdx).toBeLessThan(messageIdx);
	});

	it("leaves URIs relative when no origin resolver is provided (back-compat)", async () => {
		const host = await makeHost();
		await seedArtifact(host, "/files/artifacts/2026-x-foo.png");
		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		expect(artifactUri(events)).toBe("/files/artifacts/2026-x-foo.png");
	});

	it("never rewrites an already-absolute stored URI", async () => {
		const host = await makeHost();
		await seedArtifact(host, "https://cdn.example.com/files/artifacts/a.png");
		const executor = new HabitatAgentExecutor(
			host,
			instantBridge(),
			() => "https://agent.example.com",
		);
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		expect(artifactUri(events)).toBe(
			"https://cdn.example.com/files/artifacts/a.png",
		);
	});
});

describe("buildAgentCard — requiredCredentials (ADR 0004)", () => {
	function hostWithSecrets(): AgentHost {
		return {
			getConfig: () => ({
				name: "Twitter",
				agents: [],
				requiredSecrets: [
					{ name: "TWITTER_CLIENT_ID", label: "X Client ID", required: true, type: "secret" },
					{ name: "TWITTER_CLIENT_SECRET", required: true }, // no type → defaults to secret
					{ name: "TWITTER_REFRESH_TOKEN", label: "Connect X", required: true, type: "oauth", connectPath: "/connect/x" },
				],
			}),
			getStimulus: async () => ({ options: { role: "x agent" } }),
			getWorkDir: () => "/tmp",
		} as unknown as AgentHost;
	}

	it("emits requiredCredentials from config.requiredSecrets", async () => {
		const card = await buildAgentCard({ baseUrl: "http://h", habitat: hostWithSecrets() });
		const byName = Object.fromEntries(
			(card.requiredCredentials ?? []).map((c) => [c.name, c]),
		);
		expect(byName.TWITTER_CLIENT_ID).toMatchObject({ label: "X Client ID", type: "secret", required: true });
		// missing type defaults to "secret"; missing label defaults to name
		expect(byName.TWITTER_CLIENT_SECRET).toMatchObject({ type: "secret", label: "TWITTER_CLIENT_SECRET" });
		// oauth credential carries its connect path so the SaaS renders a Connect button
		expect(byName.TWITTER_REFRESH_TOKEN).toMatchObject({ type: "oauth", connectPath: "/connect/x" });
	});

	it("omits requiredCredentials when the config declares none", async () => {
		const card = await buildAgentCard({ baseUrl: "http://h", habitat: await makeHost() });
		expect(card.requiredCredentials).toBeUndefined();
	});
});
