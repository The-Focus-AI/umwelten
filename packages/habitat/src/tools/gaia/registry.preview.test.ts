import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GaiaRegistryManager } from "./registry.js";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "umwelten-registry-preview-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("preview registry identity", () => {
	it("creates and persists one stable random suffix", async () => {
		const registry = new GaiaRegistryManager(dir);
		await registry.load();
		const created = await registry.create({ id: "shed", name: "Shed" });
		expect(created.previewSuffix).toMatch(/^[a-f0-9]{24}$/);

		const reloaded = new GaiaRegistryManager(dir);
		await reloaded.load();
		expect(reloaded.get("shed")?.previewSuffix).toBe(created.previewSuffix);
	});

	it("backfills old registry files once and persists the migration", async () => {
		await writeFile(
			join(dir, "registry.json"),
			JSON.stringify({
				habitats: [
					{
						id: "old",
						name: "Old",
						config: { name: "Old", agents: [] },
						secretBindings: [],
						apiKey: "old-key",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			}),
		);

		const registry = new GaiaRegistryManager(dir);
		await registry.load();
		const suffix = registry.get("old")?.previewSuffix;
		expect(suffix).toMatch(/^[a-f0-9]{24}$/);

		const persisted = JSON.parse(
			await readFile(join(dir, "registry.json"), "utf-8"),
		);
		expect(persisted.habitats[0].previewSuffix).toBe(suffix);
	});

	it("updates the cached set without exposing a suffix update path", async () => {
		const registry = new GaiaRegistryManager(dir);
		await registry.load();
		const created = await registry.create({ id: "shed", name: "Shed" });
		const publishedPreviews = [
			{ worktreeId: "primary", branch: "main", port: 5173, ordinal: 1 },
		];
		const updated = await registry.update("shed", { publishedPreviews });
		expect(updated.publishedPreviews).toEqual(publishedPreviews);
		expect(updated.previewSuffix).toBe(created.previewSuffix);
	});
});
