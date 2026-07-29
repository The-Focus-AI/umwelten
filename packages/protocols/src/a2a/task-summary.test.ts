import { describe, expect, it } from "vitest";
import type { Task } from "@a2a-js/sdk";
import {
	INTERRUPTED_TASK_STATES,
	TERMINAL_TASK_STATES,
} from "./file-task-store.js";
import { MAX_LISTED_TASK_IDS, summarizeTasks } from "./task-summary.js";
import { taskStateFromLegacy, type LegacyTaskState } from "./v1-compat.js";

import type { TaskState } from "@a2a-js/sdk";

function task(id: string, state: TaskState): Task {
	return {
		id,
		contextId: `ctx-${id}`,
		status: {
			state,
			message: undefined,
			timestamp: "2026-07-26T00:00:00.000Z",
		},
		artifacts: [],
		history: [],
		metadata: undefined,
	};
}

function legacyTask(id: string, state: LegacyTaskState): Task {
	return task(id, taskStateFromLegacy(state));
}

describe("summarizeTasks", () => {
	it("counts nothing for an empty store", () => {
		const summary = summarizeTasks([]);
		expect(summary).toEqual({
			total: 0,
			active: 0,
			interrupted: 0,
			terminal: 0,
			activeTaskIds: [],
			byState: {},
		});
	});

	it("counts every terminal state as terminal", () => {
		const summary = summarizeTasks(
			TERMINAL_TASK_STATES.map((s, i) => task(`t${i}`, s)),
		);
		expect(summary.terminal).toBe(TERMINAL_TASK_STATES.length);
		expect(summary.active).toBe(0);
		expect(summary.interrupted).toBe(0);
	});

	it("counts every interrupted state as interrupted, not active", () => {
		// The distinction the reaper depends on: these are waiting on a human,
		// not mid-flight, so they do not block a stop.
		const summary = summarizeTasks(
			INTERRUPTED_TASK_STATES.map((s, i) => task(`i${i}`, s)),
		);
		expect(summary.interrupted).toBe(INTERRUPTED_TASK_STATES.length);
		expect(summary.active).toBe(0);
		expect(summary.activeTaskIds).toEqual([]);
	});

	it("counts mid-flight states as active and names them", () => {
		const summary = summarizeTasks([
			legacyTask("a", "working"),
			legacyTask("b", "submitted"),
			legacyTask("c", "completed"),
		]);
		expect(summary.active).toBe(2);
		expect(summary.activeTaskIds).toEqual(["a", "b"]);
		expect(summary.terminal).toBe(1);
		expect(summary.total).toBe(3);
	});

	it("reports raw per-state counts alongside the categories", () => {
		// `byState` keys keep the legacy spellings — published summaries must
		// read the same before and after the v1 SDK migration.
		const summary = summarizeTasks([
			legacyTask("a", "working"),
			legacyTask("b", "working"),
			legacyTask("c", "input-required"),
		]);
		expect(summary.byState).toEqual({ working: 2, "input-required": 1 });
	});

	it("treats a Task with no status as active rather than assuming it finished", () => {
		// A record we cannot classify must not be read as "safe to stop".
		const broken = {
			id: "x",
			contextId: "ctx",
			status: undefined,
			artifacts: [],
			history: [],
			metadata: undefined,
		} as Task;
		const summary = summarizeTasks([broken]);
		expect(summary.active).toBe(1);
		expect(summary.byState).toEqual({ unknown: 1 });
	});

	it("caps the listed ids but not the count", () => {
		const many = Array.from({ length: MAX_LISTED_TASK_IDS + 10 }, (_, i) =>
			legacyTask(`t${i}`, "working"),
		);
		const summary = summarizeTasks(many);
		expect(summary.active).toBe(MAX_LISTED_TASK_IDS + 10);
		expect(summary.activeTaskIds).toHaveLength(MAX_LISTED_TASK_IDS);
	});
});
