/**
 * A2A surface completion (issue #117):
 *  1. the agent card declares bearer auth iff the API key is enforced
 *  2. tasks/cancel aborts an in-flight run; canceling an unknown task
 *     returns a proper JSON-RPC error (via the real SDK transport)
 *  3. the answer carries token usage + model identity metadata
 *
 * v1 event model (SDK 1.x): executor events are `AgentEvent` wrappers
 * ({kind, data}); the reply rides the terminal status update's
 * `status.message` — there is no separate final Message event and no
 * `final` flag. The JSON-RPC-level tests deliberately speak the legacy
 * (0.3) wire: that is what the fleet speaks, and it exercises the compat
 * transport handler end to end.
 *
 * The bridge is stubbed — no models, no network.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskState } from "@a2a-js/sdk";
import type { BridgeResponseMetadata } from "./bridge/types.js";
import {
	partData,
	partFileUrl,
	partText,
	userMessage,
	type RequestContext,
	type ExecutionEventBus,
} from "@umwelten/protocols";
import {
	annotateServedCredentials,
	buildAgentCard,
	connectorNameFromPath,
	createA2AHandler,
	effectiveCredentialMode,
	HabitatAgentExecutor,
	toV1AgentCard,
	type RequiredCredential,
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
	const events: Array<Record<string, any>> = [];
	const bus = {
		publish: vi.fn((e: unknown) => {
			events.push(e as Record<string, any>);
		}),
		finished: vi.fn(),
	} as unknown as ExecutionEventBus;
	return { bus, events };
}

function requestContext(taskId = "task-1", contextId = "ctx-1", text = "hello"): RequestContext {
	return {
		taskId,
		contextId,
		userMessage: userMessage({ text, messageId: "msg-user-1" }),
	} as unknown as RequestContext;
}

/** The terminal status update event, whose status.message carries the reply. */
function terminalStatus(events: Array<Record<string, any>>) {
	return events.find(
		(e) =>
			e.kind === "statusUpdate" &&
			e.data?.status?.state === TaskState.TASK_STATE_COMPLETED,
	);
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

	it("serves a legacy-dialect protocolVersion and projects both versions to v1", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: await makeHost(),
			requiresApiKey: true,
		});
		// Served card: legacy shape for 0.3-era peers and the SaaS.
		expect(card.protocolVersion).toBe("0.3");
		// v1 projection: both protocol versions on the same URL, bearer
		// security carried across.
		const v1 = toV1AgentCard(card);
		expect(v1.supportedInterfaces.map((i) => i.protocolVersion)).toEqual([
			"1.0",
			"0.3",
		]);
		expect(v1.supportedInterfaces.every((i) => i.url === card.url)).toBe(true);
		expect(v1.securitySchemes.bearer?.scheme?.$case).toBe(
			"httpAuthSecurityScheme",
		);
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
		expect(task!.data.id).toBe("task-1");
		expect(task!.data.contextId).toBe("ctx-1");
		expect(task!.data.status.state).toBe(TaskState.TASK_STATE_SUBMITTED);
		expect(task!.data.history?.[0]?.messageId).toBe("msg-user-1");
		// v1 executor contract: the first published event is the task snapshot.
		expect(events[0]!.kind).toBe("task");
	});

	it("attaches token usage and model identity to the answer metadata", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.execute(requestContext(), bus);

		const final = terminalStatus(events);
		expect(final).toBeDefined();
		expect(final!.data.status.message?.metadata).toMatchObject({
			usage: { promptTokens: 42, completionTokens: 7, totalTokens: 49 },
			provider: "google",
			model: "gemini-3-flash-preview",
		});
	});

	/**
	 * #277: every answer carries what it was computed from, so metadata is no
	 * longer optional — a habitat with nothing checked out reports an empty
	 * repo list, which is a claim, not an absence.
	 */
	it("carries provenance on every answer, even one with no repos", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.execute(requestContext(), bus);

		const final = terminalStatus(events);
		const metadata = final!.data.status.message?.metadata;
		expect(metadata?.provenance).toMatchObject({
			stale: false,
			repos: [],
		});
		expect(metadata?.provenance?.capturedAt).toEqual(expect.any(String));
	});

	it("omits usage when the bridge result has none (non-default runtimes)", async () => {
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

		const final = terminalStatus(events);
		const metadata = final!.data.status.message?.metadata;
		expect(metadata?.usage).toBeUndefined();
		expect(metadata?.provider).toBeUndefined();
		expect(metadata?.model).toBeUndefined();
	});
});

describe("HabitatAgentExecutor — cancelTask", () => {
	it("aborts the in-flight run and emits a terminal canceled status", async () => {
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
			(e) =>
				e.kind === "statusUpdate" &&
				e.data?.status?.state === TaskState.TASK_STATE_CANCELED,
		);
		expect(canceled).toBeDefined();
		expect(canceled!.data.contextId).toBe("ctx-9");
		// The abort-driven onError must not publish a failed status on top of
		// the canceled one — one terminal event per run.
		const failed = events.find(
			(e) =>
				e.kind === "statusUpdate" &&
				e.data?.status?.state === TaskState.TASK_STATE_FAILED,
		);
		expect(failed).toBeUndefined();
	});

	it("still emits a canceled status when no run is active", async () => {
		const executor = new HabitatAgentExecutor(await makeHost(), instantBridge());
		const { bus, events } = fakeEventBus();

		await executor.cancelTask("ghost-task", bus);

		const canceled = events.find((e) => e.kind === "statusUpdate");
		expect(canceled!.data.status.state).toBe(TaskState.TASK_STATE_CANCELED);
	});
});

// ── Protocol-level: tasks/cancel routed through the real SDK ────
//
// These speak the LEGACY (0.3) wire on purpose: it is what the fleet
// speaks today, and it exercises the compat transport handler end to end
// (v1 executor events → legacy wire shapes with string states).

describe("tasks/cancel via the JSON-RPC transport (legacy wire)", () => {
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
		// Legacy wire spells states as strings.
		expect(cancelResponse.result?.status?.state).toBe("canceled");
	});
});

// ── 3b. UI resources over A2A (#195 / ADR 0005 slice B) ────────────
describe("HabitatAgentExecutor — UI resources", () => {
	it("carries a published UI resource as a data part and drains the buffer", async () => {
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

		const parts = terminalStatus(events)?.data.status.message?.parts ?? [];
		const data = parts.map((p: any) => partData(p)).find(Boolean) as
			| Record<string, unknown>
			| undefined;
		expect(data?.uri).toBe("ui://habitat/widget");
		const dataPartEntry = parts.find((p: any) => partData(p) !== undefined);
		expect(dataPartEntry?.metadata).toMatchObject({
			mcpUi: true,
			outputMode: "text/html+mcp",
		});
		expect(parts.some((p: any) => partText(p) !== undefined)).toBe(true);

		// Ephemeral: the buffer is cleared after the turn.
		const { readdir } = await import("node:fs/promises");
		expect(await readdir(dir)).toEqual([]);
	});

	it("emits no data part when no UI resource was published", async () => {
		const host = await makeHost();
		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		const parts = terminalStatus(events)?.data.status.message?.parts ?? [];
		expect(parts.some((p: any) => partData(p) !== undefined)).toBe(false);
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
		const ev = events.find((e) => e.kind === "artifactUpdate");
		const part = ev?.data?.artifact?.parts?.[0];
		return part ? partFileUrl(part) : undefined;
	}

	it("emits absolute-public file-part URLs when an origin resolves", async () => {
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

	it("publishes artifact-updates BEFORE the terminal status (stream-end order)", async () => {
		// In the v1 event model a terminal status update ends the stream —
		// anything published after it never reaches the wire. (Same hazard
		// as the 0.3-era message-terminates-stream behavior, verified against
		// live SSE 2026-07-11.)
		const host = await makeHost();
		await seedArtifact(host, "/files/artifacts/2026-x-foo.png");
		const executor = new HabitatAgentExecutor(host, instantBridge());
		const { bus, events } = fakeEventBus();
		await executor.execute(requestContext(), bus);
		const artifactIdx = events.findIndex((e) => e.kind === "artifactUpdate");
		const terminalIdx = events.findIndex(
			(e) =>
				e.kind === "statusUpdate" &&
				e.data?.status?.state === TaskState.TASK_STATE_COMPLETED,
		);
		expect(artifactIdx).toBeGreaterThan(-1);
		expect(terminalIdx).toBeGreaterThan(-1);
		expect(artifactIdx).toBeLessThan(terminalIdx);
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

describe("serve-time card annotation", () => {
	const oauthCred: RequiredCredential = {
		name: "TWITTER_REFRESH_TOKEN",
		label: "Connect your X account",
		required: true,
		type: "oauth",
		connectPath: "/connect/x",
	};
	const secretCred: RequiredCredential = {
		name: "OPENROUTER_API_KEY",
		label: "OpenRouter API key",
		required: true,
		type: "secret",
	};

	it("parses the provider name from a connect path", () => {
		expect(connectorNameFromPath("/connect/x")).toBe("x");
		expect(connectorNameFromPath("/connect/google")).toBe("google");
		expect(connectorNameFromPath("/connect")).toBeUndefined();
	});

	it("annotates configured and fills oauth scopes from the live connector", () => {
		const annotated = annotateServedCredentials([oauthCred, secretCred], {
			isSecretAvailable: (name) => name === "OPENROUTER_API_KEY",
			connectorScopes: (provider) =>
				provider === "x" ? ["tweet.read", "offline.access"] : undefined,
		});
		expect(annotated[0]).toMatchObject({
			configured: false,
			scopes: ["tweet.read", "offline.access"],
		});
		expect(annotated[1]).toMatchObject({ configured: true });
		expect(annotated[1].scopes).toBeUndefined(); // never invents scopes for plain secrets
	});

	it("declared scopes win over connector defaults", () => {
		const declared = { ...oauthCred, scopes: ["bookmark.read"] };
		const annotated = annotateServedCredentials([declared], {
			isSecretAvailable: () => false,
			connectorScopes: () => ["tweet.read"],
		});
		expect(annotated[0].scopes).toEqual(["bookmark.read"]);
	});

	it("effectiveCredentialMode: explicit config always wins", () => {
		expect(effectiveCredentialMode("per-user", [oauthCred], true)).toBe("per-user");
		expect(effectiveCredentialMode("shared", [oauthCred], true)).toBe("shared");
	});

	it("effectiveCredentialMode: per-user connect surface implies hybrid", () => {
		// This is the fleet-migration path: volumes seeded before credentialMode
		// existed must advertise the enforcement default rather than nothing.
		expect(effectiveCredentialMode(undefined, [oauthCred], true)).toBe("hybrid");
	});

	it("effectiveCredentialMode: no oauth credential or no connector → no policy", () => {
		expect(effectiveCredentialMode(undefined, [secretCred], true)).toBeUndefined();
		expect(effectiveCredentialMode(undefined, [oauthCred], false)).toBeUndefined();
		expect(effectiveCredentialMode(undefined, undefined, true)).toBeUndefined();
	});
});
