/**
 * Gaia Registry — source of truth for managed habitats.
 * Persisted as registry.json in the Gaia data directory.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentEntry, HabitatConfig } from "../../types.js";
import { mountsToAgentEntries } from "./mounts.js";
import { deriveRepoScopes, mergeDerivedReadScope } from "./repo-scopes.js";
import type {
	GaiaRegistry,
	GaiaHabitatEntry,
	CreateHabitatOptions,
} from "./types.js";

const REGISTRY_FILE = "registry.json";

function generateApiKey(): string {
	return `gaia_${randomBytes(24).toString("hex")}`;
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * The read entries a human declared, i.e. everything that is not explained
 * by the habitat's own repos. Recomputed rather than remembered, so removing
 * a mount narrows the scope.
 */
function explicitReads(
	entry: GaiaHabitatEntry,
	_mounted: AgentEntry[],
): string[] | "org" | undefined {
	if (entry.github?.read === "org") return "org";
	const derivedNow = new Set(deriveRepoScopes(entry.config).read);
	return (entry.github?.read ?? []).filter((r) => !derivedNow.has(r));
}

export class GaiaRegistryManager {
	private registry: GaiaRegistry = { habitats: [] };
	private loaded = false;

	constructor(private readonly dataDir: string) {}

	private get registryPath(): string {
		return join(this.dataDir, REGISTRY_FILE);
	}

	/** Load registry from disk. Creates empty registry if file doesn't exist. */
	async load(): Promise<void> {
		try {
			const raw = await readFile(this.registryPath, "utf-8");
			this.registry = JSON.parse(raw) as GaiaRegistry;
		} catch {
			this.registry = { habitats: [] };
		}
		this.loaded = true;
	}

	/** Save registry to disk. */
	async save(): Promise<void> {
		await mkdir(this.dataDir, { recursive: true });
		await writeFile(
			this.registryPath,
			JSON.stringify(this.registry, null, 2) + "\n",
		);
	}

	private ensureLoaded(): void {
		if (!this.loaded)
			throw new Error("Registry not loaded — call load() first");
	}

	/** List all registered habitats. */
	list(): GaiaHabitatEntry[] {
		this.ensureLoaded();
		return [...this.registry.habitats];
	}

	/** Get a habitat by ID. */
	get(id: string): GaiaHabitatEntry | undefined {
		this.ensureLoaded();
		return this.registry.habitats.find((h) => h.id === id);
	}

	/** Create a new habitat entry. Returns the created entry. */
	async create(options: CreateHabitatOptions): Promise<GaiaHabitatEntry> {
		this.ensureLoaded();

		const id = slugify(options.id);
		if (this.registry.habitats.some((h) => h.id === id)) {
			throw new Error(`Habitat "${id}" already exists`);
		}

		// Mounts become read-only agent entries the entrypoint clones (ADR 0006).
		// Thrown errors here abort the create before anything is registered —
		// see the half-registered-habitat note below.
		const mountedAgents = mountsToAgentEntries(options.mounts);

		const entry: GaiaHabitatEntry = {
			id,
			name: options.name,
			config: {
				name: options.name,
				defaultProvider: options.provider,
				defaultModel: options.model,
				agents: mountedAgents,
				gitUrl: options.gitUrl,
				gitBranch: options.gitBranch,
				...(options.skillsFromGit?.length
					? { skillsFromGit: options.skillsFromGit }
					: {}),
				...(options.capabilities?.length
					? { capabilities: options.capabilities }
					: {}),
				// The habitat's own statement of what it needs. Gaia provisions
				// from this; secretBindings is the older bare-name fallback.
				...(options.requiredSecrets
					? { requiredSecrets: options.requiredSecrets }
					: {}),
			},
			secretBindings: options.secretBindings ?? [],
			apiKey: generateApiKey(),
			...(options.image ? { image: options.image } : {}),
			...(options.hostname ? { hostname: options.hostname } : {}),
			// Read scope is derived from the Owned repo plus these mounts, so a
			// mount can never fail at boot with a GitHub 404 that reads like
			// "no such repo". Write is never derived (ADR 0006).
			github: mergeDerivedReadScope(
				options.github,
				deriveRepoScopes({
					name: options.name,
					agents: mountedAgents,
					gitUrl: options.gitUrl,
				} as HabitatConfig),
			),
			...(options.storage ? { storage: options.storage } : {}),
			createdAt: new Date().toISOString(),
		};

		// Everything that can fail happens before the entry is registered, so a
		// failed create leaves no half-registered habitat behind.
		const habitatDataDir = join(this.dataDir, "habitats", id);
		await mkdir(habitatDataDir, { recursive: true });

		this.registry.habitats.push(entry);
		try {
			await this.save();
		} catch (err) {
			// Roll the in-memory registry back, or the next unrelated save would
			// quietly persist a habitat this call already reported as failed.
			this.registry.habitats = this.registry.habitats.filter(
				(h) => h !== entry,
			);
			throw err;
		}
		return entry;
	}

	/**
	 * Replace a habitat's Mounted repos and re-derive its read scope.
	 *
	 * Adding a mount without widening the scope is the failure ADR 0006
	 * exists to prevent, so the two move together here rather than being two
	 * calls a caller can get half-right.
	 */
	async setMounts(
		id: string,
		mounts: CreateHabitatOptions["mounts"],
	): Promise<GaiaHabitatEntry> {
		const entry = this.get(id);
		if (!entry) throw new Error(`Habitat "${id}" not found`);

		const mountedAgents = mountsToAgentEntries(mounts);
		// Preserve anything that is not a code mount — remote-habitat peers and
		// credential-only entries live in the same array.
		const kept = (entry.config.agents ?? []).filter(
			(a) => (a.kind ?? "repo") !== "repo" || a.mode !== "read",
		);
		const agents = [...kept, ...mountedAgents];

		const config = { ...entry.config, agents };
		return this.update(id, {
			config,
			github: mergeDerivedReadScope(
				// Drop the previous derivation before re-deriving, so removing a
				// mount actually narrows the scope instead of leaving it behind.
				{ ...entry.github, read: explicitReads(entry, mountedAgents) },
				deriveRepoScopes(config),
			),
		});
	}

	/** Update a habitat entry. */
	async update(
		id: string,
		updates: Partial<
			Pick<
				GaiaHabitatEntry,
				| "name"
				| "config"
				| "secretBindings"
				| "containerPort"
				| "image"
				| "github"
				| "cachedCard"
				| "lastActivityAt"
				| "vaultToml"
			>
		>,
	): Promise<GaiaHabitatEntry> {
		this.ensureLoaded();

		const idx = this.registry.habitats.findIndex((h) => h.id === id);
		if (idx === -1) throw new Error(`Habitat "${id}" not found`);

		const entry = this.registry.habitats[idx];
		if (updates.name !== undefined) entry.name = updates.name;
		if (updates.config !== undefined) entry.config = updates.config;
		if (updates.secretBindings !== undefined)
			entry.secretBindings = updates.secretBindings;
		if (updates.containerPort !== undefined)
			entry.containerPort = updates.containerPort;
		if (updates.image !== undefined) entry.image = updates.image;
		if (updates.github !== undefined) entry.github = updates.github;
		if (updates.cachedCard !== undefined) entry.cachedCard = updates.cachedCard;
		if (updates.lastActivityAt !== undefined)
			entry.lastActivityAt = updates.lastActivityAt;
		// Assigned unconditionally: undefined means the repo no longer
		// declares a vault, which must clear it rather than keep a stale copy.
		if ("vaultToml" in updates) entry.vaultToml = updates.vaultToml;

		await this.save();
		return entry;
	}

	/** Remove a habitat entry. Returns the removed entry or undefined. */
	async remove(id: string): Promise<GaiaHabitatEntry | undefined> {
		this.ensureLoaded();

		const idx = this.registry.habitats.findIndex((h) => h.id === id);
		if (idx === -1) return undefined;

		const [removed] = this.registry.habitats.splice(idx, 1);
		await this.save();
		return removed;
	}

	/** Get the data directory for a specific habitat. */
	habitatDataDir(id: string): string {
		return join(this.dataDir, "habitats", id);
	}
}
