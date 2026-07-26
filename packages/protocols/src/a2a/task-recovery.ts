/**
 * Boot-time recovery for Tasks abandoned by a stopped container.
 *
 * Once habitats stop while idle, a Task can be interrupted mid-flight with no
 * terminal event ever emitted. Nothing is working on it any more, but its
 * record still says `working` — so a caller polling it waits forever, and a
 * caller checking later finds a Task that looks alive and is not.
 *
 * On start, transition those to `failed` with a reason that says what actually
 * happened. This is only possible because the Task state lives where the
 * habitat can read it (ADR 0007).
 *
 * Tasks in an interrupted state — waiting for a follow-up message, or for a
 * credential someone has to authorize — are deliberately NOT swept. They are
 * legitimately waiting, and killing them would destroy resumable work.
 */

import { randomUUID } from "node:crypto";
import type { Task } from "@a2a-js/sdk";
import { type FileTaskStore, isAbandonableTaskState } from "./file-task-store.js";

/** Marker on the failing status message, so an abandoned Task is identifiable. */
export const ABANDONED_TASK_MARKER = "umwelten.task.abandoned";

export const DEFAULT_ABANDONED_REASON =
	"Abandoned: the habitat stopped while this task was still running.";

export interface SweepOptions {
	/** Injectable clock, so tests do not depend on wall time. */
	now?: () => string;
	/** Injectable id source, so tests do not depend on randomness. */
	messageId?: () => string;
	/** Override the human-facing reason recorded on the failed Task. */
	reason?: string;
}

export interface SweepResult {
	/** Ids of Tasks transitioned to `failed`. */
	swept: string[];
	/** Ids left alone because they were already terminal. */
	terminal: string[];
	/** Ids left alone because they are legitimately waiting. */
	interrupted: string[];
}

/** Builds the `failed` status recorded on an abandoned Task. */
function abandonedStatus(
	task: Task,
	reason: string,
	timestamp: string,
	messageId: string,
): Task["status"] {
	return {
		state: "failed",
		timestamp,
		message: {
			kind: "message",
			role: "agent",
			messageId,
			taskId: task.id,
			contextId: task.contextId,
			parts: [{ kind: "text", text: reason }],
			metadata: { [ABANDONED_TASK_MARKER]: true },
		},
	};
}

/**
 * Transition every mid-flight Task to `failed`. Call before the habitat
 * accepts new requests, so no caller can observe a Task this is about to move.
 */
export async function sweepAbandonedTasks(
	store: FileTaskStore,
	options: SweepOptions = {},
): Promise<SweepResult> {
	const now = options.now ?? (() => new Date().toISOString());
	const nextMessageId = options.messageId ?? (() => randomUUID());
	const reason = options.reason ?? DEFAULT_ABANDONED_REASON;

	const result: SweepResult = { swept: [], terminal: [], interrupted: [] };

	for (const task of await store.listAll()) {
		const state = task.status?.state;

		if (!isAbandonableTaskState(state)) {
			// Sorting the untouched ones lets a caller log *why* each was skipped;
			// "interrupted" and "already finished" are very different situations.
			if (state === "input-required" || state === "auth-required") {
				result.interrupted.push(task.id);
			} else {
				result.terminal.push(task.id);
			}
			continue;
		}

		await store.save({
			...task,
			status: abandonedStatus(task, reason, now(), nextMessageId()),
		});
		result.swept.push(task.id);
	}

	return result;
}
