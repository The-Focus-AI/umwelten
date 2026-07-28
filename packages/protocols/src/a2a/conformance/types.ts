/**
 * Types for the A2A conformance suite.
 *
 * ADR 0007 rejects a shared client package between this repo and the control
 * plane — this client carries service-bearer auth and loopback addressing,
 * that one carries per-user grant minting and database-backed attachment
 * resolution, and neither belongs in the other. What replaces a shared
 * library is a shared *test*: one fixture set, two clients.
 *
 * So the subject of the suite is the **client**, not the server. A
 * {@link ConformanceSubject} is everything the suite needs in order to drive a
 * Task lifecycle: send, get, cancel, and — when the harness can provide one —
 * a restart of the agent under test. The control plane implements the same
 * interface over its own client and runs the same cases.
 */

import type { Message, Task, TaskState } from "@a2a-js/sdk";

/**
 * A lifecycle outcome the suite needs an agent to produce on demand.
 *
 * A scripted agent can produce all of them. A live habitat backed by a model
 * can be asked to answer quickly, and can be cancelled mid-answer, but cannot
 * be told to end `rejected` — so a subject declares what it can drive and the
 * rest is reported as skipped rather than passed.
 */
export type ConformanceIntent =
	| "quick"
	| "slow"
	| "fail"
	| "reject"
	| "input-required";

export const CONFORMANCE_INTENTS: readonly ConformanceIntent[] = [
	"quick",
	"slow",
	"fail",
	"reject",
	"input-required",
];

export interface SubjectSendOptions {
	text: string;
	/** Defaults to false — the suite is about the non-blocking task surface. */
	blocking?: boolean;
	contextId?: string;
}

/**
 * The client under test, plus whatever control over the agent the harness has.
 *
 * Everything here is deliberately small: a second implementation of this
 * interface is the price of admission for running the suite, and a wide
 * interface would make that price a reason not to.
 */
export interface ConformanceSubject {
	/** Shown in the report, so two runs are distinguishable. */
	readonly name: string;
	/**
	 * Text that drives `intent` on this agent, or `null` when this subject
	 * cannot drive it. Returning `null` skips the cases that need it — which is
	 * the honest answer for an LLM-backed habitat asked to fail on command.
	 */
	promptFor(intent: ConformanceIntent): string | null;
	send(options: SubjectSendOptions): Promise<Task | Message>;
	getTask(taskId: string): Promise<Task>;
	cancelTask(taskId: string): Promise<Task>;
	/**
	 * Stop the agent abruptly and bring it back — no drain, no terminal events
	 * for whatever was mid-flight. That is what a stopped container does, and
	 * it is what makes the durability and sweep cases meaningful. Omit when the
	 * harness cannot restart the agent; those cases are then skipped.
	 */
	restart?(): Promise<void>;
	/** Gap between polls while waiting for a task to move. Default 100ms. */
	readonly pollIntervalMs?: number;
	/** How long to wait for a task to reach an expected state. Default 15s. */
	readonly settleTimeoutMs?: number;
}

export interface ConformanceRequirements {
	/** Intents the case needs the subject to be able to drive. */
	intents?: readonly ConformanceIntent[];
	/** Whether the case needs `subject.restart`. */
	restart?: boolean;
}

/** Helpers a case uses; every one of them labels its failures. */
export interface ConformanceContext {
	readonly subject: ConformanceSubject;
	/**
	 * Prompt text for an intent the case declared in `requires` — the runner
	 * has already skipped the case if the subject cannot drive it, so this
	 * never returns null.
	 */
	prompt(intent: ConformanceIntent): string;
	/**
	 * Run one request under an assertion label, so a transport failure is
	 * reported as *which* lifecycle step failed rather than "request failed".
	 */
	step<T>(assertion: string, fn: () => Promise<T>): Promise<T>;
	/** Poll `getTask` until `until` holds, or fail the named assertion. */
	awaitTask(options: AwaitTaskOptions): Promise<Task>;
	/** Restart the agent under the named assertion. */
	restart(assertion: string): Promise<void>;
}

export interface AwaitTaskOptions {
	taskId: string;
	/** The condition being waited for. */
	until(task: Task): boolean;
	/** Assertion label reported when the wait times out. */
	assertion: string;
	/** Human phrasing of the condition, e.g. "reach a terminal state". */
	describe: string;
	timeoutMs?: number;
}

export interface ConformanceCase {
	/** Stable id — this is what a failure report names. */
	id: string;
	title: string;
	/** The acceptance criterion from #274 this case exists to cover. */
	criterion: string;
	requires?: ConformanceRequirements;
	run(ctx: ConformanceContext): Promise<void>;
}

export type ConformanceCaseStatus = "passed" | "failed" | "skipped";

export interface ConformanceCaseResult {
	id: string;
	title: string;
	criterion: string;
	status: ConformanceCaseStatus;
	/** Which lifecycle assertion broke. Set iff `status === "failed"`. */
	assertion?: string;
	/** What was expected and what was seen. */
	message?: string;
	/** Task state observed at the point of failure, when there was one. */
	observedState?: TaskState;
	/** Why the case did not run. Set iff `status === "skipped"`. */
	skipReason?: string;
	durationMs: number;
}

export interface ConformanceReport {
	subject: string;
	startedAt: string;
	results: ConformanceCaseResult[];
	passed: number;
	failed: number;
	skipped: number;
	/** True when nothing failed. Skips do not fail a run — they are reported. */
	ok: boolean;
}
