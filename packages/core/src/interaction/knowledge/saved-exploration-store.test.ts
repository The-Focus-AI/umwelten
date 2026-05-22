import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SavedExplorationStore } from "./saved-exploration-store.js";
import type { SourceSession } from "../types/domain-types.js";
import {
	createDefaultExploration,
	createVirtualExploration,
} from "../types/domain-types.js";

// ── Helpers ─────────────────────────────────────────────────────────────

let testDir: string;
let store: SavedExplorationStore;

beforeEach(() => {
	testDir = join(tmpdir(), `saved-exploration-test-${randomUUID()}`);
	store = new SavedExplorationStore(testDir);
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

function makeSession(overrides: Partial<SourceSession> = {}): SourceSession {
	return {
		id: "src-cc-abc123",
		source: "claude-code",
		sourceId: "abc123",
		title: "Fix auth token refresh",
		created: "2026-05-14T10:00:00.000Z",
		modified: "2026-05-14T11:30:00.000Z",
		messageCount: 24,
		firstPrompt: "The auth token is expiring",
		...overrides,
	};
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("SavedExplorationStore", () => {
	it("saves a virtual exploration and returns a slug", async () => {
		const session = makeSession();
		const exploration = createVirtualExploration("oauth token", [session]);

		const result = await store.save(exploration);
		expect(result.slug).toBeDefined();
		expect(result.id).toBe(exploration.id);
	});

	it("persists the manifest as readable JSON", async () => {
		const session = makeSession();
		const exploration = createVirtualExploration("auth fix", [session]);

		const { slug } = await store.save(exploration);
		const manifestPath = join(
			testDir,
			".umwelten",
			"explorations",
			`${slug}.json`,
		);
		const content = await readFile(manifestPath, "utf-8");
		const parsed = JSON.parse(content);

		expect(parsed.version).toBe(1);
		expect(parsed.name).toBe("Search: auth fix");
		expect(parsed.members).toHaveLength(1);
		expect(parsed.members[0].kind).toBe("reference");
		expect(parsed.members[0].sourceSessionId).toBe("src-cc-abc123");
	});

	it("lists saved explorations newest first", async () => {
		const s1 = makeSession({ id: "s1", title: "Fix bugs" });
		const s2 = makeSession({ id: "s2", title: "Add feature" });

		await store.save(createVirtualExploration("first", [s1]));
		await store.save(createVirtualExploration("second", [s2]));

		const list = await store.list();
		expect(list.length).toBeGreaterThanOrEqual(2);
		// Newest first in list
		expect(list[0].name).toBeDefined();
	});

	it("list returns summaries with correct fields", async () => {
		const session = makeSession();
		await store.save(createVirtualExploration("my exploration", [session]));

		const list = await store.list();
		expect(list[0]).toMatchObject({
			slug: expect.any(String),
			id: expect.any(String),
			name: expect.any(String),
			saved: expect.any(String),
			memberCount: 1,
			version: 1,
		});
	});

	it("opens a saved exploration by name", async () => {
		const session = makeSession();
		await store.save(createVirtualExploration("unique-name", [session]));

		const opened = await store.open("unique-name");
		expect(opened).not.toBeNull();
		expect(opened!.name).toBe("Search: unique-name");
		expect(opened!.version).toBe(1);
	});

	it("opens a saved exploration by slug", async () => {
		const session = makeSession();
		const { slug } = await store.save(
			createVirtualExploration("slug-test", [session]),
		);

		const opened = await store.openBySlug(slug);
		expect(opened).not.toBeNull();
		expect(opened!.members).toHaveLength(1);
	});

	it("opens a saved exploration by ID", async () => {
		const session = makeSession();
		const exploration = createVirtualExploration("id-test", [session]);
		const { id } = await store.save(exploration);

		const opened = await store.openById(id);
		expect(opened).not.toBeNull();
		expect(opened!.id).toBe(id);
	});

	it("returns null for non-existent name", async () => {
		const result = await store.open("non-existent");
		expect(result).toBeNull();
	});

	it("deletes a saved exploration by slug", async () => {
		const session = makeSession();
		const { slug } = await store.save(
			createVirtualExploration("delete-me", [session]),
		);

		const deleted = await store.delete(slug);
		expect(deleted).toBe(true);

		const list = await store.list();
		expect(list.find((e) => e.slug === slug)).toBeUndefined();
	});

	it("returns false when deleting non-existent slug", async () => {
		const result = await store.delete("non-existent");
		expect(result).toBe(false);
	});

	it("converts SavedExploration back to Exploration domain object", async () => {
		const session = makeSession();
		const exploration = createVirtualExploration("convert-test", [session]);
		const { slug } = await store.save(exploration);

		const saved = await store.openBySlug(slug);
		expect(saved).not.toBeNull();

		const restored = store.toExploration(saved!);
		expect(restored.kind).toBe("saved");
		expect(restored.name).toBe("Search: convert-test");
		expect(restored.members).toHaveLength(1);
		expect(restored.memberCount).toBe(1);
		expect(restored.savedPath).toBeDefined();
	});

	it("saves a default exploration with custom name", async () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const result = await store.save(exploration, { name: "Custom Name" });

		expect(result.slug).toContain("custom-name");
	});

	it("disambiguates slugs on name collision", async () => {
		const s1 = makeSession({ id: "s1" });
		const s2 = makeSession({ id: "s2" });

		const r1 = await store.save(createVirtualExploration("same-name", [s1]));
		const r2 = await store.save(createVirtualExploration("same-name", [s2]));

		expect(r1.slug).toBe("search-same-name"); // slugified from 'Search: same-name'
		expect(r2.slug).not.toBe("search-same-name"); // timestamp disambiguated
	});

	it("handles invalid JSON in manifest", async () => {
		const { mkdir, writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dir = join(testDir, ".umwelten", "explorations");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "invalid.json"), "not valid json", "utf-8");

		const opened = await store.openBySlug("invalid");
		expect(opened).toBeNull();
	});

	it("handles missing version field in manifest", async () => {
		const { mkdir, writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dir = join(testDir, ".umwelten", "explorations");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "no-version.json"),
			JSON.stringify({ id: "test", name: "test" }),
			"utf-8",
		);

		const opened = await store.openBySlug("no-version");
		expect(opened).toBeNull();
	});

	it("store creates directory lazily on first save", async () => {
		const { readdir } = await import("node:fs/promises");

		// Directory shouldn't exist yet
		await expect(
			readdir(join(testDir, ".umwelten", "explorations")),
		).rejects.toThrow();

		const session = makeSession();
		await store.save(createVirtualExploration("lazy-create", [session]));

		// Now it should exist
		const files = await readdir(join(testDir, ".umwelten", "explorations"));
		expect(files.length).toBeGreaterThanOrEqual(1);
	});
});
