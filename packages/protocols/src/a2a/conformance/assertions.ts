/**
 * Assertions for the conformance suite.
 *
 * Every failure carries the *lifecycle claim* that broke — "a non-blocking
 * send returns a Task", "a canceled task is observable to a poller" — not just
 * the request that happened to throw. A suite whose output is
 * `Error: 500 Internal Server Error` tells the next person nothing about which
 * part of the protocol their agent got wrong.
 */

import type { Message, Task, TaskState } from "@a2a-js/sdk";
import { isTerminalTaskState } from "../file-task-store.js";

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

/** Short description of a send result, for failure messages. */
function describeResult(result: Task | Message): string {
	if ((result as Task)?.kind === "task") {
		const task = result as Task;
		return `Task ${task.id} in state ${stateOf(task) ?? "unknown"}`;
	}
	return `a ${(result as Message)?.kind ?? "unknown"} result`;
}

/** The send returned a Task rather than an immediate Message. */
export function assertIsTask(
	result: Task | Message,
	assertion: string,
): Task {
	if ((result as Task)?.kind !== "task") {
		throw new ConformanceAssertionError(
			assertion,
			`expected a Task, got ${describeResult(result)}`,
		);
	}
	const task = result as Task;
	if (!task.id) {
		throw new ConformanceAssertionError(
			assertion,
			"expected the Task to carry an id",
		);
	}
	return task;
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
	if (!observed || !wanted.includes(observed)) {
		throw new ConformanceAssertionError(
			assertion,
			`expected Task ${task.id} in ${wanted.join(" | ")}, observed ${observed ?? "no state"}`,
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
			`expected Task ${task.id} to still be in flight, observed terminal state ${observed}`,
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
			`expected Task ${task.id} to have reached a terminal state, observed ${observed ?? "no state"}`,
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
