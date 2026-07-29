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
 * Semantics deliberately match the historical behaviour — a config with no id
 * takes the Task's id, saving over an existing id replaces it, and deleting
 * without an id deletes the one named after the Task. Divergence would show
 * up as a behaviour change on restart, which is the one place nobody is
 * looking.
 *
 * On-disk format: v2 records hold each registration as proto-JSON of the v1
 * {@link TaskPushNotificationConfig} alongside the A2A wire version it was
 * registered over (so the sender can keep POSTing 0.3-shaped bodies to
 * 0.3-registered webhooks). v1 records from the 0.3-SDK era (flat
 * `PushNotificationConfig` objects, no wire version) are read transparently —
 * defaulting their wire version to `0.3`, which is the only wire that
 * existed when they were written — and upgraded the next time they are saved.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TaskPushNotificationConfig } from "@a2a-js/sdk";
import type {
	PushNotificationStore,
	ServerCallContext,
} from "@a2a-js/sdk/server";

/**
 * A stored registration plus the wire version it was registered over —
 * mirrors the SDK's `StoredPushNotificationConfig` (the return shape of
 * `loadWithMetadata`).
 */
export interface StoredPushConfig {
	config: TaskPushNotificationConfig;
	wireVersion: string;
}

/** Wire version assumed for records that predate the v1 migration. */
const LEGACY_WIRE_VERSION = "0.3";

/** File extension for persisted registration records. */
const PUSH_FILE_SUFFIX = ".push.json";

/** Envelope written to disk. The task id is stored because the name is a hash. */
interface PersistedPushConfigs {
	version: 1 | 2;
	taskId: string;
	/** v1 records: flat 0.3-shaped configs, no wire version. */
	configs?: unknown[];
	/** v2 records: proto-JSON configs, each with its wire version. */
	entries?: Array<{ config: unknown; wireVersion?: string }>;
}

/** 0.3-era stored shape, for reading v1 records. */
interface LegacyStoredConfig {
	id?: string;
	url?: string;
	token?: string;
	authentication?: { schemes?: string[]; credentials?: string };
}

/** Convert a 0.3-era stored config into a v1 {@link TaskPushNotificationConfig}. */
function configFromLegacyStored(
	raw: LegacyStoredConfig,
	taskId: string,
): TaskPushNotificationConfig {
	return {
		tenant: "",
		id: raw.id ?? "",
		taskId,
		url: raw.url ?? "",
		token: raw.token ?? "",
		authentication: raw.authentication
			? {
					scheme: raw.authentication.schemes?.[0] ?? "",
					credentials: raw.authentication.credentials ?? "",
				}
			: undefined,
	};
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
	private readonly cache = new Map<string, StoredPushConfig[]>();
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

	// The habitat store is single-tenant: the container *is* the boundary
	// (ADR 0007/0003), so `context` tenant/user scoping is intentionally
	// unused beyond reading the wire version a registration arrived over.
	async save(
		taskId: string,
		context: ServerCallContext | undefined,
		pushNotificationConfig: TaskPushNotificationConfig,
	): Promise<void> {
		// The v1 contract: a caller-supplied empty id is assigned *in place* —
		// the id is the result of Create, observed through the caller's own
		// reference. Persisting cannot rely on that aliasing, so set it on
		// both the caller's object and our snapshot. The historical choice of
		// the Task's id (rather than a UUID) is kept: it is what old disk
		// records contain and what `delete` without an id removes.
		if (!pushNotificationConfig.id) {
			pushNotificationConfig.id = taskId;
		}
		const config = structuredClone(pushNotificationConfig);
		const wireVersion = context?.requestedVersion || LEGACY_WIRE_VERSION;

		await this.mutate(taskId, (entries) => [
			...entries.filter((e) => e.config.id !== config.id),
			{ config, wireVersion },
		]);
	}

	async load(
		taskId: string,
		_context?: ServerCallContext,
	): Promise<TaskPushNotificationConfig[]> {
		const entries = await this.loadEntries(taskId);
		return entries.map((e) => structuredClone(e.config));
	}

	/**
	 * Registrations with the wire version each arrived over, so the sender can
	 * serialize back to the wire the webhook expects. Records that predate the
	 * migration report `0.3` — the only wire that existed when they were
	 * written.
	 */
	async loadWithMetadata(
		taskId: string,
		_context?: ServerCallContext,
	): Promise<StoredPushConfig[]> {
		const entries = await this.loadEntries(taskId);
		return structuredClone(entries);
	}

	async delete(
		taskId: string,
		_context?: ServerCallContext,
		configId?: string,
	): Promise<void> {
		const targetId = configId ?? taskId;
		await this.mutate(taskId, (entries) =>
			entries.filter((e) => e.config.id !== targetId),
		);
	}

	private async loadEntries(taskId: string): Promise<StoredPushConfig[]> {
		const cached = this.cache.get(taskId);
		if (cached) return cached;

		const entries = await this.readRecord(this.pathFor(taskId));
		if (!entries) return [];
		this.cache.set(taskId, entries);
		return entries;
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
		change: (entries: StoredPushConfig[]) => StoredPushConfig[],
	): Promise<void> {
		const previous = this.writes.get(taskId) ?? Promise.resolve();
		const next = previous
			.catch(() => {
				/* a failed earlier write must not cancel this one */
			})
			.then(async () => {
				const entries = change(await this.loadEntries(taskId));
				this.cache.set(taskId, structuredClone(entries));
				await this.writeFileAtomic(taskId, entries);
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
		entries: StoredPushConfig[],
	): Promise<void> {
		await this.ensureDir();
		const target = this.pathFor(taskId);

		// No registrations left means the file should be gone, not an empty list
		// that a later reader has to interpret.
		if (entries.length === 0) {
			this.cache.delete(taskId);
			await unlink(target).catch(() => {
				/* already absent */
			});
			return;
		}

		const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
		const payload: PersistedPushConfigs = {
			version: 2,
			taskId,
			entries: entries.map((e) => ({
				config: TaskPushNotificationConfig.toJSON(e.config),
				wireVersion: e.wireVersion,
			})),
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

	private async readRecord(
		path: string,
	): Promise<StoredPushConfig[] | undefined> {
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
			if (Array.isArray(parsed?.entries)) {
				// v2 record: proto-JSON configs with per-entry wire versions.
				return parsed.entries.map((e) => ({
					config: TaskPushNotificationConfig.fromJSON(e.config),
					wireVersion: e.wireVersion || LEGACY_WIRE_VERSION,
				}));
			}
			if (Array.isArray(parsed?.configs)) {
				// v1 record from the 0.3-SDK era: flat configs, wire version 0.3.
				return parsed.configs.map((c) => ({
					config: configFromLegacyStored(
						c as LegacyStoredConfig,
						parsed.taskId,
					),
					wireVersion: LEGACY_WIRE_VERSION,
				}));
			}
			return undefined;
		} catch {
			return undefined;
		}
	}
}
