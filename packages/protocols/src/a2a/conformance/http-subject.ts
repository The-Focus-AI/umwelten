/**
 * This repo's client, wired up as a conformance subject.
 *
 * Nothing here is clever on purpose — it is `sendA2ATask` / `getA2ATask` /
 * `cancelA2ATask` behind the interface the cases talk to. The value is in what
 * it demonstrates: the suite needs *this much* of a client and no more, so the
 * control plane can supply its own (per-user grants, database-backed
 * addressing) without either client learning about the other (ADR 0007).
 */

import type { Message, Task } from "@a2a-js/sdk";
import {
	cancelA2ATask,
	getA2ATask,
	sendA2ATask,
} from "../task-client.js";
import { CONFORMANCE_DIRECTIVES } from "./scripted-agent.js";
import type {
	ConformanceIntent,
	ConformanceSubject,
	SubjectSendOptions,
} from "./types.js";

export interface HttpConformanceSubjectOptions {
	/** Agent base URL or full `/a2a` endpoint. May change across restarts. */
	endpoint: string | (() => string);
	apiKey?: string;
	/** Report name. Defaults to the endpoint. */
	name?: string;
	/**
	 * Text that drives each intent on this agent. Defaults to the scripted
	 * agent's directives; a live habitat needs its own phrasing, and `null`
	 * for the intents it cannot be made to produce.
	 */
	prompts?: Partial<Record<ConformanceIntent, string | null>>;
	/** Stop and restart the agent. Omit when the harness cannot. */
	restart?: () => Promise<void>;
	pollIntervalMs?: number;
	settleTimeoutMs?: number;
}

export function createHttpConformanceSubject(
	options: HttpConformanceSubjectOptions,
): ConformanceSubject {
	const endpoint = () =>
		typeof options.endpoint === "function"
			? options.endpoint()
			: options.endpoint;

	const prompts: Record<ConformanceIntent, string | null> = {
		...CONFORMANCE_DIRECTIVES,
		...options.prompts,
	};

	return {
		name: options.name ?? endpoint(),
		pollIntervalMs: options.pollIntervalMs,
		settleTimeoutMs: options.settleTimeoutMs,
		promptFor(intent) {
			return prompts[intent] ?? null;
		},
		send(send: SubjectSendOptions): Promise<Task | Message> {
			return sendA2ATask({
				endpoint: endpoint(),
				apiKey: options.apiKey,
				text: send.text,
				blocking: send.blocking ?? false,
				...(send.contextId ? { contextId: send.contextId } : {}),
			});
		},
		getTask(taskId: string): Promise<Task> {
			return getA2ATask({
				endpoint: endpoint(),
				apiKey: options.apiKey,
				taskId,
			});
		},
		cancelTask(taskId: string): Promise<Task> {
			return cancelA2ATask({
				endpoint: endpoint(),
				apiKey: options.apiKey,
				taskId,
			});
		},
		...(options.restart ? { restart: options.restart } : {}),
	};
}
