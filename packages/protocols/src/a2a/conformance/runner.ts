/**
 * Runs the conformance cases against a subject and reports what broke.
 *
 * Two rules shape this file:
 *
 * - **A case the subject cannot drive is skipped, with a reason.** An
 *   LLM-backed habitat cannot be told to end `rejected`; a harness with no
 *   restart hook cannot prove durability. Reporting those as passes would make
 *   the suite lie about coverage, which is worse than having none.
 * - **Every failure names a lifecycle assertion.** Requests are wrapped so a
 *   transport error surfaces as the step it broke at, not as a bare HTTP code.
 */

import type { Task, TaskState } from "@a2a-js/sdk";
import { taskStateToLegacy } from "../v1-compat.js";
import { ConformanceAssertionError } from "./assertions.js";
import { CONFORMANCE_CASES } from "./cases.js";
import type {
	AwaitTaskOptions,
	ConformanceCase,
	ConformanceCaseResult,
	ConformanceContext,
	ConformanceIntent,
	ConformanceReport,
	ConformanceSubject,
} from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_SETTLE_TIMEOUT_MS = 15_000;

export interface RunConformanceOptions {
	/** Run only these case ids. */
	only?: readonly string[];
	/** Case list override — the full set by default. */
	cases?: readonly ConformanceCase[];
	/** Progress line per case. */
	onCaseResult?: (result: ConformanceCaseResult) => void;
	/** Injectable sleep, so a test does not wait in real time. */
	sleep?: (ms: number) => Promise<void>;
	/** Injectable clock, so a test does not depend on wall time. */
	now?: () => number;
}

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** v1 states are numeric enum members; report the legacy spelling humans read. */
function showState(state: TaskState | undefined): string {
	return state === undefined ? "no state" : taskStateToLegacy(state);
}

/**
 * Why this subject cannot run this case, or null when it can.
 * Phrased for a human reading a report, not for a log grep.
 */
function skipReasonFor(
	subject: ConformanceSubject,
	testCase: ConformanceCase,
): string | null {
	if (testCase.requires?.restart && !subject.restart) {
		return "the harness cannot restart the agent under test";
	}
	const missing = (testCase.requires?.intents ?? []).filter(
		(intent) => subject.promptFor(intent) === null,
	);
	if (missing.length > 0) {
		return `the subject cannot drive: ${missing.join(", ")}`;
	}
	return null;
}

function makeContext(
	subject: ConformanceSubject,
	options: RunConformanceOptions,
): ConformanceContext {
	const sleep = options.sleep ?? defaultSleep;
	const now = options.now ?? (() => Date.now());
	const intervalMs = subject.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const defaultTimeoutMs = subject.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

	const step = async <T>(
		assertion: string,
		fn: () => Promise<T>,
	): Promise<T> => {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof ConformanceAssertionError) throw err;
			throw new ConformanceAssertionError(
				assertion,
				`request failed: ${errorMessage(err)}`,
			);
		}
	};

	const awaitTask = async (opts: AwaitTaskOptions): Promise<Task> => {
		const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
		const startedAt = now();
		let last: Task | undefined;

		for (;;) {
			last = await step(opts.assertion, () => subject.getTask(opts.taskId));
			if (opts.until(last)) return last;

			if (now() - startedAt >= timeoutMs) {
				throw new ConformanceAssertionError(
					opts.assertion,
					`Task ${opts.taskId} did not ${opts.describe} within ${timeoutMs}ms (last observed: ${showState(last?.status?.state)})`,
					last?.status?.state,
				);
			}
			await sleep(intervalMs);
		}
	};

	return {
		subject,
		prompt(intent: ConformanceIntent): string {
			const text = subject.promptFor(intent);
			if (text === null) {
				// The runner skips cases whose intents are unavailable, so reaching
				// here means a case used an intent it did not declare.
				throw new ConformanceAssertionError(
					"suite.case-declares-its-intents",
					`case used the "${intent}" intent without declaring it in requires.intents`,
				);
			}
			return text;
		},
		step,
		awaitTask,
		async restart(assertion: string): Promise<void> {
			if (!subject.restart) {
				throw new ConformanceAssertionError(
					assertion,
					"case needs a restart hook the subject does not provide",
				);
			}
			await step(assertion, () => subject.restart!());
		},
	};
}

export async function runA2AConformance(
	subject: ConformanceSubject,
	options: RunConformanceOptions = {},
): Promise<ConformanceReport> {
	const now = options.now ?? (() => Date.now());
	const cases = (options.cases ?? CONFORMANCE_CASES).filter(
		(c) => !options.only || options.only.includes(c.id),
	);
	const ctx = makeContext(subject, options);
	const results: ConformanceCaseResult[] = [];

	for (const testCase of cases) {
		const startedAt = now();
		const base = {
			id: testCase.id,
			title: testCase.title,
			criterion: testCase.criterion,
		};

		const skipReason = skipReasonFor(subject, testCase);
		if (skipReason) {
			const result: ConformanceCaseResult = {
				...base,
				status: "skipped",
				skipReason,
				durationMs: 0,
			};
			results.push(result);
			options.onCaseResult?.(result);
			continue;
		}

		let result: ConformanceCaseResult;
		try {
			await testCase.run(ctx);
			result = {
				...base,
				status: "passed",
				durationMs: now() - startedAt,
			};
		} catch (err) {
			const assertionError =
				err instanceof ConformanceAssertionError ? err : undefined;
			result = {
				...base,
				status: "failed",
				// An error that is not an assertion escaped every labelled step —
				// name the case itself rather than pretending to know the step.
				assertion: assertionError?.assertion ?? `${testCase.id}.unlabelled`,
				message: assertionError
					? assertionError.message
					: `unexpected error: ${errorMessage(err)}`,
				...(assertionError?.observedState
					? { observedState: assertionError.observedState }
					: {}),
				durationMs: now() - startedAt,
			};
		}

		results.push(result);
		options.onCaseResult?.(result);
	}

	const failed = results.filter((r) => r.status === "failed").length;
	return {
		subject: subject.name,
		startedAt: new Date(now()).toISOString(),
		results,
		passed: results.filter((r) => r.status === "passed").length,
		failed,
		skipped: results.filter((r) => r.status === "skipped").length,
		ok: failed === 0,
	};
}

/** Human-readable report — one line per case, failures spelled out. */
export function formatConformanceReport(report: ConformanceReport): string {
	const mark = { passed: "PASS", failed: "FAIL", skipped: "SKIP" } as const;
	const lines = [`A2A conformance — ${report.subject}`, ""];

	for (const result of report.results) {
		lines.push(`${mark[result.status]}  ${result.id} — ${result.title}`);
		if (result.status === "failed") {
			lines.push(`      assertion: ${result.assertion}`);
			lines.push(`      ${result.message}`);
			lines.push(`      criterion: ${result.criterion}`);
		}
		if (result.status === "skipped") {
			lines.push(`      skipped: ${result.skipReason}`);
		}
	}

	lines.push(
		"",
		`${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`,
	);
	return lines.join("\n");
}
