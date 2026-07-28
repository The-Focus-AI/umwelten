/**
 * Durable A2A {@link PushNotificationStore} backed by the filesystem.
 *
 * The SDK's default store keeps registrations in memory, which has exactly the
 * problem `FileTaskStore` fixes for Tasks — and worse consequences. A Task
 * that vanishes on restart is at least visibly gone; a *registration* that
 * vanishes leaves the caller believing it will be told when the work finishes.
 * It waits for a webhook nobody will ever call.
 *
 * So registrations live on the habitat's volume next to the Tasks they belong
 * to, with the same discipline: one file per Task named by a hash of the id,
 * writes staged to a temp file and renamed into place, saves for one Task
 * serialised so concurrent writers cannot interleave.
 *
 * Semantics deliberately match `InMemoryPushNotificationStore` — a config with
 * no id takes the Task's id, saving over an existing id replaces it, and
 * deleting without an id deletes the one named after the Task. Divergence
 * would show up as a behaviour change on restart, which is the one place
 * nobody is looking.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PushNotificationConfig } from "@a2a-js/sdk";
import type { PushNotificationStore } from "@a2a-js/sdk/server";

/** File extension for persisted registration records. */
const PUSH_FILE_SUFFIX = ".push.json";

/** Envelope written to disk. The task id is stored because the name is a hash. */
interface PersistedPushConfigs {
	version: 1;
	taskId: string;
	configs: PushNotificationConfig[];
}

function fileNameFor(taskId: string): string {
	const digest = createHash("sha256").update(taskId).digest("hex");
	return `${digest}${PUSH_FILE_SUFFIX}`;
}

export interface FilePushNotificationStoreOptions {
	/** Directory holding the registration files. Created on demand. */
	dir: string;
}

export class FilePushNotificationStore implements PushNotificationStore {
	private readonly dir: string;
	/** Write-through cache, so a hot Task does not hit the disk on every send. */
	private readonly cache = new Map<string, PushNotificationConfig[]>();
	/** Per-task write chains, so concurrent saves for one id serialise. */
	private readonly writes = new Map<string, Promise<void>>();
	private ensured = false;

	constructor(options: FilePushNotificationStoreOptions) {
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

	async save(
		taskId: string,
		pushNotificationConfig: PushNotificationConfig,
	): Promise<void> {
		const config = structuredClone(pushNotificationConfig);
		// The SDK's in-memory store mutates the caller's config to give it an id.
		// Persisting cannot rely on that aliasing, so set it on both.
		if (!config.id) {
			config.id = taskId;
			pushNotificationConfig.id = taskId;
		}

		await this.mutate(taskId, (configs) => [
			...configs.filter((c) => c.id !== config.id),
			config,
		]);
	}

	async load(taskId: string): Promise<PushNotificationConfig[]> {
		const cached = this.cache.get(taskId);
		if (cached) return structuredClone(cached);

		const record = await this.readRecord(this.pathFor(taskId));
		if (!record) return [];
		this.cache.set(taskId, record.configs);
		return structuredClone(record.configs);
	}

	async delete(taskId: string, configId?: string): Promise<void> {
		const targetId = configId ?? taskId;
		await this.mutate(taskId, (configs) =>
			configs.filter((c) => c.id !== targetId),
		);
	}

	/**
	 * Read, change, write — with the *read* inside the lock.
	 *
	 * Registering two webhooks for one Task at once is a normal thing for a
	 * caller to do, and serialising only the write is not enough: both saves
	 * would read the same list and the second would write the first one away.
	 */
	private async mutate(
		taskId: string,
		change: (
			configs: PushNotificationConfig[],
		) => PushNotificationConfig[],
	): Promise<void> {
		const previous = this.writes.get(taskId) ?? Promise.resolve();
		const next = previous
			.catch(() => {
				/* a failed earlier write must not cancel this one */
			})
			.then(async () => {
				const configs = change(await this.load(taskId));
				this.cache.set(taskId, structuredClone(configs));
				await this.writeFileAtomic(taskId, configs);
			});

		this.writes.set(taskId, next);
		try {
			await next;
		} finally {
			if (this.writes.get(taskId) === next) this.writes.delete(taskId);
		}
	}

	private async writeFileAtomic(
		taskId: string,
		configs: PushNotificationConfig[],
	): Promise<void> {
		await this.ensureDir();
		const target = this.pathFor(taskId);

		// No registrations left means the file should be gone, not an empty list
		// that a later reader has to interpret.
		if (configs.length === 0) {
			this.cache.delete(taskId);
			await unlink(target).catch(() => {
				/* already absent */
			});
			return;
		}

		const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
		const payload: PersistedPushConfigs = { version: 1, taskId, configs };
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

	private async readRecord(
		path: string,
	): Promise<PersistedPushConfigs | undefined> {
		let raw: string;
		try {
			raw = await readFile(path, "utf-8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as PersistedPushConfigs;
			// A half-written or hand-edited file is treated as no registrations
			// rather than throwing: a caller not being notified is bad, a habitat
			// that will not boot is worse.
			if (!Array.isArray(parsed?.configs)) return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}
}
