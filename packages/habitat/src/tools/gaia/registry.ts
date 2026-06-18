/**
 * Gaia Registry — source of truth for managed habitats.
 * Persisted as registry.json in the Gaia data directory.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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

		const entry: GaiaHabitatEntry = {
			id,
			name: options.name,
			config: {
				name: options.name,
				defaultProvider: options.provider,
				defaultModel: options.model,
				agents: [],
				gitUrl: options.gitUrl,
				gitBranch: options.gitBranch,
				...(options.skillsFromGit?.length
					? { skillsFromGit: options.skillsFromGit }
					: {}),
				...(options.capabilities?.length
					? { capabilities: options.capabilities }
					: {}),
			},
			secretBindings: options.secretBindings ?? [],
			apiKey: generateApiKey(),
			...(options.image ? { image: options.image } : {}),
			...(options.hostname ? { hostname: options.hostname } : {}),
			createdAt: new Date().toISOString(),
		};

		this.registry.habitats.push(entry);

		// Create data directory for this habitat
		const habitatDataDir = join(this.dataDir, "habitats", id);
		await mkdir(habitatDataDir, { recursive: true });

		await this.save();
		return entry;
	}

	/** Update a habitat entry. */
	async update(
		id: string,
		updates: Partial<
			Pick<
				GaiaHabitatEntry,
				"name" | "config" | "secretBindings" | "containerPort" | "image"
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
