import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CandidatePersistence } from "./candidate-persistence.js";

let testDir: string;
let store: CandidatePersistence;

beforeEach(() => {
	testDir = join(tmpdir(), `candidate-persistence-test-${randomUUID()}`);
	store = new CandidatePersistence(testDir);
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe("CandidatePersistence", () => {
	it("reads an empty array for a non-existent candidate kind", async () => {
		const results = await store.read("project-facts");
		expect(results).toEqual([]);
	});

	it("appends and reads back candidates of a single kind", async () => {
		const fact1 = { text: "We use pnpm for all packages", confidence: 0.9 };
		const fact2 = { text: "Company name is TheFocus.AI", confidence: 1.0 };

		await store.append("project-facts", fact1);
		await store.append("project-facts", fact2);

		const results = await store.read("project-facts");
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual(fact1);
		expect(results[1]).toEqual(fact2);
	});

	it("creates the files under the correct project-local path", async () => {
		const loop = { issue: 57, status: "in-progress" };
		await store.append("open-loops", loop);

		const filePath = join(testDir, ".umwelten/candidates/open-loops.jsonl");
		const content = await readFile(filePath, "utf-8");
		expect(content.trim()).toBe(JSON.stringify(loop));
	});

	it("reads all candidate kinds using readAll()", async () => {
		const fact = { text: "Fact A" };
		const loop = { text: "Loop B" };

		await store.append("project-facts", fact);
		await store.append("open-loops", loop);

		const all = await store.readAll();
		expect(all["project-facts"]).toEqual([fact]);
		expect(all["open-loops"]).toEqual([loop]);
		expect(all["skill-candidates"]).toEqual([]);
		expect(all["preferences"]).toEqual([]);
		expect(all["mistakes"]).toEqual([]);
	});

	it("handles malformed lines or whitespace-only lines gracefully by skipping them", async () => {
		// Create a file with mixed content: a valid line, a blank line, an invalid line, another valid line
		const dirPath = join(testDir, ".umwelten/candidates");
		const { mkdir, writeFile } = await import("node:fs/promises");
		await mkdir(dirPath, { recursive: true });

		const rawContent = [
			JSON.stringify({ index: 1 }),
			"",
			"this-is-not-json",
			JSON.stringify({ index: 2 }),
		].join("\n");

		await writeFile(join(dirPath, "preferences.jsonl"), rawContent, "utf-8");

		const results = await store.read("preferences");
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({ index: 1 });
		expect(results[1]).toEqual({ index: 2 });
	});
});
