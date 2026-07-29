/**
 * Assertions for the conformance suite.
 *
 * Every failure carries the *lifecycle claim* that broke — "a non-blocking
 * send returns a Task", "a canceled task is observable to a poller" — not just
 * the request that happened to throw. A suite whose output is
 * `Error: 500 Internal Server Error` tells the next person nothing about which
 * part of the protocol their agent got wrong.
 *
 * SDK 1.x note: the subject's client hands back v1-typed objects, so
 * `TaskState` here is the numeric enum and there is no `kind` discriminator on
 * Tasks or Messages. Failure messages still render the legacy state spellings
 * ("working", "completed") because that is what a human debugging a report
 * reads.
 */

import type { Message, Task, TaskState } from "@a2a-js/sdk";
import { isTerminalTaskState } from "../file-task-store.js";
import { isA2ATask } from "../task-client.js";
import { taskStateToLegacy } from "../v1-compat.js";

/** Thrown by every assertion here. The runner reports `assertion` verbatim. */
export class ConformanceAssertionError extends Error {
	constructor(
		readonly assertion: string,
		message: string,
		readonly observedState?: TaskState,
	) {
		super(`${assertion}: ${message}`);
		this.name = "ConformanceAssertionError";
	}
}

function stateOf(task: Task | undefined): TaskState | undefined {
	return task?.status?.state;
}

/** Human rendering of a v1 state enum (or its absence) for failure messages. */
function showState(state: TaskState | undefined): string {
	return state === undefined ? "no state" : taskStateToLegacy(state);
}

/** Short description of a send result, for failure messages. */
function describeResult(result: Task | Message): string {
	if (isA2ATask(result)) {
		return `Task ${result.id} in state ${showState(stateOf(result))}`;
	}
	if (result && typeof result === "object" && "messageId" in result) {
		return "a Message result";
	}
	return "an unrecognisable result";
}

/** The send returned a Task rather than an immediate Message. */
export function assertIsTask(
	result: Task | Message,
	assertion: string,
): Task {
	// v1 objects carry no `kind` discriminator; `isA2ATask` recognises a Task
	// by shape (an `id` and no `messageId`).
	if (!isA2ATask(result)) {
		throw new ConformanceAssertionError(
			assertion,
			`expected a Task, got ${describeResult(result)}`,
		);
	}
	if (!result.id) {
		throw new ConformanceAssertionError(
			assertion,
			"expected the Task to carry an id",
		);
	}
	return result;
}

export function assertTaskState(
	task: Task,
	expected: TaskState | readonly TaskState[],
	assertion: string,
): Task {
	const wanted = Array.isArray(expected)
		? (expected as readonly TaskState[])
		: [expected as TaskState];
	const observed = stateOf(task);
	if (observed === undefined || !wanted.includes(observed)) {
		throw new ConformanceAssertionError(
			assertion,
			`expected Task ${task.id} in ${wanted.map(taskStateToLegacy).join(" | ")}, observed ${showState(observed)}`,
			observed,
		);
	}
	return task;
}

export function assertNotTerminal(task: Task, assertion: string): Task {
	const observed = stateOf(task);
	if (isTerminalTaskState(observed)) {
		throw new ConformanceAssertionError(
			assertion,
			`expected Task ${task.id} to still be in flight, observed terminal state ${showState(observed)}`,
			observed,
		);
	}
	return task;
}

export function assertTerminal(task: Task, assertion: string): Task {
	const observed = stateOf(task);
	if (!isTerminalTaskState(observed)) {
		throw new ConformanceAssertionError(
			assertion,
			`expected Task ${task.id} to have reached a terminal state, observed ${showState(observed)}`,
			observed,
		);
	}
	return task;
}

export function assertSameTask(
	task: Task,
	expectedId: string,
	assertion: string,
): Task {
	if (task.id !== expectedId) {
		throw new ConformanceAssertionError(
			assertion,
			`expected Task ${expectedId}, got ${task.id}`,
			stateOf(task),
		);
	}
	return task;
}

/** Generic equality with a lifecycle-shaped message. */
export function assertEquals<T>(
	actual: T,
	expected: T,
	what: string,
	assertion: string,
): void {
	if (actual !== expected) {
		throw new ConformanceAssertionError(
			assertion,
			`expected ${what} to be ${String(expected)}, got ${String(actual)}`,
		);
	}
}

export function assertTrue(
	condition: boolean,
	message: string,
	assertion: string,
): void {
	if (!condition) {
		throw new ConformanceAssertionError(assertion, message);
	}
}
