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
import { TaskState, type Task } from "@a2a-js/sdk";
import type { PushNotificationSender } from "@a2a-js/sdk/server";
import {
	type FileTaskStore,
	isAbandonableTaskState,
	isInterruptedTaskState,
} from "./file-task-store.js";
import { buildServerCallContext } from "./server.js";
import { agentMessage } from "./v1-compat.js";

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
		state: TaskState.TASK_STATE_FAILED,
		timestamp,
		message: agentMessage({
			text: reason,
			messageId,
			taskId: task.id,
			contextId: task.contextId,
			metadata: { [ABANDONED_TASK_MARKER]: true },
		}),
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
			if (isInterruptedTaskState(state)) {
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

/**
 * Deliver the sweep's transitions to whoever registered for them.
 *
 * The sweep moves a Task by writing to the store, which is the one path the
 * request handler never sees — so its push notifications never fire on their
 * own. That is exactly backwards: a caller who registered a webhook and went
 * away is the caller who most needs to hear that the run died with the
 * container, and polling is what push exists to avoid.
 *
 * A webhook that is down, slow, or gone must not change anything about the
 * Task. Failures are reported and dropped.
 */
export async function notifySweptTasks(
	store: Pick<FileTaskStore, "load">,
	sender: PushNotificationSender,
	swept: readonly string[],
	options: { onError?: (taskId: string, error: unknown) => void } = {},
): Promise<string[]> {
	const notified: string[] = [];

	for (const taskId of swept) {
		try {
			const task = await store.load(taskId);
			if (!task) continue;
			// The v1 sender takes a StreamResponse. A `task` payload carries the
			// whole swept Task — the same body the 0.3 sender used to POST, so
			// 0.3-registered webhooks see an unchanged notification shape.
			await sender.send(
				{ payload: { $case: "task", value: task } },
				buildServerCallContext(),
			);
			notified.push(taskId);
		} catch (error) {
			options.onError?.(taskId, error);
		}
	}

	return notified;
}
