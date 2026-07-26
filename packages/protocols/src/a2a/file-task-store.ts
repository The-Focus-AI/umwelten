/**
 * Durable A2A {@link TaskStore} backed by the filesystem.
 *
 * The SDK ships `InMemoryTaskStore`, which loses every Task when its process
 * exits. That is fine for a server that only stops when someone stops it, and
 * fatal once an idle reaper is the thing doing the stopping: a caller polling
 * `tasks/get` after a restart would be told the Task never existed.
 *
 * This store persists each Task as one JSON file so a habitat's Tasks survive
 * its container. Per ADR 0007 the durable Task lives on the habitat's own
 * volume — the process serving `tasks/get` is the one that has to read it, and
 * habitat-to-habitat traffic never reaches the control plane, so the store
 * cannot live there.
 *
 * Files are named by a hash of the task id rather than the id itself, so no
 * id can escape the directory or exceed a filename limit; the real id is
 * recorded inside. Writes go to a temp file and are renamed into place, so a
 * crash mid-write leaves the previous record intact rather than a truncated
 * one. Saves for the same task are serialised, so two concurrent writers
 * cannot interleave into a corrupt record.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task, TaskState } from "@a2a-js/sdk";
import type { TaskStore } from "@a2a-js/sdk/server";

/** States from which a Task will never move again. */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
	"completed",
	"canceled",
	"failed",
	"rejected",
];

/**
 * Non-terminal states in which a Task is legitimately waiting on something
 * outside the agent — a follow-up message, or a credential the caller must
 * authorize. These are NOT abandoned work and must never be swept.
 */
export const INTERRUPTED_TASK_STATES: readonly TaskState[] = [
	"input-required",
	"auth-required",
];

export function isTerminalTaskState(state: TaskState | undefined): boolean {
	return state !== undefined && TERMINAL_TASK_STATES.includes(state);
}

export function isInterruptedTaskState(state: TaskState | undefined): boolean {
	return state !== undefined && INTERRUPTED_TASK_STATES.includes(state);
}

/**
 * True when a Task is neither finished nor deliberately waiting — i.e. it was
 * mid-flight. After a restart these are the Tasks nothing is working on any
 * more; see `sweepAbandonedTasks`.
 */
export function isAbandonableTaskState(state: TaskState | undefined): boolean {
	return !isTerminalTaskState(state) && !isInterruptedTaskState(state);
}

/** File extension for persisted task records. */
const TASK_FILE_SUFFIX = ".task.json";

/** Envelope written to disk. The id is stored because the filename is a hash. */
interface PersistedTask {
	version: 1;
	id: string;
	task: Task;
}

function fileNameFor(taskId: string): string {
	const digest = createHash("sha256").update(taskId).digest("hex");
	return `${digest}${TASK_FILE_SUFFIX}`;
}

export interface FileTaskStoreOptions {
	/** Directory holding the task files. Created on demand. */
	dir: string;
}

export class FileTaskStore implements TaskStore {
	private readonly dir: string;
	/** Write-through cache, so a hot Task does not hit the disk on every read. */
	private readonly cache = new Map<string, Task>();
	/** Per-task write chains, so concurrent saves for one id serialise. */
	private readonly writes = new Map<string, Promise<void>>();
	private ensured = false;

	constructor(options: FileTaskStoreOptions) {
		this.dir = options.dir;
	}

	private async ensureDir(): Promise<void> {
		if (this.ensured) return;
		await mkdir(this.dir, { recursive: true });
		this.ensured = true;
	}

	private pathFor(taskId: string): string {
		return join(this.dir, fileNameFor(taskId));
	}

	async save(task: Task): Promise<void> {
		// Copy on the way in so a caller mutating its Task afterwards cannot
		// drift what we hold or what we are about to write.
		const snapshot = structuredClone(task);
		this.cache.set(snapshot.id, snapshot);

		const previous = this.writes.get(snapshot.id) ?? Promise.resolve();
		const next = previous
			.catch(() => {
				/* a failed earlier write must not cancel this one */
			})
			.then(() => this.writeFileAtomic(snapshot));

		this.writes.set(snapshot.id, next);
		try {
			await next;
		} finally {
			if (this.writes.get(snapshot.id) === next) {
				this.writes.delete(snapshot.id);
			}
		}
	}

	private async writeFileAtomic(task: Task): Promise<void> {
		await this.ensureDir();
		const target = this.pathFor(task.id);
		// Unique temp name: two writers for *different* tasks may run at once.
		const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
		const payload: PersistedTask = { version: 1, id: task.id, task };
		try {
			await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
			await rename(tmp, target);
		} catch (err) {
			await unlink(tmp).catch(() => {
				/* best effort */
			});
			throw err;
		}
	}

	async load(taskId: string): Promise<Task | undefined> {
		const cached = this.cache.get(taskId);
		if (cached) return structuredClone(cached);

		const record = await this.readRecord(this.pathFor(taskId));
		if (!record) return undefined;
		this.cache.set(record.id, record.task);
		return structuredClone(record.task);
	}

	private async readRecord(path: string): Promise<PersistedTask | undefined> {
		let raw: string;
		try {
			raw = await readFile(path, "utf-8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as PersistedTask;
			// A record without a task is corrupt; treat it as absent rather than
			// letting `undefined` masquerade as a Task downstream.
			if (!parsed?.task?.id) return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}

	/**
	 * Every persisted Task. Used by the boot recovery sweep; the A2A surface
	 * itself has no list method in this protocol version.
	 */
	async listAll(): Promise<Task[]> {
		await this.ensureDir();
		let entries: string[];
		try {
			entries = await readdir(this.dir);
		} catch {
			return [];
		}

		const tasks: Task[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(TASK_FILE_SUFFIX)) continue;
			const record = await this.readRecord(join(this.dir, entry));
			// Unreadable or half-written files are skipped rather than throwing —
			// one bad file must not make the whole fleet's recovery fail.
			if (record) tasks.push(record.task);
		}
		return tasks;
	}
}
