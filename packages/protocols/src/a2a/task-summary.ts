/**
 * A count of an agent's Tasks by lifecycle category.
 *
 * The pinned SDK (0.3.14) has no `tasks/list`, so nothing outside a process
 * can ask an agent what it is holding. That is fine for callers — they know
 * their own task ids — and not fine for an orchestrator deciding whether a
 * Habitat is safe to stop (#278). This turns the durable store's `listAll()`
 * into a small summary an agent can publish over its own surface.
 *
 * The categories are the ones the sweep already distinguishes, reusing the
 * same predicates so the reaper and the recovery sweep cannot drift apart on
 * what "still working" means:
 *
 * - **active** — mid-flight. Stopping the agent abandons this work.
 * - **interrupted** — waiting on a human (`input-required`, `auth-required`).
 *   Stopping is safe: the Task is durable and resumes on the next wake.
 * - **terminal** — finished, in any of the four terminal states.
 */

import type { Task, TaskState } from "@a2a-js/sdk";
import {
	isInterruptedTaskState,
	isTerminalTaskState,
} from "./file-task-store.js";

export interface TaskStateSummary {
	/** Every Task the store holds. */
	total: number;
	/** Mid-flight Tasks — the ones that make stopping destructive. */
	active: number;
	/** Tasks legitimately waiting on someone; safe to stop. */
	interrupted: number;
	/** Tasks that will never move again. */
	terminal: number;
	/** Ids of the active Tasks, so a refusal can say what it is protecting. */
	activeTaskIds: string[];
	/** Raw per-state counts, for diagnostics that outlive these categories. */
	byState: Record<string, number>;
}

/** Ids listed on a summary, capped so one runaway agent cannot flood a log. */
export const MAX_LISTED_TASK_IDS = 50;

/** Categorise a set of Tasks. Pure — the caller supplies them. */
export function summarizeTasks(tasks: Task[]): TaskStateSummary {
	const byState: Record<string, number> = {};
	const activeTaskIds: string[] = [];
	let active = 0;
	let interrupted = 0;
	let terminal = 0;

	for (const task of tasks) {
		const state: TaskState | undefined = task.status?.state;
		const key = state ?? "unknown";
		byState[key] = (byState[key] ?? 0) + 1;

		if (isTerminalTaskState(state)) {
			terminal++;
		} else if (isInterruptedTaskState(state)) {
			interrupted++;
		} else {
			active++;
			if (activeTaskIds.length < MAX_LISTED_TASK_IDS) activeTaskIds.push(task.id);
		}
	}

	return {
		total: tasks.length,
		active,
		interrupted,
		terminal,
		activeTaskIds,
		byState,
	};
}
