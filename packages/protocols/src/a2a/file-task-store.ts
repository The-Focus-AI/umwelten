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
 *
 * On-disk format: v2 records hold the Task in proto-JSON form (v1 SDK,
 * states as `TASK_STATE_*` names). v1 records from the 0.3-SDK era (legacy
 * state strings, `kind`-discriminated parts) are read transparently via
 * `taskFromStoredJson` and upgraded the next time they are saved.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TaskState, type ListTasksRequest, type ListTasksResponse, type Task } from "@a2a-js/sdk";
import type { ServerCallContext, TaskStore } from "@a2a-js/sdk/server";
import { taskFromStoredJson, taskToStoredJson } from "./v1-compat.js";

/** States from which a Task will never move again. */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
	TaskState.TASK_STATE_COMPLETED,
	TaskState.TASK_STATE_CANCELED,
	TaskState.TASK_STATE_FAILED,
	TaskState.TASK_STATE_REJECTED,
];

/**
 * Non-terminal states in which a Task is legitimately waiting on something
 * outside the agent — a follow-up message, or a credential the caller must
 * authorize. These are NOT abandoned work and must never be swept.
 */
export const INTERRUPTED_TASK_STATES: readonly TaskState[] = [
	TaskState.TASK_STATE_INPUT_REQUIRED,
	TaskState.TASK_STATE_AUTH_REQUIRED,
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
	version: 1 | 2;
	id: string;
	/** v1: legacy-shaped Task JSON; v2: proto-JSON. Both readable. */
	task: unknown;
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

	// The habitat store is single-tenant: the container *is* the boundary
	// (ADR 0007/0003), so `context` tenant/user scoping is intentionally
	// unused. The parameters exist to satisfy the v1 TaskStore contract.
	async save(task: Task, _context?: ServerCallContext): Promise<void> {
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
		const payload: PersistedTask = {
			version: 2,
			id: task.id,
			task: taskToStoredJson(task),
		};
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

	async load(taskId: string, _context?: ServerCallContext): Promise<Task | undefined> {
		const cached = this.cache.get(taskId);
		if (cached) return structuredClone(cached);

		const task = await this.readTask(this.pathFor(taskId));
		if (!task) return undefined;
		this.cache.set(task.id, task);
		return structuredClone(task);
	}

	private async readTask(path: string): Promise<Task | undefined> {
		let raw: string;
		try {
			raw = await readFile(path, "utf-8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as PersistedTask;
			// A record without a task id is corrupt; treat it as absent rather
			// than letting `undefined` masquerade as a Task downstream.
			if (!parsed?.id || parsed.task === undefined) return undefined;
			const task = taskFromStoredJson(parsed.task);
			if (!task.id) return undefined;
			return task;
		} catch {
			return undefined;
		}
	}

	/**
	 * v1 `ListTasks` (ADR 0007's polling surface finally has a spec home).
	 * Filters by contextId / status / statusTimestampAfter, paginates by
	 * pageSize/pageToken (opaque offset), trims history to historyLength,
	 * and strips artifacts unless includeArtifacts.
	 */
	async list(
		params: ListTasksRequest,
		_context?: ServerCallContext,
	): Promise<ListTasksResponse> {
		let tasks = await this.listAll();

		if (params.contextId) {
			tasks = tasks.filter((t) => t.contextId === params.contextId);
		}
		if (params.status !== undefined && params.status !== TaskState.TASK_STATE_UNSPECIFIED) {
			tasks = tasks.filter((t) => t.status?.state === params.status);
		}
		if (params.statusTimestampAfter) {
			const after = Date.parse(params.statusTimestampAfter);
			tasks = tasks.filter((t) => {
				const ts = t.status?.timestamp ? Date.parse(t.status.timestamp) : NaN;
				return Number.isFinite(ts) && ts >= after;
			});
		}

		// Newest status first, matching what a poller wants to see.
		tasks.sort((a, b) => {
			const ta = a.status?.timestamp ? Date.parse(a.status.timestamp) : 0;
			const tb = b.status?.timestamp ? Date.parse(b.status.timestamp) : 0;
			return tb - ta;
		});

		const totalSize = tasks.length;
		const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 100);
		const offset = params.pageToken ? Number.parseInt(params.pageToken, 10) || 0 : 0;
		const page = tasks.slice(offset, offset + pageSize);
		const nextOffset = offset + page.length;

		const shaped = page.map((task) => {
			const copy = structuredClone(task);
			if (params.historyLength !== undefined && params.historyLength >= 0) {
				copy.history = copy.history.slice(-params.historyLength);
			}
			if (!params.includeArtifacts) copy.artifacts = [];
			return copy;
		});

		return {
			tasks: shaped,
			nextPageToken: nextOffset < totalSize ? String(nextOffset) : "",
			pageSize,
			totalSize,
		};
	}

	/**
	 * Every persisted Task. Used by the boot recovery sweep, which wants the
	 * unfiltered set regardless of pagination.
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
			const task = await this.readTask(join(this.dir, entry));
			// Unreadable or half-written files are skipped rather than throwing —
			// one bad file must not make the whole fleet's recovery fail.
			if (task) tasks.push(task);
		}
		return tasks;
	}
}
