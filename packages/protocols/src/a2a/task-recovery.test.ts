import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskState, type Task } from "@a2a-js/sdk";
import { FileTaskStore } from "./file-task-store.js";
import {
	ABANDONED_TASK_MARKER,
	DEFAULT_ABANDONED_REASON,
	sweepAbandonedTasks,
} from "./task-recovery.js";
import {
	partText,
	taskStateFromLegacy,
	textPart,
	type LegacyTaskState,
} from "./v1-compat.js";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "umwelten-task-recovery-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function makeTask(id: string, state: LegacyTaskState): Task {
	return {
		id,
		contextId: `ctx-${id}`,
		status: {
			state: taskStateFromLegacy(state),
			message: undefined,
			timestamp: "2026-07-25T00:00:00.000Z",
		},
		artifacts: [],
		history: [],
		metadata: undefined,
	};
}

/** Seeds a store as a previous container generation would have left it. */
async function seed(...tasks: Task[]): Promise<FileTaskStore> {
	const store = new FileTaskStore({ dir });
	for (const task of tasks) await store.save(task);
	return new FileTaskStore({ dir });
}

const fixedClock = () => "2026-07-25T12:00:00.000Z";
const fixedIds = () => "msg-fixed";

describe("sweepAbandonedTasks", () => {
	it("fails a task left mid-flight by a stopped container", async () => {
		const store = await seed(makeTask("a", "working"));

		const result = await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		expect(result.swept).toEqual(["a"]);
		expect((await store.load("a"))?.status?.state).toBe(TaskState.TASK_STATE_FAILED);
	});

	it("fails a task that never got past submitted", async () => {
		const store = await seed(makeTask("a", "submitted"));
		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });
		expect((await store.load("a"))?.status?.state).toBe(TaskState.TASK_STATE_FAILED);
	});

	it("records a reason that says the habitat stopped, not a generic error", async () => {
		const store = await seed(makeTask("a", "working"));
		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		const status = (await store.load("a"))?.status;
		const part = status?.message?.parts?.[0];
		expect(part).toBeDefined();
		expect(partText(part!)).toBe(DEFAULT_ABANDONED_REASON);
		expect(status?.message?.metadata).toMatchObject({ [ABANDONED_TASK_MARKER]: true });
	});

	it("marks the failure with the sweep's timestamp", async () => {
		const store = await seed(makeTask("a", "working"));
		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });
		expect((await store.load("a"))?.status?.timestamp).toBe("2026-07-25T12:00:00.000Z");
	});

	it("accepts a caller-supplied reason", async () => {
		const store = await seed(makeTask("a", "working"));
		await sweepAbandonedTasks(store, {
			now: fixedClock,
			messageId: fixedIds,
			reason: "reaped for idleness",
		});
		const part = (await store.load("a"))?.status?.message?.parts?.[0];
		expect(part && partText(part)).toBe("reaped for idleness");
	});

	it.each(["completed", "failed", "canceled", "rejected"] as LegacyTaskState[])(
		"leaves an already-terminal %s task untouched",
		async (state) => {
			const store = await seed(makeTask("a", state));
			const result = await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

			expect(result.swept).toEqual([]);
			expect(result.terminal).toEqual(["a"]);
			expect((await store.load("a"))?.status?.state).toBe(taskStateFromLegacy(state));
			// An already-failed task must keep its original reason, not be
			// relabelled as abandoned.
			expect((await store.load("a"))?.status?.message).toBeUndefined();
		},
	);

	it.each(["input-required", "auth-required"] as LegacyTaskState[])(
		"never sweeps a %s task, which is legitimately waiting",
		async (state) => {
			const store = await seed(makeTask("a", state));
			const result = await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

			expect(result.swept).toEqual([]);
			expect(result.interrupted).toEqual(["a"]);
			expect((await store.load("a"))?.status?.state).toBe(taskStateFromLegacy(state));
		},
	);

	it("sorts a mixed fleet of tasks into swept, terminal and interrupted", async () => {
		const store = await seed(
			makeTask("mid", "working"),
			makeTask("done", "completed"),
			makeTask("waiting", "auth-required"),
			makeTask("new", "submitted"),
		);

		const result = await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		expect(result.swept.sort()).toEqual(["mid", "new"]);
		expect(result.terminal).toEqual(["done"]);
		expect(result.interrupted).toEqual(["waiting"]);
	});

	it("persists the transition so a later container generation sees it", async () => {
		const store = await seed(makeTask("a", "working"));
		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		expect((await new FileTaskStore({ dir }).load("a"))?.status?.state).toBe(
			TaskState.TASK_STATE_FAILED,
		);
	});

	it("is idempotent — a second sweep finds nothing left to do", async () => {
		const store = await seed(makeTask("a", "working"));
		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		const second = await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });
		expect(second.swept).toEqual([]);
		expect(second.terminal).toEqual(["a"]);
	});

	it("preserves the task's identity and artifacts while failing it", async () => {
		const task: Task = {
			...makeTask("a", "working"),
			artifacts: [
				{
					artifactId: "a1",
					name: "",
					description: "",
					parts: [textPart("partial")],
					metadata: undefined,
					extensions: [],
				},
			],
		};
		const store = await seed(task);

		await sweepAbandonedTasks(store, { now: fixedClock, messageId: fixedIds });

		const swept = await store.load("a");
		expect(swept?.contextId).toBe("ctx-a");
		// Work produced before the container died is still the record of what
		// happened, so it survives the transition.
		expect(swept?.artifacts).toEqual(task.artifacts);
	});

	it("does nothing on an empty store", async () => {
		const result = await sweepAbandonedTasks(new FileTaskStore({ dir }));
		expect(result).toEqual({ swept: [], terminal: [], interrupted: [] });
	});
});
