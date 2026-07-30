import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TaskState, type Task } from "@a2a-js/sdk";
import {
	taskStateFromLegacy,
	type LegacyTaskState,
} from "./v1-compat.js";
import {
	A2APollTimeoutError,
	cancelA2ATask,
	getA2ATask,
	isA2ATask,
	isSettledTaskState,
	pollA2ATask,
	resolveA2AEndpointUrl,
	sendA2ATask,
	sendAndAwaitA2ATask,
} from "./task-client.js";

const ENDPOINT = "http://127.0.0.1:7440";

/**
 * A Task as it appears on the 0.3 JSON-RPC wire — the dialect the compat
 * transport speaks — with the legacy state spelling. The transport translates
 * this into a v1 {@link Task} (numeric enum states, no `kind`).
 */
function wireTask(state: LegacyTaskState, id = "t1"): Record<string, unknown> {
	return {
		kind: "task",
		id,
		contextId: "ctx",
		status: { state, timestamp: "2026-07-25T00:00:00.000Z" },
	};
}

interface Call {
	url: string;
	method: string;
	params: Record<string, unknown>;
	headers: Record<string, string>;
}

let calls: Call[];
let originalFetch: typeof fetch;

/** Stubs fetch with a queue of JSON-RPC results, one per request. */
function stubRpc(results: unknown[]): void {
	let i = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? "{}"));
		calls.push({
			url: String(input),
			method: body.method,
			params: body.params ?? {},
			headers: (init?.headers ?? {}) as Record<string, string>,
		});
		const result = results[Math.min(i, results.length - 1)];
		i += 1;
		return new Response(
			JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}) as typeof fetch;
}

beforeEach(() => {
	calls = [];
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const noSleep = async () => {};

describe("resolveA2AEndpointUrl", () => {
	it("appends /a2a to a bare origin", () => {
		expect(resolveA2AEndpointUrl("http://host:7440")).toBe("http://host:7440/a2a");
	});

	it("leaves an endpoint that already targets /a2a alone", () => {
		expect(resolveA2AEndpointUrl("http://host:7440/a2a")).toBe("http://host:7440/a2a");
	});

	it("tolerates a trailing slash", () => {
		expect(resolveA2AEndpointUrl("http://host:7440/")).toBe("http://host:7440/a2a");
	});

	it("appends beneath a base path", () => {
		expect(resolveA2AEndpointUrl("https://x.dev/agents/bot")).toBe(
			"https://x.dev/agents/bot/a2a",
		);
	});

	it("treats a loopback host:port origin as an ordinary URL", () => {
		expect(resolveA2AEndpointUrl("http://127.0.0.1:7440")).toBe(
			"http://127.0.0.1:7440/a2a",
		);
	});
});

describe("sendA2ATask", () => {
	it("does not block by default, so a cold start is not a timeout", async () => {
		stubRpc([wireTask("submitted")]);
		await sendA2ATask({ endpoint: ENDPOINT, text: "hi" });
		expect(calls[0].method).toBe("message/send");
		expect((calls[0].params as any).configuration.blocking).toBe(false);
	});

	it("can block when a caller explicitly wants the answer", async () => {
		stubRpc([wireTask("completed")]);
		await sendA2ATask({ endpoint: ENDPOINT, text: "hi", blocking: true });
		expect((calls[0].params as any).configuration.blocking).toBe(true);
	});

	it("returns the Task the agent opened", async () => {
		stubRpc([wireTask("working")]);
		const result = await sendA2ATask({ endpoint: ENDPOINT, text: "hi" });
		expect(isA2ATask(result)).toBe(true);
		expect((result as Task).id).toBe("t1");
	});

	it("returns a Message when the agent answers immediately instead", async () => {
		stubRpc([
			{ kind: "message", role: "agent", messageId: "m1", parts: [{ kind: "text", text: "hi" }] },
		]);
		const result = await sendA2ATask({ endpoint: ENDPOINT, text: "hi" });
		expect(isA2ATask(result)).toBe(false);
	});

	it("threads into an existing conversation when given a contextId", async () => {
		stubRpc([wireTask("submitted")]);
		await sendA2ATask({ endpoint: ENDPOINT, text: "hi", contextId: "ctx-9" });
		expect((calls[0].params as any).message.contextId).toBe("ctx-9");
	});

	it("sends a bearer token when one is configured", async () => {
		stubRpc([wireTask("submitted")]);
		await sendA2ATask({ endpoint: ENDPOINT, text: "hi", apiKey: "secret" });
		expect(calls[0].headers.authorization).toBe("Bearer secret");
	});

	it("sends no authorization header when no token is configured", async () => {
		stubRpc([wireTask("submitted")]);
		await sendA2ATask({ endpoint: ENDPOINT, text: "hi" });
		expect(calls[0].headers.authorization).toBeUndefined();
	});

	it("registers a push notification target when asked", async () => {
		stubRpc([wireTask("submitted")]);
		await sendA2ATask({
			endpoint: ENDPOINT,
			text: "hi",
			pushNotificationUrl: "https://hook.example/1",
		});
		expect((calls[0].params as any).configuration.pushNotificationConfig.url).toBe(
			"https://hook.example/1",
		);
	});
});

describe("getA2ATask / cancelA2ATask", () => {
	it("fetches a task by id", async () => {
		stubRpc([wireTask("working")]);
		const result = await getA2ATask({ endpoint: ENDPOINT, taskId: "t1" });
		expect(calls[0].method).toBe("tasks/get");
		expect((calls[0].params as any).id).toBe("t1");
		expect(result.status?.state).toBe(TaskState.TASK_STATE_WORKING);
	});

	it("cancels a task by id", async () => {
		stubRpc([wireTask("canceled")]);
		const result = await cancelA2ATask({ endpoint: ENDPOINT, taskId: "t1" });
		expect(calls[0].method).toBe("tasks/cancel");
		expect(result.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
	});
});

describe("isSettledTaskState", () => {
	it.each(["completed", "failed", "canceled", "rejected"] as LegacyTaskState[])(
		"treats terminal state %s as settled",
		(state) => expect(isSettledTaskState(taskStateFromLegacy(state))).toBe(true),
	);

	it.each(["input-required", "auth-required"] as LegacyTaskState[])(
		"treats %s as settled — the agent is waiting on us, so polling would spin forever",
		(state) => expect(isSettledTaskState(taskStateFromLegacy(state))).toBe(true),
	);

	it.each(["submitted", "working"] as LegacyTaskState[])(
		"treats in-flight state %s as unsettled",
		(state) => expect(isSettledTaskState(taskStateFromLegacy(state))).toBe(false),
	);
});

describe("pollA2ATask", () => {
	it("returns as soon as the task completes", async () => {
		stubRpc([wireTask("working"), wireTask("working"), wireTask("completed")]);
		const result = await pollA2ATask({
			endpoint: ENDPOINT,
			taskId: "t1",
			sleep: noSleep,
		});
		expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
		expect(calls).toHaveLength(3);
	});

	it("stops at an interrupted state rather than polling forever", async () => {
		stubRpc([wireTask("working"), wireTask("auth-required")]);
		const result = await pollA2ATask({
			endpoint: ENDPOINT,
			taskId: "t1",
			sleep: noSleep,
		});
		expect(result.status?.state).toBe(TaskState.TASK_STATE_AUTH_REQUIRED);
	});

	it("reports each observed state so a caller can show progress", async () => {
		stubRpc([wireTask("submitted"), wireTask("working"), wireTask("completed")]);
		const seen: Array<TaskState | undefined> = [];
		await pollA2ATask({
			endpoint: ENDPOINT,
			taskId: "t1",
			sleep: noSleep,
			onState: (t) => seen.push(t.status?.state),
		});
		expect(seen).toEqual([
			TaskState.TASK_STATE_SUBMITTED,
			TaskState.TASK_STATE_WORKING,
			TaskState.TASK_STATE_COMPLETED,
		]);
	});

	it("backs off between polls instead of hammering a booting habitat", async () => {
		stubRpc([wireTask("working"), wireTask("working"), wireTask("working"), wireTask("completed")]);
		const waits: number[] = [];
		await pollA2ATask({
			endpoint: ENDPOINT,
			taskId: "t1",
			intervalMs: 100,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		expect(waits).toEqual([100, 200, 400]);
	});

	it("caps the backoff so a long wake never stalls out", async () => {
		stubRpc([...Array(12).fill(wireTask("working")), wireTask("completed")]);
		const waits: number[] = [];
		await pollA2ATask({
			endpoint: ENDPOINT,
			taskId: "t1",
			intervalMs: 1_000,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		expect(Math.max(...waits)).toBe(15_000);
	});

	it("throws a timeout error naming the last state it saw", async () => {
		stubRpc([wireTask("working")]);
		let clock = 0;
		await expect(
			pollA2ATask({
				endpoint: ENDPOINT,
				taskId: "t1",
				timeoutMs: 500,
				sleep: noSleep,
				now: () => (clock += 1_000),
			}),
		).rejects.toThrow(A2APollTimeoutError);
	});

	it("stops when the caller aborts", async () => {
		stubRpc([wireTask("working")]);
		const controller = new AbortController();
		controller.abort();
		await expect(
			pollA2ATask({
				endpoint: ENDPOINT,
				taskId: "t1",
				sleep: noSleep,
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});
});

describe("sendAndAwaitA2ATask", () => {
	it("tracks a task opened by the send through to completion", async () => {
		stubRpc([wireTask("submitted"), wireTask("working"), wireTask("completed")]);
		const result = await sendAndAwaitA2ATask({
			endpoint: ENDPOINT,
			text: "hi",
			sleep: noSleep,
		});
		expect((result as Task).status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
		expect(calls[0].method).toBe("message/send");
		expect(calls[1].method).toBe("tasks/get");
	});

	it("does not poll when the send already came back settled", async () => {
		stubRpc([wireTask("completed")]);
		await sendAndAwaitA2ATask({ endpoint: ENDPOINT, text: "hi", sleep: noSleep });
		expect(calls).toHaveLength(1);
	});

	it("returns an immediate Message without polling", async () => {
		stubRpc([
			{ kind: "message", role: "agent", messageId: "m1", parts: [{ kind: "text", text: "yo" }] },
		]);
		const result = await sendAndAwaitA2ATask({
			endpoint: ENDPOINT,
			text: "hi",
			sleep: noSleep,
		});
		expect(isA2ATask(result)).toBe(false);
		expect(calls).toHaveLength(1);
	});

	it("carries the bearer token through to the polling calls", async () => {
		stubRpc([wireTask("working"), wireTask("completed")]);
		await sendAndAwaitA2ATask({
			endpoint: ENDPOINT,
			text: "hi",
			apiKey: "secret",
			sleep: noSleep,
		});
		expect(calls.every((c) => c.headers.authorization === "Bearer secret")).toBe(true);
	});
});
