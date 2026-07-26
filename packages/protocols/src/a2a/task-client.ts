/**
 * A2A task surface for callers — the half of the protocol this repo never
 * used.
 *
 * `message/send` blocks until the agent finishes. That is fine for a quick
 * question and wrong for two situations this fleet now has: a habitat that is
 * asleep and has to boot before it can answer, and work that genuinely takes
 * minutes (a rollup across every client habitat). Both exceed any sane HTTP
 * timeout.
 *
 * A2A already models this. A send with `configuration.blocking: false` returns
 * a **Task** in a non-terminal state straight away; the caller then tracks it
 * with `tasks/get` until it reaches a terminal or interrupted state. Per
 * ADR 0007 a dormant habitat is not a special case — it is a task that takes
 * longer to reach `working`.
 *
 * Everything here is built on the SDK's `JsonRpcTransport` rather than
 * hand-rolled JSON-RPC, so wire-format handling is the SDK's problem.
 *
 * Note for readers comparing against the A2A docs: the pinned SDK (0.3.14)
 * spells non-blocking as `configuration.blocking: false`, not
 * `returnImmediately`, and serves no `tasks/list`.
 */

import { JsonRpcTransport } from "@a2a-js/sdk/client";
import type { Message, Task, TaskState } from "@a2a-js/sdk";
import {
	isInterruptedTaskState,
	isTerminalTaskState,
} from "./file-task-store.js";

/** Default ceiling on how long `pollA2ATask` will wait. */
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
/** Starting gap between polls; backs off up to {@link MAX_POLL_INTERVAL_MS}. */
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 15_000;

/**
 * Normalise an agent's base URL to its JSON-RPC endpoint. A bare origin gets
 * `/a2a` appended; an endpoint that already ends in `/a2a` is left alone.
 *
 * Addressing a container by host and port is not a reason to hand-roll a
 * client — `http://127.0.0.1:7440` is a perfectly good URL.
 */
export function resolveA2AEndpointUrl(endpoint: string): string {
	const url = new URL(endpoint);
	const path = url.pathname.replace(/\/+$/, "");
	if (!path.endsWith("/a2a")) url.pathname = `${path}/a2a`;
	return url.toString();
}

/** Wraps fetch so every request the transport makes carries the bearer. */
function authenticatedFetch(apiKey?: string): typeof fetch {
	if (!apiKey) return fetch;
	return (input, init) =>
		fetch(input, {
			...init,
			headers: {
				...(init?.headers as Record<string, string> | undefined),
				authorization: `Bearer ${apiKey}`,
			},
		});
}

/** Build a transport pointed at an agent's JSON-RPC endpoint. */
export function createA2ATransport(
	endpoint: string,
	apiKey?: string,
): JsonRpcTransport {
	return new JsonRpcTransport({
		endpoint: resolveA2AEndpointUrl(endpoint),
		fetchImpl: authenticatedFetch(apiKey),
	});
}

export interface A2ATaskTarget {
	/** Agent base URL or full `/a2a` endpoint. */
	endpoint: string;
	/** Optional bearer token. */
	apiKey?: string;
}

export interface SendA2ATaskOptions extends A2ATaskTarget {
	/** User text to send. */
	text: string;
	/** Thread this message into an existing conversation. */
	contextId?: string;
	/**
	 * Wait for completion. Defaults to false — the point of this function is
	 * to get a Task back before the work is done.
	 */
	blocking?: boolean;
	/** Where the agent should POST status updates, if it supports them. */
	pushNotificationUrl?: string;
}

function newMessageId(): string {
	return `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send a message without waiting for the answer. Resolves as soon as the agent
 * acknowledges, normally with a Task in `submitted` or `working`.
 *
 * An agent may still answer immediately with a Message rather than a Task —
 * that is legal, and callers must handle both.
 */
export async function sendA2ATask(
	options: SendA2ATaskOptions,
): Promise<Task | Message> {
	const transport = createA2ATransport(options.endpoint, options.apiKey);
	return transport.sendMessage({
		message: {
			kind: "message",
			messageId: newMessageId(),
			role: "user",
			parts: [{ kind: "text", text: options.text }],
			...(options.contextId ? { contextId: options.contextId } : {}),
		},
		configuration: {
			blocking: options.blocking ?? false,
			...(options.pushNotificationUrl
				? { pushNotificationConfig: { url: options.pushNotificationUrl } }
				: {}),
		},
	}) as Promise<Task | Message>;
}

/** True when the result of a send is a Task rather than an immediate Message. */
export function isA2ATask(result: Task | Message): result is Task {
	return (result as Task)?.kind === "task";
}

export interface GetA2ATaskOptions extends A2ATaskTarget {
	taskId: string;
	/** Trailing messages of the task's history to include. */
	historyLength?: number;
}

/** Fetch a task's current state. */
export async function getA2ATask(options: GetA2ATaskOptions): Promise<Task> {
	const transport = createA2ATransport(options.endpoint, options.apiKey);
	return transport.getTask({
		id: options.taskId,
		...(options.historyLength !== undefined
			? { historyLength: options.historyLength }
			: {}),
	});
}

/** Ask the agent to stop a task that is still running. */
export async function cancelA2ATask(
	options: A2ATaskTarget & { taskId: string },
): Promise<Task> {
	const transport = createA2ATransport(options.endpoint, options.apiKey);
	return transport.cancelTask({ id: options.taskId });
}

/**
 * A task has settled when it will not move again on its own — either it
 * finished, or it is waiting on someone. `auth-required` and `input-required`
 * count: continuing to poll them would spin forever, because the agent is
 * waiting for the caller, not the other way round.
 */
export function isSettledTaskState(state: TaskState | undefined): boolean {
	return isTerminalTaskState(state) || isInterruptedTaskState(state);
}

export interface PollA2ATaskOptions extends GetA2ATaskOptions {
	/** Gap between polls; backs off toward 15s. Default 1s. */
	intervalMs?: number;
	/** Give up after this long. Default 15 minutes. */
	timeoutMs?: number;
	/** Caller-side cancellation. */
	signal?: AbortSignal;
	/** Called with each observed state, for progress reporting. */
	onState?: (task: Task) => void;
	/** Injectable sleep, so tests do not wait in real time. */
	sleep?: (ms: number) => Promise<void>;
	/** Injectable clock, so tests do not depend on wall time. */
	now?: () => number;
}

export class A2APollTimeoutError extends Error {
	constructor(
		readonly taskId: string,
		readonly lastState: TaskState | undefined,
		timeoutMs: number,
	) {
		super(
			`Task ${taskId} did not settle within ${timeoutMs}ms (last state: ${lastState ?? "unknown"})`,
		);
		this.name = "A2APollTimeoutError";
	}
}

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll a task until it settles, and return it.
 *
 * Backs off from `intervalMs` toward 15s: a habitat cold-starting behind a
 * clone and a dependency install can take minutes, and hammering it every
 * second for the whole boot helps nobody.
 */
export async function pollA2ATask(options: PollA2ATaskOptions): Promise<Task> {
	const sleep = options.sleep ?? defaultSleep;
	const now = options.now ?? (() => Date.now());
	const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	const startedAt = now();

	let interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	let lastState: TaskState | undefined;

	for (;;) {
		options.signal?.throwIfAborted();

		const task = await getA2ATask(options);
		lastState = task.status?.state;
		options.onState?.(task);

		if (isSettledTaskState(lastState)) return task;

		if (now() - startedAt >= timeoutMs) {
			throw new A2APollTimeoutError(options.taskId, lastState, timeoutMs);
		}

		await sleep(interval);
		interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
	}
}

export interface SendAndAwaitOptions extends SendA2ATaskOptions {
	intervalMs?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	onState?: (task: Task) => void;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

/**
 * Send without blocking, then track the task to settlement — the shape a
 * caller wants when the agent might be asleep. Returns the Message directly
 * if the agent answered immediately instead of opening a task.
 */
export async function sendAndAwaitA2ATask(
	options: SendAndAwaitOptions,
): Promise<Task | Message> {
	const sent = await sendA2ATask(options);
	if (!isA2ATask(sent)) return sent;
	if (isSettledTaskState(sent.status?.state)) return sent;

	return pollA2ATask({
		endpoint: options.endpoint,
		apiKey: options.apiKey,
		taskId: sent.id,
		intervalMs: options.intervalMs,
		timeoutMs: options.timeoutMs,
		signal: options.signal,
		onState: options.onState,
		sleep: options.sleep,
		now: options.now,
	});
}
