import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskState, type Task, type TaskStatus } from "@a2a-js/sdk";
import { InMemoryTaskStore, type TaskStore } from "@a2a-js/sdk/server";
import {
	FileTaskStore,
	INTERRUPTED_TASK_STATES,
	TERMINAL_TASK_STATES,
	isAbandonableTaskState,
	isInterruptedTaskState,
	isTerminalTaskState,
} from "./file-task-store.js";
import { buildServerCallContext } from "./server.js";
import {
	agentMessage,
	taskStateFromLegacy,
	textPart,
	userMessage,
	type LegacyTaskState,
} from "./v1-compat.js";

// The v1 SDK's InMemoryTaskStore scopes its buckets by call context, so the
// contract runs with one; FileTaskStore is single-tenant and ignores it.
const ctx = buildServerCallContext();

function status(state: LegacyTaskState): TaskStatus {
	return {
		state: taskStateFromLegacy(state),
		message: undefined,
		timestamp: "2026-07-25T00:00:00.000Z",
	};
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		contextId: "ctx-1",
		status: status("working"),
		artifacts: [],
		history: [],
		metadata: undefined,
		...overrides,
	};
}

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "umwelten-task-store-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

/**
 * The substitution is only safe if the durable store behaves like the one it
 * replaces, so the same contract runs against both. A divergence here means
 * swapping the store changes behaviour, which is exactly what must not happen.
 */
describe.each([
	["InMemoryTaskStore", () => new InMemoryTaskStore() as TaskStore],
	["FileTaskStore", () => new FileTaskStore({ dir }) as TaskStore],
])("TaskStore contract — %s", (_name, create) => {
	it("returns undefined for a task that was never saved", async () => {
		await expect(create().load("nope", ctx)).resolves.toBeUndefined();
	});

	it("round-trips a saved task", async () => {
		const store = create();
		const task = makeTask();
		await store.save(task, ctx);
		expect(await store.load(task.id, ctx)).toEqual(task);
	});

	it("overwrites an existing task with the same id", async () => {
		const store = create();
		await store.save(makeTask(), ctx);
		await store.save(makeTask({ status: status("completed") }), ctx);
		expect((await store.load("task-1", ctx))?.status?.state).toBe(
			TaskState.TASK_STATE_COMPLETED,
		);
	});

	it("keeps tasks with different ids independent", async () => {
		const store = create();
		await store.save(makeTask({ id: "a" }), ctx);
		await store.save(makeTask({ id: "b", status: status("failed") }), ctx);
		expect((await store.load("a", ctx))?.status?.state).toBe(
			TaskState.TASK_STATE_WORKING,
		);
		expect((await store.load("b", ctx))?.status?.state).toBe(
			TaskState.TASK_STATE_FAILED,
		);
	});

	it("preserves artifacts and history", async () => {
		const store = create();
		const task = makeTask({
			artifacts: [
				{
					artifactId: "a1",
					name: "",
					description: "",
					parts: [textPart("hi")],
					metadata: undefined,
					extensions: [],
				},
			],
			history: [userMessage({ text: "question", messageId: "m1" })],
		});
		await store.save(task, ctx);
		expect(await store.load(task.id, ctx)).toEqual(task);
	});
});

describe("FileTaskStore durability", () => {
	/**
	 * A deliberate divergence from the 0.3 SDK's `InMemoryTaskStore`,
	 * which kept the caller's object by reference — mutate it afterwards and
	 * the store changed under you. A persisted store cannot reproduce that
	 * aliasing, and should not: every mutation in the SDK is followed by an
	 * explicit `save()`, so nothing depends on it, and the v1 SDK deep-clones
	 * on the way in for exactly this reason. Isolation is the safer
	 * behaviour, so the durable store is stricter here rather than
	 * bug-compatible.
	 */
	it("does not let a caller mutate stored state through the object it saved", async () => {
		const store = new FileTaskStore({ dir });
		const task = makeTask();
		await store.save(task);
		task.status!.state = TaskState.TASK_STATE_CANCELED;
		expect((await store.load("task-1"))?.status?.state).toBe(
			TaskState.TASK_STATE_WORKING,
		);
	});

	it("returns a task saved by a previous store instance", async () => {
		await new FileTaskStore({ dir }).save(makeTask());

		// A new instance stands in for a new container generation: same volume,
		// no shared memory.
		const restarted = new FileTaskStore({ dir });
		expect((await restarted.load("task-1"))?.status?.state).toBe(
			TaskState.TASK_STATE_WORKING,
		);
	});

	it("survives a restart with artifacts and status history intact", async () => {
		const task = makeTask({
			status: {
				state: taskStateFromLegacy("input-required"),
				timestamp: "2026-07-25T01:00:00.000Z",
				message: agentMessage({ text: "which repo?", messageId: "m9" }),
			},
			artifacts: [
				{
					artifactId: "a1",
					name: "",
					description: "",
					parts: [textPart("report")],
					metadata: undefined,
					extensions: [],
				},
			],
		});
		await new FileTaskStore({ dir }).save(task);

		expect(await new FileTaskStore({ dir }).load(task.id)).toEqual(task);
	});

	it("writes one file per task and reuses it on overwrite", async () => {
		const store = new FileTaskStore({ dir });
		await store.save(makeTask());
		await store.save(makeTask({ status: status("completed") }));
		const files = (await readdir(dir)).filter((f) => f.endsWith(".task.json"));
		expect(files).toHaveLength(1);
	});

	it("leaves no temp files behind after writing", async () => {
		const store = new FileTaskStore({ dir });
		await store.save(makeTask());
		expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	});

	it("handles task ids that are not safe filenames", async () => {
		const store = new FileTaskStore({ dir });
		const nasty = "../../etc/passwd";
		await store.save(makeTask({ id: nasty }));

		expect((await new FileTaskStore({ dir }).load(nasty))?.id).toBe(nasty);
		// The traversal must not have escaped the directory.
		expect((await readdir(dir)).filter((f) => f.endsWith(".task.json"))).toHaveLength(1);
	});

	it("serialises concurrent saves of the same task without corrupting it", async () => {
		const store = new FileTaskStore({ dir });
		const states: LegacyTaskState[] = ["submitted", "working", "completed"];
		await Promise.all(
			states.map((state) => store.save(makeTask({ status: status(state) }))),
		);

		const persisted = await new FileTaskStore({ dir }).load("task-1");
		// Whichever write landed last, the record must be a whole valid Task.
		expect(persisted).toBeDefined();
		expect(states.map(taskStateFromLegacy)).toContain(persisted?.status?.state);
	});

	it("creates its directory on demand", async () => {
		const nested = join(dir, "deep", "tasks");
		await new FileTaskStore({ dir: nested }).save(makeTask());
		expect((await readdir(nested)).length).toBeGreaterThan(0);
	});

	it("reads a record written by the 0.3-era store", async () => {
		// v1 envelope: legacy-shaped Task JSON (string states, `kind`
		// discriminators), exactly as the previous SDK generation wrote it.
		const legacyRecord = {
			version: 1,
			id: "task-legacy",
			task: {
				kind: "task",
				id: "task-legacy",
				contextId: "ctx-legacy",
				status: {
					state: "input-required",
					timestamp: "2026-07-25T01:00:00.000Z",
					message: {
						kind: "message",
						role: "agent",
						messageId: "m9",
						parts: [{ kind: "text", text: "which repo?" }],
					},
				},
				artifacts: [
					{ artifactId: "a1", parts: [{ kind: "text", text: "report" }] },
				],
			},
		};
		const { createHash } = await import("node:crypto");
		const hashed = `${createHash("sha256").update("task-legacy").digest("hex")}.task.json`;
		await writeFile(join(dir, hashed), JSON.stringify(legacyRecord), "utf-8");

		const loaded = await new FileTaskStore({ dir }).load("task-legacy");
		expect(loaded?.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
		expect(loaded?.status?.message?.parts?.[0]).toMatchObject({
			content: { $case: "text", value: "which repo?" },
		});
	});

	describe("listAll", () => {
		it("is empty for a directory that does not exist yet", async () => {
			expect(await new FileTaskStore({ dir: join(dir, "absent") }).listAll()).toEqual([]);
		});

		it("returns every persisted task", async () => {
			const store = new FileTaskStore({ dir });
			await store.save(makeTask({ id: "a" }));
			await store.save(makeTask({ id: "b" }));
			const ids = (await new FileTaskStore({ dir }).listAll()).map((t) => t.id).sort();
			expect(ids).toEqual(["a", "b"]);
		});

		it("skips unreadable files rather than failing the whole sweep", async () => {
			const store = new FileTaskStore({ dir });
			await store.save(makeTask({ id: "good" }));
			await writeFile(join(dir, "broken.task.json"), "{ not json", "utf-8");

			const tasks = await new FileTaskStore({ dir }).listAll();
			expect(tasks.map((t) => t.id)).toEqual(["good"]);
		});

		it("ignores files that are not task records", async () => {
			await new FileTaskStore({ dir }).save(makeTask());
			await writeFile(join(dir, "notes.txt"), "unrelated", "utf-8");
			expect(await new FileTaskStore({ dir }).listAll()).toHaveLength(1);
		});
	});
});

describe("task state classification", () => {
	it.each(TERMINAL_TASK_STATES)("treats state %s as terminal", (state) => {
		expect(isTerminalTaskState(state)).toBe(true);
		expect(isAbandonableTaskState(state)).toBe(false);
	});

	it.each(INTERRUPTED_TASK_STATES)(
		"treats state %s as interrupted, not abandonable",
		(state) => {
			expect(isInterruptedTaskState(state)).toBe(true);
			expect(isAbandonableTaskState(state)).toBe(false);
		},
	);

	it.each(["submitted", "working", "unknown"] as LegacyTaskState[])(
		"treats %s as abandonable",
		(state) => {
			expect(isAbandonableTaskState(taskStateFromLegacy(state))).toBe(true);
		},
	);

	it("treats a missing state as abandonable", () => {
		expect(isAbandonableTaskState(undefined)).toBe(true);
	});
});
